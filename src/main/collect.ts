/**
 * 收集箱（主进程）：把拖入 / 粘贴 / 浏览器扩展收来的内容存进一个由 Vixel 管理的监视文件夹。
 *
 * - 已有文件夹继续原地索引，从不复制、不修改；只有"收进来"的东西才写进收集箱
 * - 收集箱默认 ~/Pictures/Vixel Inbox（Windows：%USERPROFILE%\Pictures\Vixel Inbox），第一次收集时创建并登记
 *   为监视文件夹（watched_folders.is_inbox = 1）；文件放 YYYY/MM/<文件名>，同名不覆盖
 * - 写盘前按内容判重：库里任何地方已有相同内容就不再存一份，只补来源 / 标签并定位到已有的那张
 * - 新文件交给 watcher 正常入库（和用户自己往文件夹里放文件一样），这里只等它登记好再告诉界面去定位
 *
 * 唯一的联网例外：用户从浏览器拖进来的只有图片地址（没有字节）时，由主进程按这一个地址下载一次。
 * 这是用户的显式操作，只请求被拖入的那个 URL，有大小 / 类型 / 超时限制；渲染进程的网络白名单仍然为空。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir, writeFile, readFile, stat, copyFile, utimes, open, readdir } from 'fs/promises'
import { constants as fsConstants, existsSync } from 'fs'
import { join, resolve, sep, basename } from 'path'
import { COLLECT_CHANNELS, type CollectResult, type CollectVia, type InboxInfo } from '../shared/collect'
import { CollectStore } from '../core/collectStore'
import { TagStore } from '../core/tagStore'
import { classifyMedia, hashImageContent, type FileWatcher } from '../core/watcher'
import { sanitizeStem, splitName, monthDir, uniqueFileName, sniffImageExt, stemFromUrl, pastedStem, isHttpUrl } from '../core/collect/paths'
import { MAX_BODY_BYTES, type CollectMeta } from '../core/collect/serverRules'
import type { DatabaseInstance } from '../core/db'
import { t } from '../shared/i18n'
import { CollectServer } from './collectServer'

/** 新文件等 watcher 登记的最长时间（awaitWriteFinish 2 s + 算 hash） */
const REGISTER_TIMEOUT_MS = 15_000
/** 拖入地址时的下载超时 */
const DOWNLOAD_TIMEOUT_MS = 20_000
/** 复制整个文件夹进收集箱时最多处理这么多个文件 */
const MAX_FOLDER_FILES = 10_000
/** 音视频判重时比较的头尾字节数 */
const PROBE_BYTES = 64 * 1024

export interface CollectDeps {
  db: DatabaseInstance
  watcher: FileWatcher
  broadcastLibraryChanged: () => void
  broadcastTagsChanged: () => void
  getMainWindow: () => BrowserWindow | null
}

interface SaveOptions {
  stem?: string
  source?: { url?: string; pageUrl?: string; pageTitle?: string }
  tags?: string[]
}

type SaveOutcome =
  | { status: 'saved'; filePath: string; fileHash: string }
  | { status: 'exists'; photoId: number; fileHash: string }
  | { status: 'skipped'; reason: string }

