/**
 * 推理 worker 的核心（与宿主进程类型无关）：EmbeddingGemma 2（LiteRT）/ 人脸 / OCR 都在这里跑。
 * 桌面版宿主是 Electron utilityProcess（src/main/inference.ts，经 process.parentPort），
 * 服务器版宿主是 child_process.fork（src/server/inference-worker.ts，经 process.send）。
 * 消息协议不变：InferenceRequest / InferenceResponse（见 ./transport.ts）。
 *
 * 请求串行执行（一次前向本来就吃满分配的核，并发只会抢内存）；
 * 搜索框的文本 query 插队到最前，最多等当前这一个推理跑完。
 */

import { LiteRtEmbeddingProvider } from '../embedding/providers/litert/litertProvider'
import type { EmbeddingInput, EmbeddingProviderConfig } from '../embedding/types'
import { initFaceService, isFaceServiceReady, processPhotoFaces, setFaceModelsDir, disposeFaceService, faceModelsAvailable } from '../face'
import { initOcrService, processPhotoOcr, setOcrModelsDir, disposeOcrService, ocrModelsAvailable } from '../ocr'
import type { InferenceRequest, InferenceResponse } from './transport'

/**
 * 低内存模式（服务器 / NAS：VIXEL_LOW_MEMORY=1，Docker 镜像默认开；桌面不设 → 行为完全不变）：
 * EmbeddingGemma 引擎（CPU 后端常驻 1 GB 上下）和 OCR / 人脸的 ONNX 会话从不同时驻留 ——
 * 跑 OCR / 人脸前先卸掉 embedding 引擎，跑 embedding 前先卸掉 ONNX 会话；空闲一段时间后全部卸掉。
 * 实测（8 vCPU 容器）OCR 对大图的瞬时峰值叠在常驻引擎上正是 2.5 GiB 限额下 OOM 的形态。
 *
 * 卸载对宿主完全透明：embed.encode 发现引擎被卸掉时按最后一次 embed.init 的配置原样重建
 * （付一次冷启动延迟），face/ocr 的 process 同样按已知模型目录懒加载 —— 协议不变，
 * 宿主的 RemoteReady / generation 语义不变。索引器在同一环境变量下按模型组给任务排序
 * （见 core/indexer.ts），让换组发生在"批与批之间"而不是每个文件一次。
 */
const LOW_MEMORY = process.env.VIXEL_LOW_MEMORY === '1'
/** 空闲卸载延迟：索引批次内请求间隔远小于它（即便 32 帧视频片段也 ~2.5 min），只有真空闲才触发 */
const IDLE_UNLOAD_MS = 5 * 60 * 1000

let embedder: LiteRtEmbeddingProvider | null = null
let embedderKey = ''
/** 最近一次 embed.init 的配置：低内存模式卸载引擎后按它原样重建 */
let embedderConfig: EmbeddingProviderConfig | null = null

async function unloadEmbedder(): Promise<void> {
  const e = embedder
  embedder = null
  // dispose 失败（原生层异常）不让 worker 死掉：引擎句柄已置空，下次按配置重建
  if (e) await e.dispose().catch((err) => console.warn('[inference] embedder dispose failed:', err))
}

async function unloadOnnxSessions(): Promise<void> {
  await disposeOcrService()
  await disposeFaceService()
}

/**
 * embedding 组任务前：低内存模式先卸 ONNX 会话；引擎被卸掉过（换组 / 空闲）就按原配置重建。
 * 非低内存模式语义与原先一致：未 init 过 → 抛 'Embedding model not initialized'。
 */
async function ensureEmbedder(): Promise<LiteRtEmbeddingProvider> {
  if (LOW_MEMORY) await unloadOnnxSessions()
  if (!embedder?.isReady()) {
    if (!(LOW_MEMORY && embedderConfig)) throw new Error('Embedding model not initialized')
    await unloadEmbedder()
    embedder = new LiteRtEmbeddingProvider(embedderConfig)
    await embedder.init()
  }
  return embedder
}

/** OCR / 人脸的 process 前：低内存模式让 embedding 引擎先让位（配置留着，下次 embed 原样重建） */
async function beforeOnnxWork(): Promise<void> {
  if (LOW_MEMORY) await unloadEmbedder()
}

// 结构化克隆把 Buffer 变成普通 Uint8Array，sharp 等需要 Buffer 的地方要还原回来
function asBuffer(v: unknown): Buffer {
  const u = v as Uint8Array
  return Buffer.isBuffer(u) ? u : Buffer.from(u.buffer, u.byteOffset, u.byteLength)
}

function reviveInput(input: EmbeddingInput): EmbeddingInput {
  switch (input.type) {
    case 'image':
      return { ...input, content: asBuffer(input.content) }
    case 'video':
      return { ...input, frames: input.frames.map(asBuffer) }
    case 'multimodal':
      return {
        ...input,
        image: input.image && asBuffer(input.image),
        video: input.video && { ...input.video, frames: input.video.frames.map(asBuffer) },
      }
    default:
      return input
  }
}

