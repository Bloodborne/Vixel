import type { Photo } from '../../../shared/types'

/**
 * 媒体 URL 的唯一出口：桌面版走 vixel:// 自定义协议（主进程注册 5 个 host），
 * 网页版走同形的 /media/<host>/<id> HTTP 路由（src/server/media.ts），id 与参数完全一致。
 * `vixel:/` + `/thumb/5` 拼出 `vixel://thumb/5`（host 即种类），与 `/media/thumb/5` 同构。
 *
 * vixel://thumb 和 vixel://sprite（及 /media 对应路由）响应带 Cache-Control: immutable；
 * 原位编辑后 photo id 不变但内容（fileHash）会变，URL 必须带 ?v= 破缓存。
 * 人脸裁剪的 faceId 不复用，face 无需缓存参数。
 */
const BASE = window.api.platform === 'web' ? '/media' : 'vixel:/'

export function thumbUrl(photo: Pick<Photo, 'id' | 'fileHash'>): string {
  return `${BASE}/thumb/${photo.id}?v=${photo.fileHash}`
}

export function spriteUrl(videoId: number, fileHash: string): string {
  return `${BASE}/sprite/${videoId}?v=${fileHash}`
}

export function faceUrl(faceId: number): string {
  return `${BASE}/face/${faceId}`
}

/** 原图（详情 / 快速查看的大图） */
export function imageUrl(photoId: number): string {
  return `${BASE}/image/${photoId}`
}

/** 音视频源文件（Range 支持，<video>/<audio> 可 seek）；调用方可自行拼 #t= 片段 */
export function mediaSrcUrl(videoId: number): string {
  return `${BASE}/media/${videoId}`
}

/** 网页版"下载原文件"（桌面版用"在访达中显示"，不走这里） */
export function downloadOriginal(url: string, fileName: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}