const emptyResult = (via: CollectVia): CollectResult => ({
  saved: 0, existing: 0, skipped: 0, addedFolders: 0, revealPhotoId: null, revealFolderId: null, createdPaths: [], via,
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class Collector {
  readonly store: CollectStore
  private tags: TagStore
  /** 本次运行里由收集箱新建的文件：撤销只认这些 */
  private created = new Set<string>()

  constructor(private deps: CollectDeps) {
    this.store = new CollectStore(deps.db.raw)
    this.tags = new TagStore(deps.db.raw)
  }

  defaultInboxPath(): string {
    return join(app.getPath('pictures'), 'Vixel Inbox')
  }

  inboxInfo(): InboxInfo {
    const inbox = this.store.getInbox()
    const path = inbox?.path ?? this.defaultInboxPath()
    return { folderId: inbox?.id ?? null, path, exists: existsSync(path) }
  }

  /** 确保收集箱目录存在并登记为监视文件夹；返回 { id, path } */
  async ensureInbox(): Promise<{ id: number; path: string }> {
    const cur = this.store.getInbox()
    if (cur) {
      await mkdir(cur.path, { recursive: true })
      return cur
    }
    const path = this.defaultInboxPath()
    await mkdir(path, { recursive: true })
    return this.registerAsInbox(path)
  }

  /** 把某个目录设为收集箱：已是监视文件夹就只打标记，否则先登记再监视。旧收集箱保留为普通文件夹 */
  registerAsInbox(path: string): { id: number; path: string } {
    const { db, watcher } = this.deps
    let folder = this.store.folderByPath(path)
    if (!folder) {
      const added = db.addFolder(path)
      folder = { id: added.id, path: added.path }
      watcher.watchFolder(folder.id, folder.path)
    }
    this.store.markInbox(folder.id)
    this.deps.broadcastLibraryChanged()
    return folder
  }

  private isInsideInbox(filePath: string): boolean {
    const inbox = this.store.getInbox()
    if (!inbox) return false
    const root = resolve(inbox.path) + sep
    return resolve(filePath).startsWith(root)
  }

  /** 收集箱里 YYYY/MM/ 下一个不冲突的文件名，目录不存在就建 */
  private async targetPath(stem: string, ext: string): Promise<string> {
    const inbox = await this.ensureInbox()
    const dir = join(inbox.path, ...monthDir(new Date()).split('/'))
    await mkdir(dir, { recursive: true })
    return join(dir, uniqueFileName(stem, ext, (name) => existsSync(join(dir, name))))
  }

  /** 补来源和标签（新存的、已存在的都补） */
  private annotate(fileHash: string, opts: SaveOptions): void {
    if (opts.source) this.store.setSource(fileHash, opts.source)
    let tagged = false
    for (const name of opts.tags ?? []) {
      if (name.trim()) { this.tags.add([fileHash], name); tagged = true }
    }
    if (tagged) this.deps.broadcastTagsChanged()
  }

  /** 存一张图片的字节：按文件头识别格式，按内容判重，写进收集箱 */
  async saveImageBytes(bytes: Buffer, opts: SaveOptions = {}): Promise<SaveOutcome> {
    const ext = sniffImageExt(bytes)
    if (!ext) return { status: 'skipped', reason: 'not_image' }
    const fileHash = await hashImageContent(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    const existing = this.store.liveImageByHash(fileHash)
    if (existing != null) {
      this.annotate(fileHash, opts)
      return { status: 'exists', photoId: existing, fileHash }
    }
    const target = await this.targetPath(sanitizeStem(opts.stem), ext)
    await writeFile(target, bytes, { flag: 'wx' })
    this.created.add(target)
    this.annotate(fileHash, opts)
    return { status: 'saved', filePath: target, fileHash }
  }

  /** 音视频是否已在库里：同大小的存活文件逐个比头尾 64 KB */
  private async sameMediaInLibrary(srcPath: string, size: number): Promise<string | null> {
    const probe = async (p: string): Promise<Buffer | null> => {
      try {
        const fh = await open(p, 'r')
        try {
          const n = Math.min(PROBE_BYTES, size)
          const head = Buffer.alloc(n)
          const tail = Buffer.alloc(n)
          await fh.read(head, 0, n, 0)
          await fh.read(tail, 0, n, Math.max(0, size - n))
          return Buffer.concat([head, tail])
        } finally {
          await fh.close()
        }
      } catch {
        return null
      }
    }
    const candidates = this.store.videoPathsBySize(size)
    if (candidates.length === 0) return null
    const src = await probe(srcPath)
    if (!src) return null
    for (const c of candidates) {
      const other = await probe(c)
      if (other && other.equals(src)) return c
    }
    return null
  }

  /** 复制一个本地文件进收集箱（图片按内容判重；音视频按大小 + 头尾字节判重） */
  private async copyFileIn(srcPath: string): Promise<SaveOutcome> {
    const kind = classifyMedia(srcPath)
    if (!kind) return { status: 'skipped', reason: 'unsupported' }
    const st = await stat(srcPath)
    const { stem, ext } = splitName(basename(srcPath))
    if (kind === 'image') {
      const bytes = await readFile(srcPath)
      const fileHash = await hashImageContent(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      const existing = this.store.liveImageByHash(fileHash)
      if (existing != null) return { status: 'exists', photoId: existing, fileHash }
      const target = await this.targetPath(sanitizeStem(stem), ext)
      await writeFile(target, bytes, { flag: 'wx' })
      await utimes(target, st.atime, st.mtime).catch(() => {})
      this.created.add(target)
      return { status: 'saved', filePath: target, fileHash }
    }
    if (this.store.hasVideoAt(srcPath)) return { status: 'exists', photoId: this.store.videoFrameByPath(srcPath) ?? -1, fileHash: '' }
    const dup = await this.sameMediaInLibrary(srcPath, st.size)
    if (dup) return { status: 'exists', photoId: this.store.videoFrameByPath(dup) ?? -1, fileHash: '' }
    const target = await this.targetPath(sanitizeStem(stem), ext)
    await copyFile(srcPath, target, fsConstants.COPYFILE_EXCL)
    // 保留原修改时间：没有拍摄时间的文件按它排序
    await utimes(target, st.atime, st.mtime).catch(() => {})
    this.created.add(target)
    return { status: 'saved', filePath: target, fileHash: '' }
  }

  /** 递归列出文件夹里支持的媒体文件（跳过隐藏文件），最多 MAX_FOLDER_FILES 个 */
  private async listMedia(dir: string, out: string[] = []): Promise<string[]> {
    if (out.length >= MAX_FOLDER_FILES) return out
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (out.length >= MAX_FOLDER_FILES) break
      if (e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) await this.listMedia(p, out)
      else if (e.isFile() && classifyMedia(p)) out.push(p)
    }
    return out
  }

  /** 等新文件被 watcher 登记成 photo（音视频等代表帧），超时返回 null */
  private async waitForPhoto(filePath: string): Promise<number | null> {
    const isMedia = classifyMedia(filePath) !== 'image'
    const deadline = Date.now() + REGISTER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const id = isMedia ? this.store.videoFrameByPath(filePath) : this.store.photoByPath(filePath)?.id ?? null
      if (id != null) return id
      await sleep(300)
    }
    return null
  }

  /** 汇总若干次保存的结果；定位到第一项（新文件等登记完） */
  private async finish(result: CollectResult, outcomes: SaveOutcome[], error?: string): Promise<CollectResult> {
    for (const o of outcomes) {
      if (o.status === 'saved') { result.saved++; result.createdPaths.push(o.filePath) }
      else if (o.status === 'exists') result.existing++
      else result.skipped++
    }
    if (error) result.error = error
    const first = outcomes.find((o) => o.status !== 'skipped')
    if (first?.status === 'exists' && first.photoId > 0) {
      result.revealPhotoId = first.photoId
      result.revealFolderId = this.store.folderOfPhoto(first.photoId)
    } else if (first?.status === 'saved') {
      result.revealFolderId = this.store.getInbox()?.id ?? null
      result.revealPhotoId = await this.waitForPhoto(first.filePath)
    }
    if (result.saved > 0) this.deps.broadcastLibraryChanged()
    return result
  }

  /** 收字节（粘贴、从浏览器拖入的图片数据、浏览器扩展） */
  async importBytes(bytes: Buffer, opts: SaveOptions & { via: CollectVia }): Promise<CollectResult> {
    const result = emptyResult(opts.via)
    const outcome = await this.saveImageBytes(bytes, opts)
    return this.finish(result, [outcome], outcome.status === 'skipped' ? t.collect.notImage : undefined)
  }

  /**
   * 从浏览器拖进来的只有地址：主进程下载这一个 URL（见文件头的说明）。
   * 只放行 http(s)，限时 DOWNLOAD_TIMEOUT_MS、限大小 MAX_BODY_BYTES，内容必须是认识的图片。
   */
  async importUrl(url: string, pageUrl?: string): Promise<CollectResult> {
    const result = emptyResult('url')
    if (!isHttpUrl(url)) return { ...result, skipped: 1, error: t.collect.badUrl }
    let bytes: Buffer
    try {
      bytes = await downloadImage(url)
    } catch (err) {
      return { ...result, skipped: 1, error: t.collect.downloadFailed(err instanceof Error ? err.message : String(err)) }
    }
    const outcome = await this.saveImageBytes(bytes, {
      stem: stemFromUrl(url) ?? undefined,
      source: { url, pageUrl: isHttpUrl(pageUrl) ? pageUrl : undefined },
    })
    return this.finish(result, [outcome], outcome.status === 'skipped' ? t.collect.notImage : undefined)
  }

  /**
   * 拖入本地文件 / 文件夹：文件复制进收集箱；文件夹先问用户——
   * 默认"添加为监视文件夹"（原地索引，和 Vixel 一贯的做法一致），或"复制到收集箱"。
   */
  async importPaths(paths: string[], win: BrowserWindow | null): Promise<CollectResult> {
    const result = emptyResult('drop')
    const files: string[] = []
    const dirs: string[] = []
    for (const p of paths) {
      try {
        const st = await stat(p)
        if (st.isDirectory()) dirs.push(p)
        else if (st.isFile()) files.push(p)
      } catch { result.skipped++ }
    }
    let copyDirs: string[] = []
    if (dirs.length > 0) {
      const opts = {
        type: 'question' as const,
        message: t.collect.folderDropTitle(dirs.length),
        detail: t.collect.folderDropDetail,
        buttons: [t.collect.addAsWatched, t.collect.copyToInbox, t.common.cancel],
        defaultId: 0,
        cancelId: 2,
      }
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      if (response === 2) return { ...result, cancelled: true }
      if (response === 0) {
        for (const d of dirs) {
          const existing = this.store.folderByPath(d)
          if (existing) { result.revealFolderId ??= existing.id; continue }
          const added = this.deps.db.addFolder(d)
          this.deps.watcher.watchFolder(added.id, added.path)
          result.addedFolders++
          result.revealFolderId ??= added.id
        }
        if (result.addedFolders > 0) this.deps.broadcastLibraryChanged()
      } else {
        copyDirs = dirs
      }
    }
    for (const d of copyDirs) files.push(...(await this.listMedia(d)))
    const outcomes: SaveOutcome[] = []
    for (const f of files) {
      try { outcomes.push(await this.copyFileIn(f)) } catch (err) {
        console.warn('[collect] copy failed:', f, err)
        outcomes.push({ status: 'skipped', reason: 'io' })
      }
    }
    if (outcomes.length === 0) return result
    const folderReveal = result.revealFolderId
    const done = await this.finish(result, outcomes)
    // 只加了文件夹、没有文件：定位到那个文件夹
    if (done.revealFolderId == null) done.revealFolderId = folderReveal
    return done
  }

  /** 撤销：把这次新建的文件移到废纸篓（只认本次运行里收集箱新建的文件） */
  async undo(paths: string[]): Promise<number> {
    let n = 0
    for (const p of paths) {
      if (!this.created.has(p) || !this.isInsideInbox(p)) continue
      try {
        await shell.trashItem(p)
        this.created.delete(p)
        n++
      } catch (err) {
        console.warn('[collect] undo failed:', p, err)
      }
    }
    return n
  }
}

/** 下载一张图片（见 importUrl）；超过大小 / 超时 / 非 2xx 都抛错 */
async function downloadImage(url: string): Promise<Buffer> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    // Node 的 fetch（不是 Electron session），不受渲染进程的离线拦截影响；这里是唯一的调用点
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { Accept: 'image/*' } })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const type = res.headers.get('content-type')
    if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) throw new Error(type)
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_BODY_BYTES) throw new Error('too large')
    const chunks: Buffer[] = []
    let total = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('too large') }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } finally {
    clearTimeout(timer)
  }
}

