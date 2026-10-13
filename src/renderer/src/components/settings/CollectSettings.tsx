import { useEffect, useRef, useState } from 'react'
import type { CollectServerStatus } from '../../../../shared/collect'
import { t } from '../../../../shared/i18n'

const GUIDE_URL = 'https://github.com/RGB-loop/Vixel/blob/main/docs/extension.md'

/**
 * 设置 › 通用 › 浏览器扩展：本地收集服务的开关、配对令牌、端口。
 * 服务默认关闭、只监听 127.0.0.1、要求令牌，从不发起对外请求（见 main/collectServer.ts）。
 */
export function CollectSettings(): JSX.Element {
  const [status, setStatus] = useState<CollectServerStatus | null>(null)
  const [port, setPort] = useState('')
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.api.collect.serverStatus().then((s) => { setStatus(s); setPort(String(s.port)) }).catch(() => {})
    return () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }
  }, [])

  const apply = (s: CollectServerStatus): void => { setStatus(s); setPort(String(s.port)) }

  const toggle = (): void => {
    if (!status) return
    setStatus({ ...status, enabled: !status.enabled })
    window.api.collect.setServer({ enabled: !status.enabled }).then(apply).catch(() => {})
  }

  const commitPort = (): void => {
    if (!status) return
    const p = Number(port)
    if (Number.isInteger(p) && p >= 1024 && p <= 65535 && p !== status.port) {
      window.api.collect.setServer({ port: p }).then(apply).catch(() => {})
    } else {
      setPort(String(status.port))
    }
  }

  const copyToken = (): void => {
    if (!status) return
    navigator.clipboard.writeText(status.token).then(() => {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  const state = !status ? '' : !status.enabled ? t.collect.extensionStopped
    : status.error ? t.collect.extensionError(status.error)
    : status.running ? t.collect.extensionRunning(status.port)
    : t.collect.extensionStopped

  return (
    <section className="settings-row flex gap-6" data-collect-settings>
      <h3 className="w-24 flex-shrink-0 text-right text-body text-ink-2 pt-1">{t.collect.extension}</h3>
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <label className="flex items-center gap-2 text-callout text-ink cursor-pointer pt-1">
          <input type="checkbox" checked={status?.enabled ?? false} onChange={toggle} className="accent-[var(--accent)]" data-collect-server-toggle />
          {t.collect.extensionEnable}
          <span className={`text-caption ${status?.error && status.enabled ? 'text-bad' : 'text-ink-3'}`}>{state}</span>
        </label>
        <p className="text-caption text-ink-4">
          {t.collect.extensionNote}{' '}
          <button onClick={() => { void window.api.collect.openSource(GUIDE_URL) }} className="text-accent hover:underline">
            {t.collect.installGuide}
          </button>
        </p>

        {status?.enabled && (
          <div className="flex flex-col gap-2.5 mt-1 p-3 rounded-lg bg-fill">
            <div className="flex items-center gap-2">
              <span className="w-16 flex-shrink-0 text-caption text-ink-3">{t.collect.token}</span>
              <code className="flex-1 min-w-0 truncate px-2 py-1 rounded bg-raised border border-line text-caption text-ink select-text" data-collect-token>
                {status.token}
              </code>
              <button onClick={copyToken} className="flex-shrink-0 h-6 px-2 rounded-md bg-fill-hover hover:bg-fill-active text-caption text-ink-2 hover:text-ink transition-colors">
                {copied ? t.collect.copied : t.collect.copy}
              </button>
              <button
                onClick={() => { window.api.collect.newToken().then(apply).catch(() => {}) }}
                className="flex-shrink-0 h-6 px-2 rounded-md bg-fill-hover hover:bg-fill-active text-caption text-ink-2 hover:text-ink transition-colors"
              >
                {t.collect.regenerate}
              </button>
            </div>
            <p className="text-micro text-ink-4 -mt-1 pl-[72px]">{t.collect.tokenNote}</p>
            <div className="flex items-center gap-2">
              <span className="w-16 flex-shrink-0 text-caption text-ink-3">{t.collect.port}</span>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                onBlur={commitPort}
                onKeyDown={(e) => { if (e.key === 'Enter') commitPort() }}
                className="w-20 h-6 px-2 rounded bg-raised border border-line text-caption text-ink tabular-nums focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
