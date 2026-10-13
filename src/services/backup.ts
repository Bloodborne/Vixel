/**
 * 备份服务（从 src/main/index.ts 移出，供桌面主进程与服务器共用）：
 * 每 24h 一次 SQLite Online Backup 到 <dataDir>/backups，保留最近 3 份。
 */
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, readdir, unlink, stat } from 'fs/promises'
import type { DatabaseInstance } from '../core/db'
import { formatBackupName, selectExpired } from '../core/backup'
import type { BackupStatus } from '../shared/types'

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const BACKUP_KEEP_COUNT = 3
const META_KEY_LAST_BACKUP = 'last_backup_at'

export class BackupService {
  private timer: NodeJS.Timeout | null = null
  private inFlight = false

  constructor(private db: DatabaseInstance, private dataDir: string) {}

  /**
   * 备份调度：启动 60s 后检查上次备份距今 ≥ 24h 就立刻跑一次，之后每小时检查一次"是否到点"。
   * 重启不丢节奏 —— last_backup_at 在 meta_state。
   */
  schedule(): void {
    setTimeout(() => {
      this.runIfDue().catch((err) => console.warn('Initial backup check failed:', err))
    }, 60_000)
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      this.runIfDue().catch((err) => console.warn('Periodic backup failed:', err))
    }, 60 * 60 * 1000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async runIfDue(): Promise<void> {
    const last = parseInt(this.db.getMetaState(META_KEY_LAST_BACKUP) || '0', 10)
    if (Date.now() - last < BACKUP_INTERVAL_MS) return
    await this.run()
  }

  async run(): Promise<{ path: string; sizeBytes: number }> {
    if (this.inFlight) throw new Error('A backup is already in progress')
    this.inFlight = true
    try {
      const backupsDir = join(this.dataDir, 'backups')
      if (!existsSync(backupsDir)) await mkdir(backupsDir, { recursive: true })
      const dest = join(backupsDir, formatBackupName(new Date()))

      await this.db.backupTo(dest)
      this.db.setMetaState(META_KEY_LAST_BACKUP, String(Date.now()))

      // 轮换：删除多余的旧备份（保留最近 BACKUP_KEEP_COUNT 份）
      const entries = await readdir(backupsDir)
      for (const old of selectExpired(entries, BACKUP_KEEP_COUNT)) {
        try {
          await unlink(join(backupsDir, old))
        } catch (err) {
          console.warn(`Failed to delete old backup ${old}:`, err)
        }
      }
      const sizeBytes = (await stat(dest)).size
      return { path: dest, sizeBytes }
    } finally {
      this.inFlight = false
    }
  }

  async status(): Promise<BackupStatus> {
    const last = parseInt(this.db.getMetaState(META_KEY_LAST_BACKUP) || '0', 10)
    const backupsDir = join(this.dataDir, 'backups')
    let count = 0
    if (existsSync(backupsDir)) {
      const entries = await readdir(backupsDir)
      count = entries.filter((n) => n.startsWith('library.db.bak.')).length
    }
    return {
      lastBackupAt: last || null,
      intervalMs: BACKUP_INTERVAL_MS,
      keepCount: BACKUP_KEEP_COUNT,
      currentCount: count,
      inProgress: this.inFlight,
      backupsDir,
    }
  }
}
