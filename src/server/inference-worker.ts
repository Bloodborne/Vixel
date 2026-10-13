/**
 * 推理 worker（服务器版，child_process.fork 的入口）：核心逻辑与桌面 utilityProcess 完全同一份
 * （core/inference/worker.ts），这里只接 process.send / process.on('message')。
 * 父进程用 serialization: 'advanced' fork，消息是结构化克隆，协议不变。
 */
import { createInferenceWorker } from '../core/inference/worker'
import type { InferenceRequest } from '../core/inference/transport'

if (typeof process.send !== 'function') {
  console.error('inference-worker must be started via child_process.fork')
  process.exit(1)
}

const enqueue = createInferenceWorker((res) => process.send!(res))

process.on('message', (req) => enqueue(req as InferenceRequest))

// 父进程退出（管道断开）时自行退出，不留孤儿进程
process.on('disconnect', () => process.exit(0))
