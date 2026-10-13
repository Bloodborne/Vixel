import { useEffect, useState, useMemo, useRef } from 'react'
import { t } from '../../../shared/i18n'
import type { MediaDetail, SearchResult } from '../../../shared/types'
import { MediaPlayer } from './media/MediaPlayer'
import { Inspector } from './inspector/Inspector'
import { mediaKindOf } from '../lib/format'
import { imageUrl, thumbUrl } from '../lib/mediaUrl'
import { useViewport } from '../lib/viewport'

interface PhotoDetailProps {
  /** 带 segment 的搜索结果：音视频打开时跳到命中片段 */
  result: SearchResult
  /** 当前结果集，用于 ← → 键翻浏览 */
  siblings?: SearchResult[]
  onSelect: (result: SearchResult) => void
  onClose: () => void
  onToggleFavorite?: () => void
}

/**
 * 全屏详情：只负责看大图 / 播放；元数据都在右侧检查器（与主窗口共用）。
 */
export function PhotoDetail({ result, siblings, onSelect, onClose, onToggleFavorite }: PhotoDetailProps): JSX.Element {
  const { photo, segment } = result
  const kind = mediaKindOf(photo)
  const isMedia = kind !== 'image' && photo.videoId != null
  const [media, setMedia] = useState<MediaDetail | null>(null)
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null)
  const bigImageUrl = imageUrl(photo.id)
  // 窄视口：右侧检查器换成"ⓘ 信息"按钮 + 底部面板
  const { compact } = useViewport()
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    setMedia(null)
    setResolution(null)
    if (!isMedia || photo.videoId == null) return
    let cancelled = false
    window.api.getMediaDetail(photo.videoId).then((m) => { if (!cancelled) setMedia(m) })
    return () => { cancelled = true }
  }, [isMedia, photo.videoId])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // 当前照片在 siblings 中的位置，决定 ← → 是否可用
  const currentIndex = useMemo(() => {
    if (!siblings) return -1
    return siblings.findIndex((r) => r.photo.id === photo.id)
  }, [siblings, photo.id])
  const hasPrev = currentIndex > 0
  const hasNext = siblings != null && currentIndex >= 0 && currentIndex < siblings.length - 1

  // 键盘导航：← / → 在 siblings 中切换；忽略输入框中的按键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      // 编辑 caption 时不抢键盘
      // 焦点在原生播放控件上时 ← → 是快进 / 快退，不翻页
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'VIDEO', 'AUDIO'].includes(target.tagName)) return
      if (e.key === 'ArrowLeft' && hasPrev && siblings) {
        e.preventDefault()
        onSelect(siblings[currentIndex - 1])
      } else if (e.key === 'ArrowRight' && hasNext && siblings) {
        e.preventDefault()
        onSelect(siblings[currentIndex + 1])
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [siblings, currentIndex, hasPrev, hasNext, onSelect])

  const handleBackdropClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  // 触屏横扫翻页（在 <video>/<audio> 上滑动留给原生控件）
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const handleTouchStart = (e: React.TouchEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName
    touchStart.current = tag === 'VIDEO' || tag === 'AUDIO' ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const handleTouchEnd = (e: React.TouchEvent): void => {
    const start = touchStart.current
    touchStart.current = null
    if (!start || !siblings) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx > 0 && hasPrev) onSelect(siblings[currentIndex - 1])
    else if (dx < 0 && hasNext) onSelect(siblings[currentIndex + 1])
  }

  return (
    <div
      className="theme-dark fixed inset-0 bg-black/95 text-ink flex animate-fade-in modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={photo.fileName}
      onClick={handleBackdropClick}
    >
      {/* 图片预览区域 */}
      <div
        className="flex-1 min-w-0 flex items-center justify-center p-8 max-md:p-3 relative"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {isMedia ? (
          media ? (
            <MediaPlayer
              // key：切换到另一个媒体时重建播放器，重新跳到命中片段
              key={`${media.id}-${segment?.startMs ?? ''}`}
              media={media}
              posterPhotoId={photo.id}
              posterHash={photo.fileHash}
              hit={segment}
              onResolution={(w, h) => setResolution({ w, h })}
            />
          ) : (
            <img src={thumbUrl(photo)} alt={photo.fileName} className="max-w-full max-h-full object-contain opacity-60" />
          )
        ) : bigImageUrl && (
          <img
            src={bigImageUrl}
            alt={photo.fileName}
            className="max-w-full max-h-full object-contain animate-fade-in"
          />
        )}

        {/* ← → 翻浏览按钮（仅当 siblings 提供且不在边缘时显示） */}
        {hasPrev && siblings && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(siblings[currentIndex - 1]) }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center transition-colors"
            title={t.detail.previous}
          >
            <svg className="w-5 h-5 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {hasNext && siblings && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(siblings[currentIndex + 1]) }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center transition-colors"
            title={t.detail.next}
          >
            <svg className="w-5 h-5 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* 位置指示 "3 / 50" */}
        {siblings && currentIndex >= 0 && (
          <div className="absolute top-4 left-4 px-2 py-1 rounded bg-black/40 backdrop-blur-sm text-ink text-caption tabular-nums pointer-events-none">
            {currentIndex + 1} / {siblings.length}
          </div>
        )}

        {/* 窄视口：右上角 关闭 / 信息（宽视口由右侧检查器承担） */}
        {compact && (
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setShowInfo((s) => !s) }}
              title={t.detail.info}
              aria-pressed={showInfo}
              data-detail-info
              className={`w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                showInfo ? 'bg-accent/80 text-black/85' : 'bg-black/40 hover:bg-black/60 text-ink'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 11v5" /><circle cx="12" cy="8" r="0.5" fill="currentColor" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose() }}
              title={t.common.close}
              data-detail-close
              className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-ink transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* 信息侧栏：与主窗口检查器同一组件；窄视口换成 ⓘ 唤出的底部面板 */}
      {!compact && (
        <div className="w-[272px] flex-shrink-0 bg-sidebar border-l border-line animate-slide-in">
          <Inspector result={result} onSelect={onSelect} onClose={onClose} resolution={resolution} onToggleFavorite={onToggleFavorite} />
        </div>
      )}
      {compact && showInfo && (
        <div
          className="absolute inset-x-0 bottom-0 z-10 h-[min(60vh,520px)] bg-sidebar border-t border-line rounded-t-xl shadow-2xl shadow-black/60 animate-slide-up"
          onClick={(e) => e.stopPropagation()}
          data-detail-inspector
        >
          <Inspector result={result} onSelect={onSelect} onClose={() => setShowInfo(false)} resolution={resolution} onToggleFavorite={onToggleFavorite} />
        </div>
      )}
    </div>
  )
}
