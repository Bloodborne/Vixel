import { useEffect, useState } from 'react'
import type { AutoTagStatus } from '../../../../shared/autotags'
import { t } from '../../../../shared/i18n'

/** 设置 › 通用：自动标签开关 + 重新生成 + 进度 */
export function AutoTagSettings(): JSX.Element {
  const [status, setStatus] = useState<AutoTagStatus | null>(null)

  useEffect(() => {
    window.api.autoTags.status().then(setStatus).catch(() => {})
    return window.api.autoTags.onChanged(setStatus)
  }, [])

  const toggle = (): void => {
    if (!status) return
    setStatus({ ...status, enabled: !status.enabled })
    window.api.autoTags.setEnabled(!status.enabled).then(setStatus).catch(() => {})
  }

  const progress = !status ? '' : status.waitingForLibrary ? t.autotags.waiting
    : status.running && status.pending > 0 ? t.autotags.running(status.done, status.done + status.pending)
    : t.autotags.upToDate(status.done)

  return (
    <section className="flex gap-6" data-autotag-settings>
      <h3 className="w-24 flex-shrink-0 text-right text-body text-ink-2 pt-1">{t.autotags.settingTitle}</h3>
      <div className="flex flex-col gap-2 min-w-0">
        <label className="flex items-center gap-2 text-callout text-ink cursor-pointer pt-1">
          <input type="checkbox" checked={status?.enabled ?? true} onChange={toggle} className="accent-[var(--accent)]" />
          {t.autotags.settingOn}
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.api.autoTags.rerun().then(setStatus).catch(() => {})}
            disabled={!status?.enabled || status.running}
            className="h-7 px-3 rounded-md bg-fill-hover hover:bg-fill-active text-ink text-callout disabled:opacity-40 disabled:hover:bg-fill-hover"
          >
            {t.autotags.rerun}
          </button>
          {status?.enabled && <span className="text-caption text-ink-3 tabular-nums">{progress}</span>}
        </div>
        <p className="text-caption text-ink-4">{t.autotags.settingNote}</p>
      </div>
    </section>
  )
}
