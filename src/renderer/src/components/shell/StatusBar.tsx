import { useEffect, useState } from 'react'
import { kbd } from '../../lib/platform'
import { t } from '../../../../shared/i18n'
import type { IndexProgress } from '../../../../shared/types'

export const THUMB_MIN = 120
export const THUMB_MAX = 320

interface StatusBarProps {
  progress: IndexProgress | null
  /** 左侧"N 项"及悬停提示的构成明细 */
  itemCount: number
  breakdown: string
  selectedCount?: number
  onOpenActivity: () => void
  /** 仅网格视图显示缩略图大小滑块 */
  thumbSize?: number
  onThumbSize?: (size: number) => void
  /** 网格信息密度（G） */
  density?: 'immersive' | 'info'
  onToggleDensity?: () => void
}

/** 电源策略等待原因 → 文案（core/powerPolicy.ts；与手动暂停分开展示） */
function waitReasonText(reason: NonNullable<IndexProgress['waitReason']>): string {
  return reason === 'battery' ? t.shell.waitPower
    : reason === 'thermal' ? t.shell.waitThermal
    : t.shell.waitLowPower
}

/** 当前活动的一句话描述 + 进度（0–1，未知为 null） */
function describeActivity(p: IndexProgress | null): { text: string; detail?: string; ratio: number | null } | null {
  if (!p) return null
  const { totalPhotos: total, thumbnailedPhotos: thumbs, indexedPhotos: indexed } = p
  const ocr = p.ocrPhotos || 0
  if (p.stage === 'indexing') {
    if (thumbs < total) return { text: t.shell.thumbnails(thumbs, total), detail: p.currentFile, ratio: total ? thumbs / total : null }
    if (indexed < thumbs) return { text: t.shell.indexing(indexed, thumbs), detail: p.currentFile, ratio: thumbs ? indexed / thumbs : null }
    const cur = p.current
    if (cur && cur.taskType === 'extract_frames' && cur.segTotal > 0) {
      return {
        text: t.shell.segments(cur.kind === 'audio' ? 'audio' : 'video', cur.segDone, cur.segTotal),
        detail: cur.name,
        ratio: cur.segDone / cur.segTotal,
      }
    }
    return { text: t.shell.processingMedia, ratio: null }
  }
  if (p.stage === 'ocr') return { text: t.shell.ocrProgress(ocr, indexed), detail: p.currentFile, ratio: indexed ? ocr / indexed : null }
  if (p.stage === 'detecting_faces') return { text: t.shell.detectingFaces, ratio: null }
  return null
}

