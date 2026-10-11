import { useCallback, useEffect, useMemo, useState } from 'react'
import { t } from '../../../../shared/i18n'
import type { DupGroup, DupItem, DupScanProgress, DupScanResult, HiddenItem } from '../../../../shared/cleanup'
import { formatFileSize } from '../../lib/format'
import { thumbUrl } from '../../lib/mediaUrl'
import { IS_MAC } from '../../lib/platform'
import { Icon } from '../shell/icons'

const bin = (): string => (IS_MAC ? t.cleanup.binMac : t.cleanup.binWin)

/**
 * 清理相似照片：扫描近重复组 → 每组默认保留一张（像素最多的）→ 多余的在 Vixel 中隐藏，或确认后移到废纸篓。
 * 点击缩略图切换保留 / 多余；双击打开详情。每组至少保留一张。
 */
export function CleanupView({ onOpenPhoto }: { onOpenPhoto: (photoId: number) => void }): JSX.Element {
  const [result, setResult] = useState<DupScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<DupScanProgress | null>(null)
  // 每组用户选定的“保留”集合；没动过的组用扫描给的建议
  const [keepOverride, setKeepOverride] = useState<Map<string, Set<string>>>(new Map())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [hidden, setHidden] = useState<HiddenItem[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshHidden = useCallback(() => {
    window.api.cleanup.listHidden().then(setHidden).catch(() => {})
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    setProgress(null)
    try {
      const r = await window.api.cleanup.scan()
      setResult(r)
      setKeepOverride(new Map())
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => window.api.cleanup.onProgress(setProgress), [])
  // 打开即扫描：库没变时主进程直接返回缓存
  useEffect(() => { void scan(); refreshHidden() }, [scan, refreshHidden])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const groups = useMemo(() => (result?.groups ?? []).filter((g) => !dismissed.has(g.id)), [result, dismissed])
  const keepSet = useCallback(
    (g: DupGroup): Set<string> => keepOverride.get(g.id) ?? new Set([g.keeperHash]),
    [keepOverride]
  )
  const extrasOf = useCallback((g: DupGroup): DupItem[] => g.items.filter((i) => !keepSet(g).has(i.fileHash)), [keepSet])

  const toggle = (g: DupGroup, hash: string): void => {
    const next = new Set(keepSet(g))
    if (next.has(hash)) {
      if (next.size === 1) return // 每组至少留一张
      next.delete(hash)
    } else {
      next.add(hash)
    }
    setKeepOverride((m) => new Map(m).set(g.id, next))
  }

  const hideExtras = async (gs: DupGroup[]): Promise<void> => {
    const hashes = gs.flatMap((g) => extrasOf(g).map((i) => i.fileHash))
    if (hashes.length === 0) return
    setBusy(true)
    try {
      await window.api.cleanup.hide(hashes)
      refreshHidden()
      await scan()
    } finally {
      setBusy(false)
    }
  }

  const trashExtras = async (gs: DupGroup[]): Promise<void> => {
    const hashes = gs.flatMap((g) => extrasOf(g).map((i) => i.fileHash))
    if (hashes.length === 0) return
    setBusy(true)
    try {
      const r = await window.api.cleanup.trash(hashes)
      if (r.cancelled) return
      setToast(t.cleanup.trashDone(r.trashed, r.failed))
      await scan()
    } finally {
      setBusy(false)
    }
  }

  const unhide = async (hashes: string[]): Promise<void> => {
    await window.api.cleanup.unhide(hashes)
    refreshHidden()
    await scan()
  }

  const photoCount = groups.reduce((s, g) => s + g.items.length, 0)
  const reclaim = groups.reduce((s, g) => s + extrasOf(g).reduce((a, i) => a + i.fileSize * Math.max(1, i.copies), 0), 0)

  return (
    <div className="relative h-full flex flex-col bg-canvas">
      <header className="px-4 pt-4 pb-3 border-b border-line flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          {/* 工具栏已经显示“清理相似照片”，这里只放摘要 */}
          {showHidden ? (
            <h2 className="text-headline text-ink">{t.cleanup.hidden(hidden.length)}</h2>
          ) : result && !scanning && groups.length > 0 ? (
            <h2 className="text-headline text-ink tabular-nums">{t.cleanup.summary(groups.length, photoCount, formatFileSize(reclaim))}</h2>
          ) : null}
          <span className="flex-1" />
          {showHidden ? (
            <button onClick={() => setShowHidden(false)} className="text-callout text-ink-3 hover:text-ink">{t.cleanup.back}</button>
          ) : (
            <>
              <button onClick={() => setShowHidden(true)} className="text-callout text-ink-3 hover:text-ink">
                {t.cleanup.hidden(hidden.length)}
              </button>
              <button
                onClick={() => void scan()}
                disabled={scanning || busy}
                className="px-3 py-1 rounded-md bg-accent/20 hover:bg-accent/30 disabled:opacity-50 text-accent text-callout transition-colors duration-fast"
              >
                {result ? t.cleanup.rescan : t.cleanup.scan}
              </button>
            </>
          )}
        </div>
        {!showHidden && <p className="text-caption text-ink-3 max-w-[720px]">{t.cleanup.intro}</p>}
        {scanning && (
          <div className="flex items-center gap-2 text-caption text-ink-2" data-cleanup-progress>
            <span className="tabular-nums">{progress ? t.cleanup.scanning(progress.done, progress.total) : t.cleanup.scanning(0, result?.scanned ?? 0)}</span>
            {progress && progress.total > 0 && (
              <span className="w-40 h-[3px] bg-fill-active rounded-full overflow-hidden">
                <span className="block h-full bg-accent rounded-full transition-[width] duration-view" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </span>
            )}
          </div>
        )}
      </header>

      {showHidden ? (
        <HiddenList items={hidden} onUnhide={unhide} />
      ) : !result ? (
        scanning ? null : <p className="p-6 text-callout text-ink-3">{t.cleanup.notScanned}</p>
      ) : groups.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Icon name="stack" className="w-12 h-12 mx-auto mb-3 text-ink-ghost" />
            <p className="text-body text-ink-2">{t.cleanup.noGroups}</p>
            <p className="text-caption text-ink-3 mt-1">{t.cleanup.noGroupsHint(result.scanned)}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 py-2 border-b border-line bg-bar flex items-center gap-2 flex-wrap">
            <span className="text-caption text-ink-3">{t.cleanup.toggleHint}</span>
            <span className="flex-1" />
            <span className="text-caption text-ink-2">{t.cleanup.applyAll(groups.length)}</span>
            <ActionButton onClick={() => void hideExtras(groups)} disabled={busy} title={t.cleanup.hideExtrasTitle}>{t.cleanup.hideExtras}</ActionButton>
            <ActionButton onClick={() => void trashExtras(groups)} disabled={busy} danger>{t.cleanup.trashExtras(bin())}</ActionButton>
          </div>
          <div className="flex-1 overflow-auto p-4 flex flex-col gap-3" data-cleanup-groups>
            {groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                keep={keepSet(g)}
                busy={busy}
                onToggle={(h) => toggle(g, h)}
                onOpen={onOpenPhoto}
                onHide={() => void hideExtras([g])}
                onTrash={() => void trashExtras([g])}
                onDismiss={() => { setDismissed((s) => new Set(s).add(g.id)); void window.api.cleanup.dismiss([g.id]) }}
              />
            ))}
          </div>
        </>
      )}

      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-raised border border-line text-callout text-ink shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group, keep, busy, onToggle, onOpen, onHide, onTrash, onDismiss }: {
  group: DupGroup
  keep: Set<string>
  busy: boolean
  onToggle: (hash: string) => void
  onOpen: (photoId: number) => void
  onHide: () => void
  onTrash: () => void
  onDismiss: () => void
}): JSX.Element {
  return (
    <section className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {group.items.map((item) => {
          const kept = keep.has(item.fileHash)
          return (
            <button
              key={item.fileHash}
              onClick={() => onToggle(item.fileHash)}
              onDoubleClick={() => onOpen(item.photoId)}
              title={item.fileName}
              className="flex-shrink-0 w-[160px] text-left group"
            >
              <span
                className={`relative block w-[160px] h-[120px] rounded-md overflow-hidden bg-surface-3 transition-[box-shadow,opacity] duration-fast ${
                  kept ? 'ring-2 ring-accent' : 'ring-1 ring-line opacity-60 group-hover:opacity-90'
                }`}
              >
                <img src={thumbUrl({ id: item.photoId, fileHash: item.fileHash })} alt="" loading="lazy" className="w-full h-full object-cover" draggable={false} />
                <span
                  className={`absolute top-1.5 left-1.5 px-1.5 py-[1px] rounded text-micro font-medium ${
                    kept ? 'bg-accent text-white' : 'bg-black/55 text-white/85'
                  }`}
                >
                  {kept ? t.cleanup.keep : t.cleanup.extra}
                </span>
              </span>
              <span className="block mt-1.5 text-caption text-ink-2 truncate">{item.fileName}</span>
              <span className="block text-micro text-ink-3 tabular-nums">
                {item.width && item.height ? `${item.width} × ${item.height}` : '—'}{t.common.sep}{formatFileSize(item.fileSize)}
                {item.copies > 1 ? `${t.common.sep}${t.cleanup.copies(item.copies)}` : ''}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-micro text-ink-3 tabular-nums">{t.cleanup.similarity(group.similarity)}</span>
        <span className="flex-1" />
        <button onClick={onDismiss} className="px-2 py-1 text-caption text-ink-3 hover:text-ink">{t.cleanup.dismiss}</button>
        <ActionButton onClick={onHide} disabled={busy || keep.size === group.items.length} title={t.cleanup.hideExtrasTitle}>{t.cleanup.hideExtras}</ActionButton>
        <ActionButton onClick={onTrash} disabled={busy || keep.size === group.items.length} danger>{t.cleanup.trashExtras(bin())}</ActionButton>
      </div>
    </section>
  )
}

function HiddenList({ items, onUnhide }: { items: HiddenItem[]; onUnhide: (hashes: string[]) => Promise<void> }): JSX.Element {
  if (items.length === 0) return <p className="p-6 text-callout text-ink-3">{t.cleanup.hiddenEmpty}</p>
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="mb-3 flex justify-end">
        <ActionButton onClick={() => void onUnhide(items.map((i) => i.fileHash))}>{t.cleanup.unhideAll}</ActionButton>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {items.map((item) => (
          <div key={item.fileHash} className="flex flex-col gap-1">
            <img src={thumbUrl({ id: item.photoId, fileHash: item.fileHash })} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover rounded-md bg-surface-3" draggable={false} />
            <span className="text-caption text-ink-2 truncate" title={item.fileName}>{item.fileName}</span>
            <button onClick={() => void onUnhide([item.fileHash])} className="self-start text-caption text-accent hover:underline">{t.cleanup.unhide}</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionButton({ onClick, disabled, danger, title, children }: {
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1 rounded-md text-caption whitespace-nowrap transition-colors duration-fast disabled:opacity-40 ${
        danger ? 'bg-bad/10 text-bad/90 hover:bg-bad/20' : 'bg-fill hover:bg-fill-hover text-ink-2'
      }`}
    >
      {children}
    </button>
  )
}
