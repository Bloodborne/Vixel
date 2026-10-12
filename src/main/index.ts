import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net, nativeTheme, session } from 'electron'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { writeFile, unlink, mkdir, readdir, rm } from 'fs/promises'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase } from '../core/db'
import { FileWatcher } from '../core/watcher'
import { Indexer } from '../core/indexer'
import { SearchEngine, type SearchOptions } from '../core/search'
import { getEmbeddingService, initEmbeddingServicePath, isLiteRtInstalled } from '../core/embedding'
import { litertPlatformDir } from '../core/embedding/providers/litert/native'
import { setFaceModelsDir, getFaceThumbnail, FACE_PIPELINE_VERSION } from '../core/face'
import { suggestMerges } from '../core/face/cluster'
import { setOcrModelsDir } from '../core/ocr'
import { preloadJieba } from '../core/text/tokenize'
import { formatBackupName, selectExpired } from '../core/backup'
import { serveMediaFile } from '../core/media/serve'
import { parsePaletteJson } from '../core/color/palette'
import { ensureSprite, SPRITE_MIN_DURATION_MS } from '../core/video/sprite'
import { isFfmpegAvailable, probeMedia } from '../core/video/extract'
import { installAppMenu, popupItemMenu, popupSmartAlbumMenu } from './menu'
import { initQuickPanel, type QuickPanelController } from './quickPanel'
import { searchByImage } from './imageSearch'
import { initPowerPolicy, getPowerController } from './power'
import { detectScreenshot } from '../core/screenshot'
import type { AutoTagService } from './autotags'
import { locale, resolveLocale, setLocale, t, type LocaleSetting } from '../shared/i18n'
import { InferenceProcess } from './inference-client'
import { runCaptureTour, runRecording } from './capture'
import { registerCleanupIpc } from './cleanup'
import { broadcastTagsChanged, registerTagIpc } from './tags'
import { registerCollectIpc } from './collect'
import { registerAutoTags } from './autotags'
import { registerPdfRenderer, disposePdfRenderer, releasePdfWindowIfLast, PDF_ASSET_SCHEME } from './pdfRender'
import { timed, watchEventLoop, perfSnapshot, PROFILE } from '../core/perf'
import { setInferenceTransport } from '../core/inference/transport'
import { IPC_CHANNELS, type MediaFilters, type ThemeMode, type IndexProgress, type FaceBbox, type EmbeddingConfig, type PersonSuggestion, type PersonFace, type ImageQueryInput } from '../shared/types'

const APP_NAME = 'Vixel'

// 录屏模式：1280×720 窗口按 1.5 倍渲染，帧订阅直接得到 1920×1080
if (process.env.VIXEL_RECORD) app.commandLine.appendSwitch('force-device-scale-factor', '1.5')

// 开发期 app.name 默认取 package.json 的 "vixel"，菜单 / 关于面板会显示小写名。
// setName 也会改默认 userData 目录，先记下原路径再设回去，老数据不搬家。
{
  const userData = app.getPath('userData')
  app.setName(APP_NAME)
  app.setPath('userData', userData)
}
app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion() })

// 备份配置：每 24h 一次，保留最近 3 份；可后续从 settings 暴露
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const BACKUP_KEEP_COUNT = 3
const META_KEY_LAST_BACKUP = 'last_backup_at'
const META_KEY_THEME = 'ui.theme'
const META_KEY_LOCALE = 'ui.locale'
/** 设置："电池供电时也索引"（默认开）。关掉后电池供电时回填等待，少量新文件仍即时索引 */
const META_KEY_INDEX_ON_BATTERY = 'power.index_on_battery'
/** 截图标记回填完成的标记（老库一次性补 photos.is_screenshot） */
const META_KEY_SCREENSHOT_BACKFILL = 'screenshot.backfill'
let backupTimer: NodeJS.Timeout | null = null
let backupInFlight = false
/**
 * 显式退出已开始（before-quit 已发出）。退出流程里窗口逐个 close，各自的 closed 回调
 * （maybeBackgroundOrQuit）和 window-all-closed 会在 db.close() 之后触发 —— 这时再去读
 * meta_state（quickPanel.keepAliveOnWindows → getMetaState）会在已关闭的库上抛异常，
 * 主进程弹未捕获异常框、退出流程卡死（Windows 上进程退不掉）。置位后这些回调直接返回。
 */
let isQuitting = false

// 全局服务实例
let db: ReturnType<typeof initDatabase>
let watcher: FileWatcher
let indexer: Indexer
let searchEngine: SearchEngine
let inference: InferenceProcess | null = null
let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let quickPanel: QuickPanelController | null = null
let bundledModelsDir: string = ''

/** 窗口底色：首帧渲染前露出来的颜色，要和当前外观的内容区一致，否则切换 / 打开时闪一下 */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#ffffff'
}

/**
 * 外观由 nativeTheme.themeSource 统一控制：它决定所有窗口的 prefers-color-scheme，
 * 渲染进程的 CSS 变量随之切换，原生菜单 / 滚动条 / 对话框也一起跟着变。
 */
function applyTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

function loadTheme(): ThemeMode {
  const v = db.getMetaState(META_KEY_THEME)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function loadLocaleSetting(): LocaleSetting {
  const v = db.getMetaState(META_KEY_LOCALE)
  return v === 'zh-CN' || v === 'en' ? v : 'system'
}

/** 界面语言：主进程文案（菜单、对话框、任务错误）立即切换；渲染进程由调用方 reload */
function applyLocale(setting: LocaleSetting): void {
  setLocale(resolveLocale(setting, app.getPreferredSystemLanguages()))
}

const WEB_PREFERENCES: Electron.WebPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  // preload 只用 contextBridge / ipcRenderer（打包后只 require('electron')），可以开沙箱
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
}

