/**
 * 推理进程（Electron utilityProcess）入口：核心逻辑在 ../core/inference/worker.ts
 * （服务器版的 child_process.fork worker 也用同一份），这里只接 process.parentPort。
 */

import { createInferenceWorker } from '../core/inference/worker'
import type { InferenceRequest } from '../core/inference/transport'

const enqueue = createInferenceWorker((res) => process.parentPort.postMessage(res))

process.parentPort.on('message', (e) => {
  enqueue(e.data as InferenceRequest)
})
