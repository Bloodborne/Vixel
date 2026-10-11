import { useState, useEffect, useCallback } from 'react'
import type { ModelStatus as ModelStatusType, EmbeddingConfig, BackupStatus } from '../../../shared/types'
import { t, intlLocale } from '../../../shared/i18n'

type Backend = EmbeddingConfig['backend']
const BACKENDS: Array<{ value: Backend; label: string }> = [
  { value: 'auto', label: t.model.backendAuto },
  { value: 'gpu', label: 'GPU' },
  { value: 'cpu', label: 'CPU' },
]

/**
 * 模型状态面板
 *
 * 唯一 embedding 通道：本地 EmbeddingGemma 2（文本/图像/音频/视频，768D），经 LiteRT 推理
 * 高级：选择推理后端（自动 = GPU 优先，不可用时 CPU）
 */
export function ModelStatus(): JSX.Element {
  const [status, setStatus] = useState<ModelStatusType | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [embedConfig, setEmbedConfig] = useState<EmbeddingConfig>({ backend: 'auto' })
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)
  const [ocrScanState, setOcrScanState] = useState<{ scanning: boolean; message: string | null }>({
    scanning: false,
    message: null,
  })
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const result = await window.api.getModelStatus()
      setStatus(result)

      setEmbedConfig(await window.api.getEmbeddingConfig())

      const bs = await window.api.getBackupStatus()
      setBackupStatus(bs)
    } catch (error) {
      console.error('Failed to get model status:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const triggerBackup = async (): Promise<void> => {
    setBackupBusy(true)
    setBackupMessage(null)
    try {
      const r = await window.api.triggerBackup()
      if (r.success) {
        const mb = r.sizeBytes ? (r.sizeBytes / 1024 / 1024).toFixed(1) : '?'
        setBackupMessage(t.model.backupDone(mb))
      } else {
        setBackupMessage(t.model.failed(String(r.error)))
      }
      const bs = await window.api.getBackupStatus()
      setBackupStatus(bs)
    } catch (e) {
      setBackupMessage(t.model.failed(String(e)))
    } finally {
      setBackupBusy(false)
    }
  }

  const saveBackend = async (backend: Backend): Promise<void> => {
    setSaving(true)
    setSaveResult(null)
    try {
      const r = await window.api.setEmbeddingConfig({ backend })
      setSaveResult(r.success ? t.model.backendSwitched(!!r.ready) : t.model.failed(String(r.error)))
      await loadStatus()
    } finally {
      setSaving(false)
    }
  }

  const startOcrScan = async (): Promise<void> => {
    setOcrScanState({ scanning: true, message: null })
    try {
      const r = await window.api.startOcrScan()
      if (r.error) {
        setOcrScanState({ scanning: false, message: t.model.failed(String(r.error)) })
      } else {
        setOcrScanState({
          scanning: false,
          message: r.queued && r.queued > 0
            ? t.model.ocrQueued(r.queued)
            : t.model.ocrNothing,
        })
      }
    } catch (e) {
      setOcrScanState({ scanning: false, message: t.model.failed(String(e)) })
    }
  }

  if (loading) {
    return (
      <div className="p-5 text-center">
        <svg className="w-5 h-5 mx-auto animate-spin text-ink-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="mt-2 text-callout text-ink-3">{t.model.checking}</p>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="p-5 text-center text-bad text-callout">{t.model.checkFailed}</div>
    )
  }

  const localReady = status.localModelExists && status.embeddingReady
  const localMissing = !status.localModelExists

  return (
    <div className="p-5 space-y-5">
      <div>
        <h3 className="text-callout font-semibold text-ink mb-0.5">{t.model.semanticTitle}</h3>
        <p className="text-caption text-ink-3">{t.model.semanticDesc}</p>
      </div>

      {/* 主状态 */}
      <div className={`p-3 rounded-lg ${localReady ? 'bg-ok/10' : localMissing ? 'bg-warn/10' : 'bg-fill'}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${localReady ? 'bg-ok' : localMissing ? 'bg-warn' : 'bg-fill-active'}`} />
          <div className="flex-1">
            {localReady && (
              <p className="text-caption text-ok/80">
                {t.model.ready}{status.activeBackend ? ` · ${status.activeBackend === 'gpu' ? t.model.gpu : t.model.cpu}` : ''}
              </p>
            )}
            {localMissing && (
              <>
                <p className="text-caption text-warn/80">{t.model.missing}</p>
                <p className="text-micro text-ink-3 mt-0.5">
                  {t.model.devHint} <code className="bg-fill px-1 rounded">npm run models:download</code>
                </p>
              </>
            )}
            {status.initError && (
              <p className="text-micro text-bad/80 mt-1">{status.initError}</p>
            )}
          </div>
        </div>
      </div>

      <div className="text-micro text-ink-3">
        <p>{t.model.modelsDir}</p>
        <code className="text-micro bg-fill px-2 py-1 rounded block break-all text-ink-3 mt-1">
          {status.modelsDir}
        </code>
      </div>

      {/* OCR */}
      <div className="pt-4 border-t border-line">
        <h3 className="text-callout font-semibold text-ink mb-0.5">{t.model.ocrTitle}</h3>
        <p className="text-caption text-ink-3 mb-2">
          {t.model.ocrDesc}
        </p>
        <button
          onClick={startOcrScan}
          disabled={ocrScanState.scanning}
          className="w-full py-1.5 px-3 bg-fill hover:bg-fill-hover disabled:opacity-30 text-ink-2 text-callout rounded-md"
        >
          {ocrScanState.scanning ? t.model.ocrQueuing : t.model.ocrStart}
        </button>
        {ocrScanState.message && (
          <p className={`text-caption mt-1.5 ${ocrScanState.message.startsWith(t.model.failed('')) ? 'text-bad' : 'text-ok'}`}>
            {ocrScanState.message}
          </p>
        )}
      </div>

      {/* 数据库备份 */}
      <div className="pt-4 border-t border-line">
        <h3 className="text-callout font-semibold text-ink mb-0.5">{t.model.backupTitle}</h3>
        <p className="text-caption text-ink-3 mb-2">
          {t.model.backupDesc}
        </p>
        {backupStatus && (
          <div className="text-micro text-ink-3 mb-2 space-y-0.5">
            <div>
              {t.model.lastBackup}{backupStatus.lastBackupAt
                ? new Date(backupStatus.lastBackupAt).toLocaleString(intlLocale())
                : t.model.never}
            </div>
            <div>
              {t.model.kept}{backupStatus.currentCount} / {backupStatus.keepCount}
            </div>
          </div>
        )}
        <button
          onClick={triggerBackup}
          disabled={backupBusy || backupStatus?.inProgress}
          className="w-full py-1.5 px-3 bg-fill hover:bg-fill-hover disabled:opacity-30 text-ink-2 text-callout rounded-md"
        >
          {backupBusy ? t.model.backingUp : t.model.backupNow}
        </button>
        {backupMessage && (
          <p className={`text-caption mt-1.5 ${backupMessage.startsWith(t.model.failed('')) ? 'text-bad' : 'text-ok'}`}>
            {backupMessage}
          </p>
        )}
      </div>

      {/* 高级：推理后端 */}
      <div className="pt-4 border-t border-line">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-caption text-ink-3 hover:text-ink-2 transition-colors"
        >
          {showAdvanced ? '▾' : '▸'} {t.model.advancedBackend}
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-2.5">
            <p className="text-micro text-ink-3">
              {t.model.backendNote}
            </p>
            <div className="flex gap-1">
              {BACKENDS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => saveBackend(value)}
                  disabled={saving || embedConfig.backend === value}
                  className={`py-1 px-2.5 text-caption rounded-md disabled:cursor-default ${
                    embedConfig.backend === value
                      ? 'bg-accent/20 text-accent'
                      : 'bg-fill hover:bg-fill-hover text-ink-2 disabled:opacity-30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {saveResult && (
              <p className={`text-caption ${saveResult.startsWith(t.model.failed('')) ? 'text-bad' : 'text-ok'}`}>
                {saveResult}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
