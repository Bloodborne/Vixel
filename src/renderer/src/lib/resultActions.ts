import type { SearchResult } from '../../../shared/types'
import { mediaKindOf } from './format'

/**
 * 结果的源文件路径：音视频的 photo 行是代表图（抽帧 / 封面），
 * 真实路径要从 MediaDetail 取；图片直接用 photo.filePath。
 * 主窗口（右键菜单 / 检查器）和快速搜索面板共用。
 */
export async function sourcePathOf(r: SearchResult): Promise<string | null> {
  if (mediaKindOf(r.photo) !== 'image' && r.photo.videoId != null) {
    return (await window.api.getMediaDetail(r.photo.videoId))?.filePath ?? null
  }
  return r.photo.filePath
}