const handlers: Record<InferenceRequest['method'], (...args: any[]) => Promise<unknown>> = {
  'embed.init': async (config: EmbeddingProviderConfig) => {
    const key = JSON.stringify(config)
    if (!(embedder?.isReady() && key === embedderKey)) {
      if (LOW_MEMORY) await unloadOnnxSessions()
      await embedder?.dispose()
      embedder = new LiteRtEmbeddingProvider(config)
      embedderKey = key
      await embedder.init()
      // 重建用配置：GPU 已证明不可用（auto → cpu）就固定 cpu，低内存模式每次换组重建
      // 不再空试一遍 GPU（省一次注定失败的 createEngine + 日志噪音）。embedderKey 仍按
      // 原配置比较，宿主重发同样的 embed.init 不会触发重建。
      embedderConfig = embedder.activeBackend === 'cpu' && config.backend !== 'cpu'
        ? { ...config, backend: 'cpu' }
        : config
    }
    // 告诉宿主实际用上的后端（gpu 不可用时退到 cpu）
    return { backend: embedder.activeBackend ?? undefined }
  },
  'embed.encode': async (input: EmbeddingInput) => {
    const e = await ensureEmbedder()
    return e.encode(reviveInput(input))
  },
  'embed.dispose': async () => {
    await embedder?.dispose()
    embedder = null
    embedderKey = ''
    embedderConfig = null
  },
  'face.init': async (modelsDir: string) => {
    setFaceModelsDir(modelsDir)
    // 低内存模式：init 只记目录 + 校验模型文件在不在，不加载会话（process 时懒加载）——
    // 否则启动序列 ocr.init → embed.init → face.init 会让引擎和人脸会话短暂共存
    if (LOW_MEMORY) return faceModelsAvailable()
    return initFaceService()
  },
  'face.process': async (buf: Uint8Array) => {
    await beforeOnnxWork()
    // 低内存模式下会话可能被卸掉过（换组 / 空闲）：按已知模型目录重新加载
    if (LOW_MEMORY && !isFaceServiceReady() && !(await initFaceService())) {
      throw new Error('Face service not ready')
    }
    return processPhotoFaces(asBuffer(buf))
  },
  'ocr.init': async (modelsDir: string) => {
    setOcrModelsDir(modelsDir)
    // 同 face.init：低内存模式只校验，不把会话和 embedding 引擎放到一起
    if (LOW_MEMORY) return ocrModelsAvailable()
    return initOcrService()
  },
  'ocr.process': async (buf: Uint8Array) => {
    await beforeOnnxWork()
    // processPhotoOcr 自带懒加载（模型目录已知），被卸掉过会自动重新 init
    return processPhotoOcr(asBuffer(buf))
  },
}

// 搜索类请求插队：文本查询，和标了 urgent 的以图搜图查询（后台索引的图片批次不带该标记）
const isUrgent = (r: InferenceRequest): boolean => {
  if (r.method !== 'embed.encode') return false
  const input = r.args[0] as EmbeddingInput | undefined
  return input?.type === 'text' || ((input?.type === 'image' || input?.type === 'multimodal') && !!input.urgent)
}

/**
 * 启动 worker 消息循环：宿主把收到的请求喂给返回的函数，响应经 post 回发。
 */
export function createInferenceWorker(post: (res: InferenceResponse) => void): (req: InferenceRequest) => void {
  const queue: InferenceRequest[] = []
  let busy = false
  let idleTimer: NodeJS.Timeout | null = null

  // 低内存模式：真空闲（无在途、无排队）超过 IDLE_UNLOAD_MS 就卸掉全部模型，
  // 常驻内存回到几十 MB；下次请求按原配置懒加载。借 busy 旗标与 drain 互斥，
  // 绝不会在一次前向进行中释放会话。
  async function idleUnload(): Promise<void> {
    if (!LOW_MEMORY || busy || queue.length > 0) return
    busy = true
    try {
      await unloadEmbedder()
      await unloadOnnxSessions()
    } finally {
      busy = false
    }
    if (queue.length > 0) void drain() // 卸载期间进来的请求
  }

  function armIdleUnload(): void {
    if (!LOW_MEMORY) return
    if (idleTimer) clearTimeout(idleTimer)
    // dispose 内部已各自兜错；这里再兜一层，定时器回调绝不能变成未处理 rejection（会杀掉 worker）
    idleTimer = setTimeout(() => { idleUnload().catch((err) => console.warn('[inference] idle unload failed:', err)) }, IDLE_UNLOAD_MS)
    idleTimer.unref?.()
  }

  async function drain(): Promise<void> {
    if (busy) return
    busy = true
    while (queue.length > 0) {
      const req = queue.shift()!
      let res: InferenceResponse
      try {
        res = { id: req.id, ok: true, result: await handlers[req.method](...req.args) }
      } catch (err) {
        res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      post(res)
    }
    busy = false
    armIdleUnload()
  }

  return (req: InferenceRequest) => {
    if (isUrgent(req)) {
      const at = queue.findIndex((r) => !isUrgent(r))
      queue.splice(at < 0 ? queue.length : at, 0, req)
    } else {
      queue.push(req)
    }
    void drain()
  }
}
