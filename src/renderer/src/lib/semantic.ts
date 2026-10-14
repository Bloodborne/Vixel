import { useEffect, useState } from 'react'

/**
 * 这台机器的 CPU 跑不了语义模型（服务器版跑在老 NAS 上：x86 无 AVX / ARMv8.0）。
 * 依赖向量的功能（语义搜索、以图搜图、相似照片、自动标签）要据此换成"不支持"的说明，
 * 而不是显示"0 项"或"等模型加载"。整个页面生命周期里不会变，问一次缓存。
 */
let cached: Promise<boolean> | null = null

export function useSemanticOff(): boolean {
  const [off, setOff] = useState(false)
  useEffect(() => {
    cached ??= window.api.getModelStatus().then((s) => !!s.cpuUnsupported).catch(() => false)
    let alive = true
    void cached.then((v) => { if (alive) setOff(v) })
    return () => { alive = false }
  }, [])
  return off
}
