#!/usr/bin/env node
// 推理 worker 内存画像：逐个加载模型（LiteRT embedding / OCR / 人脸），每步前后取子进程 RSS，
// 顺带记录两步之间的瞬时峰值（50ms 轮询）。给服务器低内存模式（VIXEL_LOW_MEMORY）调参用。
//
//   npm run build:server
//   node scripts/profile-inference-mem.mjs [--threads 2] [--low-memory] [--order embed-first|onnx-first]
//
// 纯 Node + CPU 后端（容器同款路径），macOS 上跑出来的是相对数字，绝对值以容器实测为准。
import { fork } from 'child_process'
import { execFileSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import os from 'os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const sharp = require('sharp')

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const THREADS = flag('threads', '2')
const LOW_MEMORY = args.includes('--low-memory')
const ORDER = flag('order', 'embed-first')

const HOME = os.homedir()
const IMG_TEXT = flag('text-image', join(HOME, 'vixel-docker-test/library/文字/craft-beer.jpg'))
const IMG_BIG = flag('big-image', join(HOME, 'vixel-docker-test/library/自然/el_torcal_rocks.jpg'))
const MODELS_DIR = flag('models', join(root, 'resources/models'))
const LITERT_DIR = flag('litert', join(root, `resources/litert/${process.platform === 'darwin' ? 'darwin-arm64' : `linux-${process.arch}`}`))

const workerPath = join(root, 'dist/server/server/inference-worker.js')
const child = fork(workerPath, [], {
  serialization: 'advanced',
  stdio: 'inherit',
  env: { ...process.env, VIXEL_THREADS: THREADS, ...(LOW_MEMORY ? { VIXEL_LOW_MEMORY: '1' } : {}) },
})

let nextId = 1
const pending = new Map()
child.on('message', (res) => {
  const p = pending.get(res.id)
  if (!p) return
  pending.delete(res.id)
  res.ok ? p.resolve(res.result) : p.reject(new Error(res.error))
})
const call = (method, ...cargs) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  child.send({ id, method, args: cargs })
})

const rssMB = () => {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim()) / 1024
  } catch { return NaN }
}

let peak = 0
const poller = setInterval(() => { const r = rssMB(); if (r > peak) peak = r }, 50)

const rows = []
async function step(label, fn) {
  peak = rssMB()
  const before = peak
  const t0 = Date.now()
  await fn()
  const after = rssMB()
  rows.push({ label, before, after, peak: Math.max(peak, after), ms: Date.now() - t0 })
  console.log(`${label.padEnd(44)} rss ${before.toFixed(0).padStart(5)} → ${after.toFixed(0).padStart(5)} MB  (peak ${Math.max(peak, after).toFixed(0)} MB, ${Date.now() - t0} ms)`)
}

async function main() {
  const fs = await import('fs')
  const textImg = fs.readFileSync(IMG_TEXT)
  const bigImg = fs.readFileSync(IMG_BIG)
  // 视频片段仿真：8 帧 512px JPEG + 32s 16kHz 音轨（索引器喂给 worker 的就是这个形态）
  const frame = await sharp(bigImg).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
  const frames = Array.from({ length: 8 }, () => Uint8Array.from(frame))
  const audio = new Float32Array(16000 * 32)
  for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i / 17) * 0.3

  const embedCfg = { type: 'litert', modelsDir: MODELS_DIR, libDir: LITERT_DIR, backend: 'cpu', cacheDir: join(os.tmpdir(), 'vixel-profile-litert-cache') }

  const doEmbed = async () => {
    await step('embed.init (LiteRT cpu)', () => call('embed.init', embedCfg))
    await step('embed.encode text query', () => call('embed.encode', { type: 'text', content: '海边的日落' }))
    await step('embed.encode large image', () => call('embed.encode', { type: 'image', content: Uint8Array.from(bigImg) }))
    await step('embed.encode video segment (8f + audio)', () => call('embed.encode', { type: 'multimodal', video: { frames, durationSec: 32 }, audio }))
  }
  const doOnnx = async () => {
    await step('ocr.init (det+rec+cls)', () => call('ocr.init', MODELS_DIR))
    await step('ocr.process text image', () => call('ocr.process', Uint8Array.from(textImg)))
    await step('face.init (scrfd+mobilefacenet)', () => call('face.init', MODELS_DIR))
    await step('face.process portrait', () => call('face.process', Uint8Array.from(bigImg)))
  }

  await step('baseline (worker idle)', async () => {})
  if (ORDER === 'onnx-first') { await doOnnx(); await doEmbed() } else { await doEmbed(); await doOnnx() }
  // 混跑：embedding 已加载时再来一轮 OCR / 人脸（当前线上 OOM 的形态），再回到 embed
  await step('ocr.process again (embed loaded?)', () => call('ocr.process', Uint8Array.from(textImg)))
  await step('face.process again', () => call('face.process', Uint8Array.from(bigImg)))
  await step('embed.encode text again (swap back?)', () => call('embed.encode', { type: 'text', content: 'a red car' }))
  await step('embed.encode segment again', () => call('embed.encode', { type: 'multimodal', video: { frames, durationSec: 32 }, audio }))
  await step('embed.dispose', () => call('embed.dispose'))
  await new Promise((r) => setTimeout(r, 1500))
  console.log(`final rss after dispose + 1.5s: ${rssMB().toFixed(0)} MB`)

  clearInterval(poller)
  child.kill()
}

main().catch((err) => { console.error(err); clearInterval(poller); child.kill(); process.exit(1) })
