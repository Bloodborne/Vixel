import { cpus } from 'os'
import type { InferenceSession } from 'onnxruntime-node'

/**
 * 人脸 / OCR 的小模型共用的 ONNX 会话选项。默认每核一个线程，后台扫描会吃满整机 CPU；
 * 和 EmbeddingGemma 一样只用一半核，给 UI 和其他应用留余量。
 *
 * 服务器 / NAS（环境变量，桌面不设 → 行为不变）：
 *   VIXEL_THREADS=N          与 LiteRT 共用的 CPU 线程上限（见 litertProvider）
 *   VIXEL_ORT_MEM_ARENA=0    关掉 onnxruntime 的 CPU 内存池：池只增不减，OCR 遇到大图后
 *                            会一直占着峰值大小；关掉后按需分配 / 释放，数值结果不变
 *                            （Docker 镜像默认设为 0，见 Dockerfile）
 */
export function cpuSessionOptions(env: Record<string, string | undefined> = process.env): InferenceSession.SessionOptions {
  const envThreads = Number(env.VIXEL_THREADS)
  const threads = Number.isInteger(envThreads) && envThreads > 0
    ? envThreads
    : Math.max(1, Math.floor(cpus().length / 2))
  return {
    executionProviders: ['cpu'],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    ...(env.VIXEL_ORT_MEM_ARENA === '0' ? { enableCpuMemArena: false } : {}),
  }
}

export const CPU_SESSION_OPTIONS: InferenceSession.SessionOptions = cpuSessionOptions()
