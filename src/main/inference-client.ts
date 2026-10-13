/**
 * 主进程侧的推理进程客户端：通用逻辑在 ../core/inference/client.ts
 * （按需 fork、崩溃重启、卡死看门狗），这里只做 Electron utilityProcess 适配。
 */

import { utilityProcess } from 'electron'
import { InferenceClient, type InferenceChildHandle } from '../core/inference/client'

export class InferenceProcess extends InferenceClient {
  constructor(entry: string) {
    super((): InferenceChildHandle => {
      const child = utilityProcess.fork(entry, [], { serviceName: 'Vixel Inference', stdio: 'inherit' })
      return {
        send: (req) => child.postMessage(req),
        onMessage: (cb) => child.on('message', cb),
        onSpawn: (cb) => child.once('spawn', () => cb(child.pid)),
        onExit: (cb) => child.once('exit', (code) => cb(code)),
        kill: () => child.kill(),
      }
    })
  }
}