/** 主窗口和设置窗口共用一个渲染入口，按 hash 区分（main.tsx 里路由） */
function loadRenderer(win: BrowserWindow, hash?: string): void {
  // VIXEL_PROFILE=1：渲染进程的警告 / 错误（含 [longtask]）汇进主进程日志，自动化跑一遍就能看全
  if (PROFILE) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer${hash ? `:${hash}` : ''}] ${message}${level === 3 ? ` (${sourceId}:${line})` : ''}`)
    })
  }
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    backgroundColor: windowBackground(),
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    // 红绿灯垂直居中在 52px 工具栏 / 侧边栏顶部
    trafficLightPosition: { x: 18, y: 19 },
    webPreferences: WEB_PREFERENCES,
  })
  mainWindow = win
  win.on('ready-to-show', () => {
    win.show()
    // VIXEL_CAPTURE=<目录>：自动巡检各视图并截图（见 capture.ts）
    if (process.env.VIXEL_CAPTURE) {
      void runCaptureTour(win, process.env.VIXEL_CAPTURE, openSettingsWindow, {
        // 状态栏的电源等待原因：模拟过热 + 排一个回填任务（截完撤掉，库不留痕）
        simulatePowerWait: (on) => {
          if (on) {
            const photo = db.raw.prepare(`SELECT id FROM photos WHERE deleted_at IS NULL LIMIT 1`).get() as { id: number } | undefined
            if (photo) db.raw.prepare(`INSERT INTO index_queue (photo_id, task_type, priority, origin, status) VALUES (?, 'thumbnail', 0, 'backfill', 'pending')`).run(photo.id)
            getPowerController()?.simulate({ thermalState: 'serious' })
          } else {
            getPowerController()?.simulate(null)
            db.raw.prepare(`DELETE FROM index_queue WHERE status = 'pending' AND priority = 0 AND task_type = 'thumbnail' AND origin = 'backfill'`).run()
          }
          indexer.emitProgressPublic()
        },
        // 设置 › 文件夹 的"跳过的数据集目录"列表：造一条演示记录
        seedSkippedFolder: (on) => {
          const folder = db.getFolders()[0]
          if (!folder) return
          const demoPath = join(folder.path, 'frames-export')
          if (on) db.addSkippedFolder(folder.id, demoPath, 250)
          else db.raw.prepare(`DELETE FROM skipped_folders WHERE path = ?`).run(demoPath)
          broadcastLibraryChanged()
        },
        // 快速搜索面板：同一个 show / hide（全局快捷键没法自动化，用钩子驱动）
        quickPanel: {
          show: () => quickPanel!.show(),
          hide: () => quickPanel!.hide(),
        },
      })
    }
    if (process.env.VIXEL_RECORD) void runRecording(win, process.env.VIXEL_RECORD)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    releasePdfWindowIfLast()
    maybeBackgroundOrQuit()
  })
  loadRenderer(win)
}

/** 面板里 ↩ / ⌘O 的落点：主窗口不存在（macOS 全关、Windows 托盘驻留）就重建一个 */
function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const win = mainWindow!
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

/**
 * Windows / Linux：最后一个"真窗口"（主窗口 / 设置）关掉后，若启用了快速搜索快捷键，
 * 留在后台并挂一个托盘图标（打开 Vixel / 快速搜索 / 退出），否则按老行为退出。
 * 常驻的隐藏面板窗口会让 window-all-closed 不再触发，所以在这里显式判断。
 */
function maybeBackgroundOrQuit(): void {
  if (isQuitting) return // 显式退出中：别建托盘，也别碰已关闭的 db
  if (process.platform === 'darwin') return
  if (mainWindow || settingsWindow) return
  if (quickPanel?.keepAliveOnWindows()) quickPanel.ensureTray()
  else app.quit()
}

/** 设置窗口（⌘,）：独立窗口、单例，再次打开只是拉到前面 */
function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  const win = new BrowserWindow({
    backgroundColor: windowBackground(),
    width: 640,
    height: 600,
    minWidth: 560,
    minHeight: 440,
    show: false,
    title: t.main.settingsTitle,
    fullscreenable: false,
    minimizable: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: WEB_PREFERENCES,
  })
  settingsWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null
    releasePdfWindowIfLast()
    maybeBackgroundOrQuit()
  })
  loadRenderer(win, 'settings')
  return win
}

/** 文件夹增删后通知所有窗口：主窗口刷新侧边栏 / 网格，设置窗口刷新列表 */
/** 智能相册增删改后通知所有窗口刷新侧栏 */
function broadcastSmartAlbumsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC_CHANNELS.SMART_ALBUMS_CHANGED)
}

function broadcastLibraryChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC_CHANNELS.LIBRARY_CHANGED)
}

/** 应用菜单：语言 / 快速搜索快捷键变化时重建（菜单里显示当前快捷键） */
function rebuildMenu(): void {
  installAppMenu(() => mainWindow, {
    openSettings: openSettingsWindow,
    quickPanel: quickPanel
      ? { accelerator: quickPanel.settings().enabled ? quickPanel.settings().shortcut : null, toggle: () => quickPanel!.toggle() }
      : undefined,
  })
}

async function initServices(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'library.db')

  console.log('Initializing Vixel services...')

  // 模型目录：生产用 extraResources，开发用 resources/models
  const prodModelsDir = join(process.resourcesPath, 'models')
  const devModelsDir = join(process.cwd(), 'resources', 'models')
  bundledModelsDir = existsSync(prodModelsDir) ? prodModelsDir : devModelsDir

  // 推理（embedding / 人脸 / OCR）放到独立进程，主进程事件循环不被模型前向占住
  inference = new InferenceProcess(join(__dirname, 'inference.js'))
  setInferenceTransport(inference)
  // LiteRT-LM 原生库：打包后在 <resources>/litert，开发时在 resources/litert/<platform>-<arch>
  const prodLitertDir = join(process.resourcesPath, 'litert')
  const litertLibDir = existsSync(prodLitertDir) ? prodLitertDir : join(process.cwd(), 'resources', 'litert', litertPlatformDir())
  initEmbeddingServicePath(userDataPath, bundledModelsDir, litertLibDir)
  setFaceModelsDir(bundledModelsDir)
  setOcrModelsDir(bundledModelsDir)

  db = initDatabase(dbPath)
  db.recoverStuckTasks()
  db.pruneDoneTasks()
  db.requeueMissingEmbeddings()

  // v2：修复对齐（之前送进模型的是黑图，embedding 全部无效）→ 清空重扫
  const staleFaces = db.resetFacesIfStale(FACE_PIPELINE_VERSION)

  indexer = new Indexer(db, userDataPath)
  indexer.on('progress', (progress: IndexProgress) => {
    mainWindow?.webContents.send(IPC_CHANNELS.INDEX_PROGRESS, progress)
  })
  indexer.on('people-changed', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.PEOPLE_CHANGED)
  })

  watcher = new FileWatcher(db, indexer)
  searchEngine = new SearchEngine(db)

  // 电源策略（powerMonitor 事件驱动，无轮询）：电池 / 低电量模式 / 过热时回填等待，
  // watcher 实时事件（新文件、收集箱）照常索引。决策纯函数见 core/powerPolicy.ts
  initPowerPolicy({
    allowOnBattery: () => db.getMetaState(META_KEY_INDEX_ON_BATTERY) !== '0',
    onChange: (reason) => indexer.setPowerBlock(reason),
  })

  const folders = db.getFolders()
  for (const folder of folders) {
    watcher.watchFolder(folder.id, folder.path)
  }

  // 后台预加载：
  //   - jieba 首次切词约 150 ms，提前热掉避免第一次写入/搜索阻塞 SQLite 触发器
  //   - EmbeddingGemma 2 首次加载较慢，预拉模型权重到内存
  // 都是 fire-and-forget，失败不阻塞应用。
  setImmediate(preloadJieba)
  setTimeout(() => {
    // 上次退出时没跑完的任务：启动对账会跳过所有未变化的文件，不会再有 add 事件去触发队列
    indexer.processNext()
    // 补 OCR：已索引但从没做过文字识别的内容（以前只能在设置里手动触发）
    void indexer.ocrAvailable().then((ok) => {
      if (!ok) return
      const stale = indexer.resetOcrIfStale()
      if (stale > 0) console.log(`[ocr] pipeline upgraded, re-scanning (${stale} old results dropped)`)
      return indexer.startOcrScan()
    }).catch((e) => console.warn('[ocr] catch-up scan failed:', e))
    // 模型加载完推一次进度：库已全部索引时队列不动、不会有进度事件，状态栏的"模型未就绪"要靠这一下清掉
    indexer.preloadModels().catch(() => {}).finally(() => indexer.emitProgressPublic())
    // 老库的色板回填（读缩略图，小批推进，不阻塞主进程）
    void indexer.backfillColors().then((n) => {
      if (n > 0) console.log(`[color] backfilled palettes for ${n} items`)
    }).catch((e) => console.warn('[color] backfill failed:', e))
    // 用户扫过人脸才自动重扫；从没扫过的库保持手动触发
    // 上次退出前没来得及聚类的脸（或旧版本留下的未归属脸）
    if (db.countPendingClusterFaces() > 0) void indexer.faceClusterer.run()
    if (staleFaces > 0) {
      console.log(`[face] pipeline upgraded, re-scanning (${staleFaces} stale faces dropped)`)
      indexer.startFaceScan().catch((e) => console.warn('[face] re-scan failed:', e))
    } else if (indexer.isFaceAutoEnabled()) {
      const videoRescan = indexer.rescanVideoFacesOnce()
      if (videoRescan > 0) console.log(`[face] re-scanning ${videoRescan} video frames at full resolution`)
      // 补扫：上次之后入库、还没扫过人脸的媒体（以前只有手动点"扫描人脸"才会排）
      indexer.startFaceScan().catch((e) => console.warn('[face] catch-up scan failed:', e))
    }
  }, 2000)

  // VIXEL_PROFILE=1：主进程事件循环被同步工作占住 > 50ms 时打印，带上当前索引任务
  watchEventLoop('main', () => indexer.currentTaskLabel())

  // 启动备份调度器
  scheduleBackups()
}

/**
 * 备份调度：启动时检查上次备份距今 ≥ 24h 就立刻跑一次，
 * 之后每 24h 周期触发。重启不丢节奏 —— last_backup_at 在 meta_state。
 *
 * backupTo 走 SQLite Online Backup API，不阻塞读写，所以可以与 indexer 并行。
 */
function scheduleBackups(): void {
  // 启动时延后 60s 先做检查，避免抢启动期 IO
  setTimeout(() => {
    runBackupIfDue().catch((err) => console.warn('Initial backup check failed:', err))
  }, 60_000)

  if (backupTimer) clearInterval(backupTimer)
  backupTimer = setInterval(() => {
    runBackupIfDue().catch((err) => console.warn('Periodic backup failed:', err))
  }, 60 * 60 * 1000) // 每小时检查一次"是否到点"，真正动作受 last_backup_at 节流
}

async function runBackupIfDue(): Promise<void> {
  const last = parseInt(db.getMetaState(META_KEY_LAST_BACKUP) || '0', 10)
  const now = Date.now()
  if (now - last < BACKUP_INTERVAL_MS) return
  await runBackup()
}

async function runBackup(): Promise<{ path: string; sizeBytes: number }> {
  if (backupInFlight) {
    throw new Error('A backup is already in progress')
  }
  backupInFlight = true
  try {
    const backupsDir = join(app.getPath('userData'), 'backups')
    if (!existsSync(backupsDir)) {
      await mkdir(backupsDir, { recursive: true })
    }
    const name = formatBackupName(new Date())
    const dest = join(backupsDir, name)

    await db.backupTo(dest)

    // 写时间戳到 meta_state
    db.setMetaState(META_KEY_LAST_BACKUP, String(Date.now()))

    // 轮换：删除多余的旧备份（保留最近 BACKUP_KEEP_COUNT 份）
    const entries = await readdir(backupsDir)
    const expired = selectExpired(entries, BACKUP_KEEP_COUNT)
    for (const old of expired) {
      try {
        await unlink(join(backupsDir, old))
      } catch (err) {
        console.warn(`Failed to delete old backup ${old}:`, err)
      }
    }

    const { stat } = await import('fs/promises')
    const sizeBytes = (await stat(dest)).size
    return { path: dest, sizeBytes }
  } finally {
    backupInFlight = false
  }
}

/**
 * 老库的截图标记回填：photos.is_screenshot 为 NULL 的存量图片补判一遍
 * （macOS xattr ~7 µs / 文件 + 文件名模式，5 万张约 1–2 s 的系统调用，分批让出事件循环）。
 * 新打上标记的 hash 通知自动标签重新判定（截图标签从标记来，见 main/autotags.ts）。
 * 完成后写 meta 标记，下次启动一个查询就跳过。
 */
async function backfillScreenshotFlags(autoTags: AutoTagService): Promise<void> {
  if (db.getMetaState(META_KEY_SCREENSHOT_BACKFILL) === '1') return
  let done = 0
  const flagged: string[] = []
  for (;;) {
    const batch = db.photosMissingScreenshotFlag(200)
    if (batch.length === 0) break
    for (const p of batch) {
      const flag = detectScreenshot(p.filePath, p.fileName)
      db.setPhotoScreenshot(p.id, flag)
      if (flag === 1 && p.fileHash) flagged.push(p.fileHash)
      done++
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  db.setMetaState(META_KEY_SCREENSHOT_BACKFILL, '1')
  if (done > 0) console.log(`[screenshot] backfilled flags for ${done} photos (${flagged.length} screenshots)`)
  autoTags.screenshotFlagged([...new Set(flagged)])
}

/**
 * 人脸裁剪缓存：<userData>/face_thumbs/<hash>-<bbox摘要>.jpg。
 * 原来每次请求都读整张原图再裁，人物页几十张脸就是几十次全图解码。
 * 键用内容 hash + bbox 而不是 faceId：重扫后 id 可能复用，内容键不会串。
 */
const faceThumbInflight = new Map<string, Promise<string | null>>()

async function ensureFaceThumb(faceId: number): Promise<string | null> {
  const info = db.getFaceCoverInfo(faceId)
  if (!info) return null
  const key = `${info.fileHash}-${createHash('sha1').update(info.bbox).digest('hex').slice(0, 12)}`
  const dest = join(app.getPath('userData'), 'face_thumbs', `${key}.jpg`)
  if (existsSync(dest)) return dest
  let p = faceThumbInflight.get(key)
  if (!p) {
    p = (async () => {
      const photo = db.getRepresentativeByHash(info.fileHash)
      if (!photo) return null
      // 与检测同源：视频取全分辨率帧，照片取原图
      const crop = await getFaceThumbnail(await indexer.analysisImage(photo), JSON.parse(info.bbox) as FaceBbox)
      await mkdir(join(app.getPath('userData'), 'face_thumbs'), { recursive: true })
      await writeFile(dest, crop)
      return dest
    })().finally(() => faceThumbInflight.delete(key))
    faceThumbInflight.set(key, p)
  }
  return p
}

/** 缩略图 / 人脸裁剪 / sprite 都按内容寻址，不会变：让 Chromium 缓存，滚动重挂时不再回到主进程 */
async function immutable(res: Response): Promise<Response> {
  if (!res.ok) return res
  const headers = new Headers(res.headers)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return new Response(res.body, { status: res.status, headers })
}

/**
 * 隐私承诺落到代码上：渲染进程只许访问本地（vixel:// / file:// / devtools / 开发服务器），没有例外。
 * 主进程唯一的联网点：用户从浏览器拖进来的只是一个图片地址时，按这一个地址下载一次（main/collect.ts
 * downloadImage，用户显式操作、限大小 / 类型 / 超时）。浏览器扩展的本地服务只监听 127.0.0.1、默认关闭，
 * 只接收扩展推过来的字节，从不对外请求。
 * 地图用随应用打包的离线底图（Natural Earth），模型推理在 utilityProcess 里，
 * 且 transformers.js 已关掉远程模型（allowRemoteModels = false）。
 */
const NETWORK_ALLOWLIST: RegExp[] = []

function enforceOfflinePolicy(): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const url = details.url
      const allowed = (is.dev && devServer && (url.startsWith(devServer) || /^wss?:\/\/localhost[:/]/.test(url))) ||
        NETWORK_ALLOWLIST.some((re) => re.test(url))
      if (!allowed) console.warn(`[privacy] blocked network request: ${url}`)
      callback({ cancel: !allowed })
    }
  )
}

function registerIpcHandlers(): void {
  // VIXEL_PROFILE=1 时每个 handler 计时：主进程同步工作 > 16ms 就会让界面掉帧
  const handle = (channel: string, fn: Parameters<typeof ipcMain.handle>[1]): void =>
    ipcMain.handle(channel, timed('ipc', channel, fn))

  // 搜索
  handle(IPC_CHANNELS.SEARCH, async (_event, query: string, limit?: number, options?: SearchOptions) => {
    return searchEngine.search(query, limit, options)
  })

  handle(IPC_CHANNELS.GET_PHOTOS_WITH_GPS, async () => {
    return db.getPhotosWithGPS()
  })

  handle(IPC_CHANNELS.FIND_SIMILAR, async (_event, photoId: number, limit?: number) => {
    const photo = db.getPhoto(photoId)
    if (!photo?.fileHash) return []
    return searchEngine.findSimilar(photo.fileHash, limit || 12)
  })

  // 以图搜图：拖入 / 粘贴的查询图只在内存和临时文件里处理，不进资料库（见 imageSearch.ts）
  handle(IPC_CHANNELS.SEARCH_BY_IMAGE, async (_event, input: ImageQueryInput, limit?: number, options?: SearchOptions) => {
    return searchByImage(db, searchEngine, input, limit, options)
  })

  handle(IPC_CHANNELS.SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? mainWindow!, {
      properties: ['openDirectory'],
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  handle(IPC_CHANNELS.ADD_FOLDER, async (_event, folderPath: string) => {
    const folder = db.addFolder(folderPath)
    watcher.watchFolder(folder.id, folder.path)
    broadcastLibraryChanged()
    return folder
  })

  handle(IPC_CHANNELS.REMOVE_FOLDER, async (_event, folderId: number) => {
    const folder = db.getFolder(folderId)
    if (folder) {
      watcher.unwatchFolder(folderId)
      const orphanedHashes = db.deletePhotosByFolder(folderId)
      const thumbnailsDir = join(app.getPath('userData'), 'thumbnails')
      for (const hash of orphanedHashes) {
        const thumbnailPath = join(thumbnailsDir, `${hash}.webp`)
        try {
          if (existsSync(thumbnailPath)) {
            await unlink(thumbnailPath)
          }
        } catch (e) {
          console.warn(`Failed to delete thumbnail: ${thumbnailPath}`, e)
        }
      }
      // 视频的代表帧 photo 也挂在该文件夹下，上面已一并删掉；这里清视频本体 + 片段 + 抽帧目录
      const videoHashes = db.deleteVideosByFolder(folderId)
      for (const hash of videoHashes) {
        await rm(indexer.getVideoFramesDir(hash), { recursive: true, force: true }).catch(() => {})
      }
      db.removeFolder(folderId)
      broadcastLibraryChanged()
      broadcastTagsChanged()
    }
    return true
  })

  handle(IPC_CHANNELS.OPEN_SETTINGS, async () => { openSettingsWindow() })

  handle(IPC_CHANNELS.GET_THEME, async () => loadTheme())

  handle(IPC_CHANNELS.SET_THEME, async (_event, mode: ThemeMode) => {
    const next: ThemeMode = mode === 'light' || mode === 'dark' ? mode : 'system'
    db.setMetaState(META_KEY_THEME, next)
    applyTheme(next)
    return next
  })

  // preload 在渲染前同步取语言，首帧就是对的文案
  ipcMain.on(IPC_CHANNELS.GET_LOCALE_SYNC, (event) => { event.returnValue = locale })

  handle(IPC_CHANNELS.GET_LOCALE_SETTING, async () => loadLocaleSetting())

  handle(IPC_CHANNELS.SET_LOCALE_SETTING, async (_event, setting: LocaleSetting) => {
    const next: LocaleSetting = setting === 'zh-CN' || setting === 'en' ? setting : 'system'
    db.setMetaState(META_KEY_LOCALE, next)
    applyLocale(next)
    rebuildMenu()
    for (const w of BrowserWindow.getAllWindows()) w.webContents.reload()
    return next
  })

  handle(IPC_CHANNELS.GET_INDEX_PAUSED, async () => {
    return indexer.isPaused()
  })

  handle(IPC_CHANNELS.SET_INDEX_PAUSED, async (_event, paused: boolean) => {
    indexer.setPaused(paused)
    return indexer.isPaused()
  })

  // 电源策略设置："电池供电时也索引"（默认开）
  handle(IPC_CHANNELS.GET_INDEX_ON_BATTERY, async () => {
    return db.getMetaState(META_KEY_INDEX_ON_BATTERY) !== '0'
  })

  handle(IPC_CHANNELS.SET_INDEX_ON_BATTERY, async (_event, on: boolean) => {
    db.setMetaState(META_KEY_INDEX_ON_BATTERY, on ? '1' : '0')
    getPowerController()?.refresh()
    return db.getMetaState(META_KEY_INDEX_ON_BATTERY) !== '0'
  })

  // 跳过的数据集目录（设置 › 文件夹）
  handle(IPC_CHANNELS.GET_SKIPPED_FOLDERS, async (_event, folderId?: number) => {
    return db.listSkippedFolders(typeof folderId === 'number' ? folderId : undefined)
  })

  handle(IPC_CHANNELS.SET_SKIPPED_FOLDER_OVERRIDE, async (_event, path: string, override: boolean) => {
    const row = db.listSkippedFolders().find((r) => r.path === path)
    if (!row) return false
    db.setSkippedFolderOverride(path, !!override)
    // "仍然索引"：整夹重扫把该目录补进索引（未变化的文件对账开销很小）
    if (override) watcher.rescanAfterOverride(row.folderId)
    return true
  })

  handle(IPC_CHANNELS.GET_TASK_OVERVIEW, async () => {
    return db.getTaskOverview()
  })

  handle(IPC_CHANNELS.RETRY_FAILED_TASKS, async (_event, ids?: number[]) => {
    const n = db.retryFailedTasks(ids)
    if (n > 0) indexer.processNext()
    indexer.emitProgressPublic()
    return n
  })

  handle(IPC_CHANNELS.CLEAR_FAILED_TASKS, async () => {
    const n = db.clearFailedTasks()
    indexer.emitProgressPublic()
    return n
  })

  handle(IPC_CHANNELS.GET_MEDIA_DETAIL, async (_event, videoId: number) => {
    const detail = db.getMediaDetail(videoId)
    // 老版本索引的视频没记分辨率：第一次打开时探一下补上（ffmpeg -i 只读文件头，几十毫秒）
    if (detail && detail.kind === 'video' && detail.width == null && existsSync(detail.filePath) && isFfmpegAvailable()) {
      const probe = await probeMedia(detail.filePath).catch(() => null)
      if (probe?.width && probe.height) {
        db.updateVideoMeta(videoId, { width: probe.width, height: probe.height })
        return { ...detail, width: probe.width, height: probe.height }
      }
    }
    return detail ?? null
  })

  handle(IPC_CHANNELS.GET_FOLDERS, async () => {
    return db.getFoldersWithStats()
  })

  handle(IPC_CHANNELS.GET_LIBRARY_COUNTS, async () => {
    return db.getLibraryCounts()
  })

  handle(IPC_CHANNELS.GET_FOLDER_STATS, async (_event, folderId: number) => {
    return db.getFolderStats(folderId)
  })

  handle(IPC_CHANNELS.GET_PHOTO_DETAIL, async (_event, photoId: number) => {
    const detail = db.getPhotoDetail(photoId)
    if (!detail?.fileHash) return detail
    // 色板（按内容 hash）：缩略图时提取，老内容由后台回填；空数组不往外传
    const colors = db.getItemColors(detail.fileHash)
    const palette = parsePaletteJson(colors?.palette)
    return palette.length > 0 ? { ...detail, palette } : detail
  })

  handle(IPC_CHANNELS.GET_THUMBNAIL, async (_event, photoId: number) => {
    const photo = db.getPhoto(photoId)
    if (!photo?.fileHash) return null
    return indexer.getThumbnailPath(photo.fileHash)
  })

  handle(IPC_CHANNELS.GET_PHOTO_LOCATIONS, async (_event, photoId: number) => {
    const photo = db.getPhoto(photoId)
    if (!photo?.fileHash) return []
    return db.getPhotoLocations(photo.fileHash)
  })

  handle(IPC_CHANNELS.SET_FAVORITE, async (_event, fileHashes: string[], on: boolean) => {
    db.setFavorite(fileHashes.filter((h) => typeof h === 'string' && h), !!on)
    return !!on
  })

  handle(IPC_CHANNELS.GET_SMART_ALBUMS, async () => db.getSmartAlbums())

  handle(IPC_CHANNELS.CREATE_SMART_ALBUM, async (_event, album: { name: string; query: string; filters: MediaFilters }) => {
    const created = db.createSmartAlbum({ name: String(album?.name ?? ''), query: String(album?.query ?? ''), filters: album?.filters ?? {} })
    broadcastSmartAlbumsChanged()
    return created
  })

  handle(IPC_CHANNELS.UPDATE_SMART_ALBUM, async (_event, id: number, patch: { name?: string; query?: string; filters?: MediaFilters }) => {
    const updated = db.updateSmartAlbum(id, patch ?? {})
    broadcastSmartAlbumsChanged()
    return updated ?? null
  })

  handle(IPC_CHANNELS.DELETE_SMART_ALBUM, async (_event, id: number) => {
    db.deleteSmartAlbum(id)
    broadcastSmartAlbumsChanged()
  })

  handle(IPC_CHANNELS.REORDER_SMART_ALBUMS, async (_event, ids: number[]) => {
    db.reorderSmartAlbums(Array.isArray(ids) ? ids.filter((x) => typeof x === 'number') : [])
    broadcastSmartAlbumsChanged()
  })

  handle(IPC_CHANNELS.SHOW_SMART_ALBUM_MENU, async (event, name: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? popupSmartAlbumMenu(win, String(name ?? '')) : null
  })

  handle(IPC_CHANNELS.SHOW_ITEM_MENU, async (event, opts: { count: number; isMedia: boolean; favorite: boolean; canImageSearch: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? popupItemMenu(win, opts) : null
  })

  // 只对库里登记过的媒体 / 监控目录生效：渲染进程传来的任意路径不直接交给 shell
  handle(IPC_CHANNELS.SHOW_IN_FINDER, async (_event, filePath: string) => {
    const known = typeof filePath === 'string' && (
      !!db.getPhotoByPath(filePath) || !!db.getVideoByPath(filePath) ||
      db.getFolders().some((f) => f.path === filePath)
    )
    if (!known) return false
    shell.showItemInFolder(filePath)
    return true
  })

  handle(IPC_CHANNELS.GET_APP_PATH, async () => {
    return app.getPath('userData')
  })

  // 模型状态（EmbeddingGemma 2 via LiteRT）
  handle(IPC_CHANNELS.GET_MODEL_STATUS, async () => {
    const embeddingService = getEmbeddingService()
    return {
      modelsDir: bundledModelsDir,
      localModelExists: isLiteRtInstalled(),
      embeddingReady: embeddingService.isReady(),
      activeBackend: embeddingService.getActiveBackend(),
      backend: embeddingService.getConfig().backend ?? 'auto',
      initError: embeddingService.getInitError(),
    }
  })

  handle(IPC_CHANNELS.GET_EMBEDDING_CONFIG, async () => ({ backend: getEmbeddingService().getConfig().backend ?? 'auto' }))

  // 改后端会丢弃已加载的 provider，下次 encode 时重新加载。CPU / GPU 后端向量一致，不用重建索引。
  ipcMain.handle(
    IPC_CHANNELS.SET_EMBEDDING_CONFIG,
    async (_event, patch: EmbeddingConfig) => {
      try {
        const svc = getEmbeddingService()
        svc.setConfig(patch)
        await svc.init()
        return { success: true, ready: svc.isReady() }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }
  )

  // 手动更新 caption（用户编辑）
  handle(IPC_CHANNELS.UPDATE_CAPTION, async (_event, photoId: number, text: string) => {
    try {
      const photo = db.getPhoto(photoId)
      if (!photo?.fileHash) return { success: false, error: 'Photo not found' }
      db.saveCaption(photo.fileHash, text)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 人脸识别
  handle(IPC_CHANNELS.START_FACE_SCAN, async () => {
    try {
      return await indexer.startFaceScan()
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // OCR 扫描
  handle(IPC_CHANNELS.START_OCR_SCAN, async () => {
    try {
      return await indexer.startOcrScan()
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 打开视频源文件（系统默认播放器）
  handle(IPC_CHANNELS.OPEN_SOURCE_VIDEO, async (_event, videoId: number) => {
    try {
      const video = db.getVideoById(videoId)
      if (!video || !existsSync(video.filePath)) {
        return { success: false, error: t.main.videoMissing }
      }
      const errMsg = await shell.openPath(video.filePath)
      if (errMsg) return { success: false, error: errMsg }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  handle(IPC_CHANNELS.GET_PEOPLE, async () => {
    return db.getPeople()
  })

  handle(IPC_CHANNELS.GET_PERSON_PHOTOS, async (_event, personId: number, limit?: number) => {
    const photos = db.getPersonPhotos(personId, limit || 50)
    return photos.map((p) => ({ photo: p, score: 1.0 }))
  })

  handle(IPC_CHANNELS.SET_PERSON_NAME, async (_event, personId: number, name: string) => {
    db.updatePersonName(personId, name)
    return { success: true }
  })

  handle(IPC_CHANNELS.MERGE_PEOPLE, async (_event, targetId: number, sourceIds: number[]) => {
    db.mergePeople(targetId, sourceIds)
    return { success: true }
  })

  handle(IPC_CHANNELS.GET_PERSON_SUGGESTIONS, async (): Promise<PersonSuggestion[]> => {
    const people = new Map(db.getPeople().filter((p) => !p.hidden).map((p) => [p.id, p]))
    const centroids = db.getPersonCentroids().filter((c) => people.has(c.id))
    return suggestMerges(centroids, db.getDismissedPairs(), 10).map((s) => ({
      a: people.get(s.a)!, b: people.get(s.b)!, similarity: s.similarity,
    }))
  })

  handle(IPC_CHANNELS.DISMISS_PERSON_SUGGESTION, async (_event, a: number, b: number) => {
    db.dismissPersonPair(a, b)
    return { success: true }
  })

  handle(IPC_CHANNELS.GET_PERSON_FACES, async (_event, personId: number, limit?: number): Promise<PersonFace[]> => {
    return db.getPersonFaces(personId, limit).map((f) => ({ id: f.id, quality: f.quality, assignedBy: f.assignedBy as PersonFace['assignedBy'] }))
  })

  handle(IPC_CHANNELS.REJECT_FACE, async (_event, faceId: number) => {
    db.rejectFaceFromPerson(faceId)
    return { success: true }
  })

  handle(IPC_CHANNELS.ASSIGN_FACE, async (_event, faceId: number, personId: number) => {
    db.assignFaceManually(faceId, personId)
    return { success: true }
  })

  handle(IPC_CHANNELS.SET_PERSON_HIDDEN, async (_event, personId: number, hidden: boolean) => {
    db.setPersonHidden(personId, hidden)
    return { success: true }
  })

  handle(IPC_CHANNELS.GET_PHOTO_FACES, async (_event, photoId: number) => {
    const photo = db.getPhoto(photoId)
    if (!photo?.fileHash) return []
    return db.getFacesByHash(photo.fileHash)
  })

  // 备份：手动触发 + 状态查询
  handle(IPC_CHANNELS.TRIGGER_BACKUP, async () => {
    try {
      const result = await runBackup()
      return { success: true, ...result }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  handle(IPC_CHANNELS.GET_BACKUP_STATUS, async () => {
    const last = parseInt(db.getMetaState(META_KEY_LAST_BACKUP) || '0', 10)
    const backupsDir = join(app.getPath('userData'), 'backups')
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
      inProgress: backupInFlight,
      backupsDir,
    }
  })
}

/**
 * 注册 vixel:// 自定义协议。必须在 app.ready 之前调用 registerSchemesAsPrivileged，
 * 否则渲染端 <img src="vixel://..."> 会被当作 opaque resource，CORS/CSP 阻塞。
 *
 *   vixel://thumb/<photoId>           → <userData>/thumbnails/<hash>.webp
 *   vixel://image/<photoId>           → 原图文件路径
 *   vixel://media/<videoId>           → 音视频源文件（手写 Range，供 <video>/<audio> seek）
 *   vixel://sprite/<videoId>          → 悬停拖动预览 sprite；老视频没有时按需生成
 *   vixel://face/<faceId>             → 人脸裁剪（磁盘缓存）
 *
 * 比 base64-over-IPC 显著省事：
 *   - 主进程不必把文件读进字符串再 base64
 *   - IPC 不必序列化数 MB 的 data URL
 *   - 渲染端 <img> 直接走 Chromium 内置 file fetch，可被 GPU 解码
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'vixel', privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
  // PDF 渲染隐藏窗口取 pdfjs-dist 本地资源（cmaps / 字体 / wasm）用；standard + CORS 才能被页面 fetch/XHR
  { scheme: PDF_ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } },
])

function registerVixelProtocol(): void {
  protocol.handle('vixel', timed('proto', 'vixel://', async (request: Request) => {
    try {
      const url = new URL(request.url)
      const host = url.host
      const pathParts = url.pathname.split('/').filter(Boolean)

      if (host === 'thumb' && pathParts.length === 1) {
        const id = parseInt(pathParts[0], 10)
        if (Number.isNaN(id)) return new Response('bad id', { status: 400 })
        const photo = db.getPhoto(id)
        if (!photo?.fileHash) return new Response('not found', { status: 404 })
        // 新导入的照片先进网格、缩略图稍后才生成：安静地 404（不缓存），卡片会自己重试
        const thumbPath = indexer.getThumbnailPath(photo.fileHash)
        if (!existsSync(thumbPath)) return new Response('not ready', { status: 404 })
        return immutable(await net.fetch(pathToFileURL(thumbPath).toString()))
      }

      if (host === 'face' && pathParts.length === 1) {
        const id = parseInt(pathParts[0], 10)
        if (Number.isNaN(id)) return new Response('bad id', { status: 400 })
        const path = await ensureFaceThumb(id)
        if (!path) return new Response('not found', { status: 404 })
        return immutable(await net.fetch(pathToFileURL(path).toString()))
      }

      if (host === 'image' && pathParts.length === 1) {
        const id = parseInt(pathParts[0], 10)
        if (Number.isNaN(id)) return new Response('bad id', { status: 400 })
        const photo = db.getPhoto(id)
        if (!photo || !existsSync(photo.filePath)) return new Response('not found', { status: 404 })
        return net.fetch(pathToFileURL(photo.filePath).toString())
      }

      if (host === 'media' && pathParts.length === 1) {
        const id = parseInt(pathParts[0], 10)
        if (Number.isNaN(id)) return new Response('bad id', { status: 400 })
        const video = db.getVideoById(id)
        if (!video || !existsSync(video.filePath)) return new Response('not found', { status: 404 })
        return serveMediaFile(video.filePath, request.headers.get('range'))
      }

      if (host === 'sprite' && pathParts.length === 1) {
        const id = parseInt(pathParts[0], 10)
        if (Number.isNaN(id)) return new Response('bad id', { status: 400 })
        const video = db.getVideoById(id)
        if (!video || video.mediaKind !== 'video') return new Response('not found', { status: 404 })
        const spritePath = indexer.getSpritePath(video.fileHash)
        if (!existsSync(spritePath)) {
          // 还没抽过帧（时长未知）的视频交给索引任务，这里不抢
          if (!video.durationMs || video.durationMs < SPRITE_MIN_DURATION_MS || !existsSync(video.filePath) || !isFfmpegAvailable()) {
            return new Response('not ready', { status: 404 })
          }
          await ensureSprite(video.filePath, video.durationMs, spritePath)
        }
        return immutable(await net.fetch(pathToFileURL(spritePath).toString()))
      }

      return new Response('unknown vixel path', { status: 404 })
    } catch (err) {
      console.error('vixel:// handler error:', err)
      return new Response(String(err), { status: 500 })
    }
  }))
}

/**
 * VIXEL_DEBUG_CONTROL=<端口>：仅回环地址的调试控制端点（E2E 验证托盘驻留 / 退出路径用；
 * 不设环境变量时完全不监听，发布构建不受影响）。
 *   GET /state       窗口数 / 主窗口在不在 / 托盘在不在 / 是否正在退出
 *   GET /close-main  关闭主窗口（等同点窗口的 ×；Windows 上启用快捷键时应转入托盘驻留）
 *   GET /show-panel  /hide-panel  快速搜索面板（全局快捷键没法自动化，走和它相同的 show/hide）
 *   GET /quit        显式退出（等同菜单 / 托盘的退出）
 */
function startDebugControl(): void {
  const port = Number(process.env.VIXEL_DEBUG_CONTROL)
  if (!Number.isInteger(port) || port <= 0) return
  void import('http').then(({ createServer }) => {
    createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/close-main') {
        mainWindow?.close()
        res.end('{"ok":true}')
      } else if (req.url === '/show-panel') {
        quickPanel?.show()
        res.end('{"ok":true}')
      } else if (req.url === '/hide-panel') {
        quickPanel?.hide()
        res.end('{"ok":true}')
      } else if (req.url === '/quit') {
        res.end('{"ok":true}')
        setImmediate(() => app.quit())
      } else if (req.url === '/state') {
        res.end(JSON.stringify({
          windows: BrowserWindow.getAllWindows().length,
          mainWindow: !!mainWindow,
          tray: !!quickPanel?.hasTray(),
          panelVisible: !!quickPanel?.getWindow()?.isVisible(),
          quitting: isQuitting,
        }))
      } else {
        res.statusCode = 404
        res.end('{"ok":false}')
      }
    }).listen(port, '127.0.0.1')
    console.log(`[debug] control endpoint on 127.0.0.1:${port}`)
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.vixel.app')
  // 开发期 Dock 图标兜底；名字 / ⌘Tab 图标靠 predev 的 scripts/dev-bundle.mjs 改 Electron.app
  if (is.dev && process.platform === 'darwin') {
    const icon = join(app.getAppPath(), 'build/icon.png')
    if (existsSync(icon)) app.dock?.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    await initServices()
  } catch (err) {
    // 启动失败（数据库 / 原生模块加载不了）要让用户看到，而不是留一个没有窗口的进程
    console.error('Vixel failed to start:', err)
    // 数据库没起来，读不到语言设置：按系统语言
    setLocale(resolveLocale(null, app.getPreferredSystemLanguages()))
    dialog.showErrorBox(t.main.startupFailedTitle, t.main.startupFailedDetail(err instanceof Error ? err.message : String(err), app.getPath('userData')))
    app.exit(1)
    return
  }
  applyTheme(loadTheme())
  applyLocale(loadLocaleSetting())
  nativeTheme.on('updated', () => {
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground())
  })
  // 录屏：清掉渲染端 localStorage（最近搜索、布局偏好），片子里是全新安装的默认界面。
  // 必须在窗口加载前做 —— 录制中途 reload 会让帧订阅失效
  if (process.env.VIXEL_RECORD) await session.defaultSession.clearStorageData({ storages: ['localstorage'] })
  enforceOfflinePolicy()
  registerVixelProtocol()
  // PDF / AI 的 pdf.js 栅格化服务（隐藏窗口按需创建；Windows/Linux 主路径，macOS 兜底）
  registerPdfRenderer()
  registerIpcHandlers()
  registerCleanupIpc(db, broadcastLibraryChanged)
  registerTagIpc(db)
  registerCollectIpc({ db, watcher, broadcastLibraryChanged, broadcastTagsChanged, getMainWindow: () => mainWindow })
  // 自动标签：新内容有了向量 / 视频片段做完就排一次判定
  const autoTags = registerAutoTags(db, broadcastTagsChanged)
  indexer.on('embedded', () => autoTags.kick())
  indexer.on('video-indexed', (videoId: number) => autoTags.videoUpdated(videoId))
  // 老库的截图标记回填（xattr + 文件名模式，分批；新库入库时就打好）
  setTimeout(() => {
    backfillScreenshotFlags(autoTags).catch((e) => console.warn('[screenshot] backfill failed:', e))
  }, 5000)
  // 快速搜索面板（全局快捷键）：服务就绪后注册，设置存 meta_state
  quickPanel = initQuickPanel({
    getMeta: (k) => db.getMetaState(k),
    setMeta: (k, v) => db.setMetaState(k, v),
    getMainWindow: () => mainWindow,
    ensureMainWindow,
    loadRenderer,
    webPreferences: WEB_PREFERENCES,
    windowBackground,
    resolveFilePath: (photoId, videoId) => {
      if (videoId != null) {
        const v = db.getVideoById(videoId)
        return v && existsSync(v.filePath) ? v.filePath : null
      }
      const p = db.getPhoto(photoId)
      return p && existsSync(p.filePath) ? p.filePath : null
    },
    onSettingsChanged: rebuildMenu,
  })
  rebuildMenu()
  createWindow()
  startDebugControl()

  // 只剩设置窗口时点 Dock 图标也要把主窗口找回来
  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 显式退出中：Electron 自己会继续走 will-quit → quit，这里不要再读 db（已关闭）
  if (isQuitting) return
  // 启用了快速搜索时 Windows 留在后台（托盘在窗口 closed 回调里建）；此外维持原行为
  if (process.platform !== 'darwin' && !quickPanel?.keepAliveOnWindows()) {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  // 全局快捷键 / 托盘 / 常驻面板窗口：退出前注销并销毁
  quickPanel?.dispose()
  // VIXEL_PROFILE=1：退出时打印本次会话最慢的操作（p50 / p95 / max）
  if (PROFILE) console.table(perfSnapshot().slice(0, 25).map((r) => ({ ...r, p50: +r.p50.toFixed(1), p95: +r.p95.toFixed(1), max: +r.max.toFixed(1) })))
  watcher?.stopAll()
  disposePdfRenderer()
  // 先停 indexer（清掉节流中的进度定时器），否则它可能在 db.close() 之后触发并查询已关闭的库
  indexer?.stop()
  inference?.stop()
  if (backupTimer) {
    clearInterval(backupTimer)
    backupTimer = null
  }
  db?.close()
})