export function StatusBar({ progress, itemCount, breakdown, selectedCount = 0, onOpenActivity, thumbSize, onThumbSize, density, onToggleDensity }: StatusBarProps): JSX.Element {
  // 首个 progress 事件到来前先问一次主进程（暂停状态会跨重启保留）
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    window.api.getIndexPaused().then(setPaused).catch(() => {})
  }, [])
  useEffect(() => {
    if (progress?.paused !== undefined) setPaused(progress.paused)
  }, [progress?.paused])

  // 语义模型缺失 / 初始化失败时在主窗口给出可见入口，而不是搜索静默无结果
  const [modelIssue, setModelIssue] = useState<string | null>(null)
  useEffect(() => {
    window.api.getModelStatus().then((s) => {
      setModelIssue(
        s.initError ? t.shell.modelInitFailed
          : !s.localModelExists ? t.shell.modelMissing
          : !s.embeddingReady ? t.shell.modelNotReady
          : null
      )
    }).catch(() => {})
  }, [])
  // progress 事件带模型就绪位：就绪后自动清掉提示
  useEffect(() => {
    if (progress?.aiModelReady) setModelIssue(null)
  }, [progress?.aiModelReady])

  const togglePause = (): void => {
    window.api.setIndexPaused(!paused).then(setPaused).catch(() => {})
  }

  const activity = describeActivity(progress)
  const errorCount = progress?.queue?.error ?? 0

  return (
    <footer className="h-[26px] flex-shrink-0 flex items-center gap-3 px-3 bg-bar border-t border-line text-caption text-ink-3 select-none">
      <span className="tabular-nums flex-shrink-0" title={breakdown || undefined}>
        {t.common.items(itemCount)}
        {selectedCount > 0 && <span className="text-ink-2">{t.shell.selected(selectedCount)}</span>}
      </span>

      {/* 活动区：点开抽屉 */}
      <button
        onClick={onOpenActivity}
        title={t.shell.viewActivity(kbd('⌥⌘A'))}
        className="min-w-0 flex-1 h-full flex items-center gap-2 px-2 -mx-2 hover:bg-fill transition-colors duration-fast"
      >
        {paused ? (
          <span className="text-warn/80">{t.shell.indexPaused}</span>
        ) : progress?.waitReason ? (
          // 电源策略在等（电池 / 低电量 / 过热）：和手动暂停区分开；少量新文件仍即时索引
          <span className="text-warn/80">{waitReasonText(progress.waitReason)}</span>
        ) : activity ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
            <span className="text-ink-2 tabular-nums flex-shrink-0">{activity.text}</span>
            {activity.detail && <span className="text-ink-4 truncate">{activity.detail}</span>}
            {activity.ratio !== null && (
              <span className="ml-auto w-20 h-[3px] bg-fill-active rounded-full overflow-hidden flex-shrink-0">
                <span
                  className="block h-full bg-accent rounded-full transition-[width] duration-view"
                  style={{ width: `${Math.round(activity.ratio * 100)}%` }}
                />
              </span>
            )}
          </>
        ) : (
          <span className="text-ink-3">{(progress?.totalPhotos ?? itemCount) > 0 ? t.shell.upToDate : t.shell.addFolderToStart}</span>
        )}
      </button>

      {modelIssue && (
        <button
          onClick={() => window.api.openSettings()}
          title={t.shell.modelIssueHint}
          className="flex-shrink-0 px-1.5 rounded bg-warn/10 text-warn/80 hover:bg-warn/20 transition-colors duration-fast"
        >
          {modelIssue} · {t.common.settings}
        </button>
      )}

      {errorCount > 0 && (
        <button
          onClick={onOpenActivity}
          className="flex-shrink-0 px-1.5 rounded bg-bad/10 text-bad/80 hover:bg-bad/20 tabular-nums transition-colors duration-fast"
        >
          {t.shell.failedCount(errorCount)}
        </button>
      )}

      {(activity || paused || progress?.waitReason) && (
        <button
          onClick={togglePause}
          className="flex-shrink-0 px-1.5 rounded text-ink-2 hover:text-ink hover:bg-fill-hover transition-colors duration-fast"
        >
          {paused ? t.shell.resume : t.shell.pause}
        </button>
      )}

      {density && onToggleDensity && (
        <button
          onClick={onToggleDensity}
          title={t.shell.densityTitle(density === 'info')}
          aria-pressed={density === 'info'}
          data-density={density}
          className={`flex-shrink-0 w-5 h-[18px] rounded flex items-center justify-center transition-colors duration-fast ${
            density === 'info' ? 'text-accent bg-accent/15' : 'text-ink-3 hover:text-ink hover:bg-fill-hover'
          }`}
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
            {density === 'info' ? (
              <>
                <rect x="0.5" y="0.5" width="4.5" height="4.5" rx="1" /><rect x="7" y="0.5" width="4.5" height="4.5" rx="1" />
                <rect x="0.5" y="7" width="4.5" height="4.5" rx="1" /><rect x="7" y="7" width="4.5" height="4.5" rx="1" />
                <rect x="1.5" y="3.5" width="2.5" height="0.8" fill="var(--canvas)" /><rect x="8" y="3.5" width="2.5" height="0.8" fill="var(--canvas)" />
                <rect x="1.5" y="10" width="2.5" height="0.8" fill="var(--canvas)" /><rect x="8" y="10" width="2.5" height="0.8" fill="var(--canvas)" />
              </>
            ) : (
              <>
                <rect x="0" y="0" width="5.6" height="5.6" rx="0.8" /><rect x="6.4" y="0" width="5.6" height="5.6" rx="0.8" />
                <rect x="0" y="6.4" width="5.6" height="5.6" rx="0.8" /><rect x="6.4" y="6.4" width="5.6" height="5.6" rx="0.8" />
              </>
            )}
          </svg>
        </button>
      )}

      {thumbSize !== undefined && onThumbSize && (
        <label className="flex-shrink-0 flex items-center gap-1.5" title={t.shell.thumbSizeTitle(kbd('⌘+'), kbd('⌘−'))}>
          <span className="w-2 h-2 rounded-[2px] border border-ink-3" />
          <input
            type="range"
            min={THUMB_MIN}
            max={THUMB_MAX}
            step={10}
            value={thumbSize}
            onChange={(e) => onThumbSize(Number(e.target.value))}
            className="thumb-slider w-20"
          />
          <span className="w-3 h-3 rounded-[2px] border border-ink-3" />
        </label>
      )}
    </footer>
  )
}
