/**
 * 推理 worker 的模型驻留策略测试（低内存模式 VIXEL_LOW_MEMORY=1 vs 桌面默认）。
 * 模型模块全部 mock —— 这里只验证"谁在何时被加载 / 卸载"的策略与协议透明性，不跑真模型。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { InferenceRequest, InferenceResponse } from './transport'

const litert = vi.hoisted(() => ({ instances: [] as Array<{ config: unknown; ready: boolean; disposed: boolean }> }))
vi.mock('../embedding/providers/litert/litertProvider', () => ({
  LiteRtEmbeddingProvider: class {
    config: unknown
    ready = false
    disposed = false
    activeBackend = 'cpu'
    constructor(config: unknown) {
      this.config = config
      litert.instances.push(this)
    }
    async init(): Promise<void> { this.ready = true }
    isReady(): boolean { return this.ready }
    async encode(): Promise<Float32Array> { return new Float32Array(4) }
    async dispose(): Promise<void> { this.ready = false; this.disposed = true }
  },
}))

const face = vi.hoisted(() => ({ loaded: false, initCalls: 0, disposeCalls: 0 }))
vi.mock('../face', () => ({
  setFaceModelsDir: vi.fn(),
  initFaceService: vi.fn(async () => { face.loaded = true; face.initCalls++; return true }),
  isFaceServiceReady: vi.fn(() => face.loaded),
  faceModelsAvailable: vi.fn(() => true),
  processPhotoFaces: vi.fn(async () => {
    if (!face.loaded) throw new Error('Face service not ready')
    return []
  }),
  disposeFaceService: vi.fn(async () => { face.loaded = false; face.disposeCalls++ }),
}))

const ocr = vi.hoisted(() => ({ loaded: false, initCalls: 0, disposeCalls: 0 }))
vi.mock('../ocr', () => ({
  setOcrModelsDir: vi.fn(),
  initOcrService: vi.fn(async () => { ocr.loaded = true; ocr.initCalls++; return true }),
  ocrModelsAvailable: vi.fn(() => true),
  // 与真实 processPhotoOcr 一致：未加载时自带懒 init
  processPhotoOcr: vi.fn(async () => {
    if (!ocr.loaded) { ocr.loaded = true; ocr.initCalls++ }
    return { text: '', lines: [] }
  }),
  disposeOcrService: vi.fn(async () => { ocr.loaded = false; ocr.disposeCalls++ }),
}))

type Call = <T>(method: InferenceRequest['method'], ...args: unknown[]) => Promise<T>

async function startWorker(lowMemory: boolean): Promise<Call> {
  vi.resetModules()
  litert.instances.length = 0
  Object.assign(face, { loaded: false, initCalls: 0, disposeCalls: 0 })
  Object.assign(ocr, { loaded: false, initCalls: 0, disposeCalls: 0 })
  if (lowMemory) vi.stubEnv('VIXEL_LOW_MEMORY', '1')
  else vi.stubEnv('VIXEL_LOW_MEMORY', '')
  const { createInferenceWorker } = await import('./worker')
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let nextId = 0
  const enqueue = createInferenceWorker((res: InferenceResponse) => {
    const p = pending.get(res.id)!
    pending.delete(res.id)
    if (res.ok) p.resolve(res.result)
    else p.reject(new Error(res.error))
  })
  return <T>(method: InferenceRequest['method'], ...args: unknown[]) =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      enqueue({ id, method, args })
    })
}

const embedCfg = { type: 'litert', modelsDir: '/m', libDir: '/l' }
const engine = (i: number) => litert.instances[i] as { ready: boolean; disposed: boolean }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('inference worker · 默认（桌面）模式', () => {
  it('embed 未 init 就 encode → 报错；OCR / 人脸跑时 embedding 引擎保持驻留', async () => {
    const call = await startWorker(false)
    await expect(call('embed.encode', { type: 'text', content: 'hi' })).rejects.toThrow('Embedding model not initialized')

    await call('embed.init', embedCfg)
    await call('ocr.init', '/m')
    await call('ocr.process', new Uint8Array(4))
    await call('face.init', '/m')
    await call('face.process', new Uint8Array(4))

    expect(litert.instances).toHaveLength(1)
    expect(engine(0).ready).toBe(true) // 引擎没被卸
    expect(ocr.disposeCalls).toBe(0)
    expect(face.disposeCalls).toBe(0)

    // encode 照常可用，不会触发任何卸载
    await call('embed.encode', { type: 'text', content: 'hi' })
    expect(ocr.loaded).toBe(true)
    expect(face.loaded).toBe(true)
  })
})

describe('inference worker · 低内存模式（VIXEL_LOW_MEMORY=1）', () => {
  it('embedding 引擎与 ONNX 会话从不同时驻留，且换组对宿主透明', async () => {
    const call = await startWorker(true)
    await call('embed.init', embedCfg)
    await call('ocr.init', '/m')
    await call('face.init', '/m')
    expect(engine(0).ready).toBe(true)
    // init 只校验模型文件，不加载会话 —— 启动序列不会让两组短暂共存
    expect(ocr.initCalls).toBe(0)
    expect(face.initCalls).toBe(0)
    expect(ocr.loaded).toBe(false)
    expect(face.loaded).toBe(false)

    // OCR 跑之前：引擎让位；会话此时才懒加载
    await call('ocr.process', new Uint8Array(4))
    expect(engine(0).disposed).toBe(true)
    expect(ocr.loaded).toBe(true)

    // 人脸接着跑：同组，不需要再卸什么；会话被卸过时能懒加载
    await call('face.process', new Uint8Array(4))
    expect(face.loaded).toBe(true)

    // 宿主不重发 embed.init，直接 encode → 按原配置重建引擎，并卸掉 ONNX 会话
    const vec = await call<Float32Array>('embed.encode', { type: 'text', content: 'hi' })
    expect(vec).toHaveLength(4)
    expect(litert.instances).toHaveLength(2)
    expect(engine(1).ready).toBe(true)
    expect(ocr.loaded).toBe(false)
    expect(face.loaded).toBe(false)

    // 再回 ONNX 组：第二代引擎被卸，人脸会话重新加载（init 计数 +1）
    const initsBefore = face.initCalls
    await call('face.process', new Uint8Array(4))
    expect(engine(1).disposed).toBe(true)
    expect(face.initCalls).toBe(initsBefore + 1)
  })

  it('空闲一段时间后卸掉全部模型，下一个请求自动重载', async () => {
    vi.useFakeTimers()
    const call = await startWorker(true)
    await call('embed.init', embedCfg)
    await call('embed.encode', { type: 'text', content: 'hi' })
    expect(engine(0).ready).toBe(true)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)
    expect(engine(0).disposed).toBe(true)

    // 空闲卸载后 encode 仍然可用（按原配置重建）
    const vec = await call<Float32Array>('embed.encode', { type: 'text', content: 'hi' })
    expect(vec).toHaveLength(4)
    expect(litert.instances).toHaveLength(2)
    expect(engine(1).ready).toBe(true)
  })

  it('embed.dispose 之后不再自动重建（与桌面语义一致）', async () => {
    const call = await startWorker(true)
    await call('embed.init', embedCfg)
    await call('embed.dispose')
    await expect(call('embed.encode', { type: 'text', content: 'hi' })).rejects.toThrow('Embedding model not initialized')
  })

  it('重建配置固定实际后端：auto 初始化落到 cpu 后，换组重建不再重试 GPU', async () => {
    const call = await startWorker(true)
    await call('embed.init', { ...embedCfg, backend: 'auto' })
    expect((litert.instances[0].config as { backend?: string }).backend).toBe('auto')
    // 换到 ONNX 组再回来 → 重建用固定的 cpu（mock 的 activeBackend 是 cpu）
    await call('ocr.init', '/m')
    await call('ocr.process', new Uint8Array(4))
    await call('embed.encode', { type: 'text', content: 'hi' })
    expect(litert.instances).toHaveLength(2)
    expect((litert.instances[1].config as { backend?: string }).backend).toBe('cpu')
  })

  it('引擎 dispose 抛异常不杀 worker：换组照常完成，下次 encode 重建', async () => {
    const call = await startWorker(true)
    await call('embed.init', embedCfg)
    ;(engine(0) as unknown as { dispose: () => Promise<void> }).dispose = async () => { throw new Error('native boom') }
    // 换组：unloadEmbedder 把 dispose 失败兜住，OCR 照常跑
    await call('ocr.init', '/m')
    const r = await call('ocr.process', new Uint8Array(4))
    expect(r).toBeDefined()
    // 回 embedding 组：按原配置重建出第二代引擎
    const vec = await call<Float32Array>('embed.encode', { type: 'text', content: 'hi' })
    expect(vec).toHaveLength(4)
    expect(litert.instances).toHaveLength(2)
    expect(engine(1).ready).toBe(true)
  })
})
