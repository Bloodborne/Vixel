/**
 * 服务器侧的推理进程：child_process.fork（通用客户端逻辑在 core/inference/client.ts）。
 * serialization: 'advanced'（结构化克隆）—— Float32Array / Buffer 过进程边界不变形，
 * 与桌面 utilityProcess.postMessage 的语义一致，worker 代码零改动复用。
 */
import { fork } from 'child_process'
import { InferenceClient, type InferenceChildHandle } from '../core/inference/client'
import type { InferenceResponse } from '../core/inference/transport'

export function createServerInference(workerEntry: string): InferenceClient {
  return new InferenceClient((): InferenceChildHandle => {
    const child = fork(workerEntry, [], {
      serialization: 'advanced',
      stdio: 'inherit',
      env: process.env,
    })
    return {
      send: (req) => { child.send(req) },
      onMessage: (cb) => child.on('message', (msg) => cb(msg as InferenceResponse)),
      onSpawn: (cb) => child.once('spawn', () => cb(child.pid ?? undefined)),
      onExit: (cb) => child.once('exit', (code) => cb(code)),
      kill: () => { child.kill() },
    }
  })
}