/** 渲染进程收到的通知：有新内容收进来了 */
function notifyCollected(deps: CollectDeps, result: CollectResult): void {
  deps.getMainWindow()?.webContents.send(COLLECT_CHANNELS.COLLECTED, result)
}

export function registerCollectIpc(deps: CollectDeps): { collector: Collector; server: CollectServer } {
  const collector = new Collector(deps)
  const server = new CollectServer(deps.db, async (bytes: Buffer, meta: CollectMeta) => {
    const result = await collector.importBytes(bytes, {
      via: 'extension',
      stem: meta.name ?? stemFromUrl(meta.url ?? '') ?? meta.pageTitle,
      source: { url: isHttpUrl(meta.url) ? meta.url : undefined, pageUrl: isHttpUrl(meta.pageUrl) ? meta.pageUrl : undefined, pageTitle: meta.pageTitle },
      tags: meta.tags,
    })
    notifyCollected(deps, result)
    return result
  })
  server.startIfEnabled()

  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

  ipcMain.handle(COLLECT_CHANNELS.GET_INBOX, async () => collector.inboxInfo())

  ipcMain.handle(COLLECT_CHANNELS.CHOOSE_INBOX, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, defaultPath: collector.inboxInfo().path }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return collector.inboxInfo()
    collector.registerAsInbox(r.filePaths[0])
    return collector.inboxInfo()
  })

  ipcMain.handle(COLLECT_CHANNELS.OPEN_INBOX, async () => {
    const inbox = await collector.ensureInbox()
    await shell.openPath(inbox.path)
  })

  ipcMain.handle(COLLECT_CHANNELS.IMPORT_PATHS, async (event, paths: unknown) => {
    return collector.importPaths(strings(paths), BrowserWindow.fromWebContents(event.sender))
  })

  // 格式以文件头为准，不看渲染进程给的 MIME
  ipcMain.handle(COLLECT_CHANNELS.IMPORT_BYTES, async (_e, data: unknown, name: unknown, via: unknown) => {
    if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_BODY_BYTES) return { ...emptyResult('paste'), skipped: 1, error: t.collect.notImage }
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const stem = typeof name === 'string' && name ? splitName(name).stem : via === 'paste' ? pastedStem(new Date()) : undefined
    return collector.importBytes(bytes, { via: via === 'drop' ? 'drop' : 'paste', stem })
  })

  ipcMain.handle(COLLECT_CHANNELS.IMPORT_URL, async (_e, url: unknown, pageUrl: unknown) => {
    if (typeof url !== 'string') return { ...emptyResult('url'), skipped: 1, error: t.collect.badUrl }
    return collector.importUrl(url, typeof pageUrl === 'string' ? pageUrl : undefined)
  })

  ipcMain.handle(COLLECT_CHANNELS.UNDO, async (_e, paths: unknown) => collector.undo(strings(paths)))

  ipcMain.handle(COLLECT_CHANNELS.GET_SOURCE, async (_e, fileHash: unknown) => {
    return typeof fileHash === 'string' ? collector.store.getSource(fileHash) : null
  })

  // 来源链接：只在用户点击时、只开 http(s)，交给系统浏览器
  ipcMain.handle(COLLECT_CHANNELS.OPEN_SOURCE, async (_e, url: unknown) => {
    if (isHttpUrl(url)) await shell.openExternal(url)
  })

  ipcMain.handle(COLLECT_CHANNELS.SERVER_STATUS, async () => server.status())
  ipcMain.handle(COLLECT_CHANNELS.SERVER_SET, async (_e, patch: unknown) => server.update(patch))
  ipcMain.handle(COLLECT_CHANNELS.SERVER_NEW_TOKEN, async () => server.regenerateToken())

  app.on('before-quit', () => server.stop())
  return { collector, server }
}
