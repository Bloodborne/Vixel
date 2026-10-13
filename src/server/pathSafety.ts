/**
 * 媒体路由的路径安全：只许读两类文件 ——
 *   1) 库内文件：在 DB 里登记过、且真实路径（realpath，解掉符号链接）落在某个监视文件夹之内
 *   2) 生成产物：缩略图 / 人脸裁剪 / sprite，真实路径落在数据目录之内
 * `../` 穿越、URL 编码穿越、符号链接逃逸、指向库外的绝对路径一律拒绝。
 * 路由本身只接受数字 id（不接受路径参数），这里是纵深防御的第二层。
 */
import { realpath } from 'fs/promises'
import { resolve, sep } from 'path'

/** child 是否在 parent 目录之内（纯字符串判断，调用方先 realpath） */
export function isPathInside(parent: string, child: string): boolean {
  const p = resolve(parent)
  const c = resolve(child)
  if (c === p) return true
  const prefix = p.endsWith(sep) ? p : p + sep
  return c.startsWith(prefix)
}

/**
 * 把 filePath 解析成真实路径并验证在允许的根目录之内。
 * 返回真实路径（供流式读取）；不在任何根内 / 文件不存在 → null。
 */
export async function resolveInsideRoots(filePath: string, roots: string[]): Promise<string | null> {
  if (typeof filePath !== 'string' || filePath.length === 0) return null
  let real: string
  try {
    real = await realpath(filePath)
  } catch {
    return null // 不存在 / 权限不足
  }
  const realRoots = await Promise.all(roots.map(async (r) => {
    try { return await realpath(r) } catch { return null }
  }))
  for (const root of realRoots) {
    if (root && isPathInside(root, real)) return real
  }
  return null
}
