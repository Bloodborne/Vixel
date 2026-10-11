/**
 * 截图巡检：VIXEL_CAPTURE=<目录> 启动时，主窗口就绪后依次切到各视图、浅色 / 深色各截一张，
 * 存成 <目录>/<theme>-<step>.png 然后退出。用于 UI 回归检查和宣发素材，不需要系统截屏权限。
 *
 *   VIXEL_CAPTURE=/tmp/shots npx electron . --user-data-dir=<库目录>
 */

import { app, type BrowserWindow, nativeTheme } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC_CHANNELS, type MenuCommand } from '../shared/types'
import { t } from '../shared/i18n'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Step { name: string; run: (win: BrowserWindow) => Promise<void> | void; wait?: number; after?: (win: BrowserWindow) => Promise<void> | void }

const command = (cmd: MenuCommand) => (win: BrowserWindow) => win.webContents.send(IPC_CHANNELS.MENU_COMMAND, cmd)

/** 在渲染进程里执行一段脚本（模拟用户输入），找不到元素就算了 */
const js = (code: string) => (win: BrowserWindow) => win.webContents.executeJavaScript(`try { ${code} } catch (e) {}`).then(() => {})

const typeSearch = (q: string): string => `
  const el = document.querySelector('input[data-search-input]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(q)}); el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`

// 文案按当前语言取，所以在运行时（而不是模块加载时）拼选择器
const clickSidebar = (label: () => string) => (win: BrowserWindow) =>
  js(`document.querySelector(${JSON.stringify(`nav [role="button"][title="${label()}"]`)})?.click()`)(win)
const clickTitled = (title: () => string) => (win: BrowserWindow) =>
  js(`document.querySelector(${JSON.stringify(`button[title="${title()}"]`)})?.click()`)(win)

const clickText = (text: () => string) => (win: BrowserWindow) =>
  js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text())})?.click()`)(win)

const QUERIES = (process.env.VIXEL_CAPTURE_QUERIES || '西瓜,微信支付,海边').split(',')

const STEPS: Step[] = [
  { name: 'all', run: command('source:all'), wait: 2500 },
  // 查询可用环境变量覆盖（逗号分隔：语义查询, 图中文字查询, 库里没有的东西）
  { name: 'search', run: js(typeSearch(QUERIES[0])), wait: 3000 },
  { name: 'inspector', run: js(`document.querySelector('.photo-card')?.click()`), wait: 2000 },
  { name: 'detail', run: js(`document.querySelector('.photo-card')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`), wait: 2000 },
  { name: 'video', run: (w) => { js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)(w); command('source:video')(w) }, wait: 2000 },
  { name: 'favorites', run: (w) => { js(typeSearch(''))(w); clickSidebar(() => t.organize.favorites)(w) }, wait: 2500 },
  {
    name: 'filters',
    run: (w) => { command('source:all')(w); clickTitled(() => t.organize.filterTitle)(w) },
    wait: 2000,
  },
  // 选两个条件后收起筛选栏：只剩可移除的条件标签
  {
    name: 'filters-active',
    run: async (w) => {
      await clickText(() => t.organize.landscape)(w)
      await sleep(600)
      await clickText(() => t.organize.favoritesOnly)(w)
      await sleep(600)
      await clickTitled(() => t.organize.filterTitle)(w)
    },
    wait: 2000,
    after: clickText(() => t.organize.clear),
  },
  { name: 'search-text', run: (w) => { command('source:all')(w); js(typeSearch(QUERIES[1]))(w) }, wait: 3000 },
  { name: 'search-nomatch', run: js(typeSearch(QUERIES[2])), wait: 3000 },
  // 智能相册：先在演示库里建好（查询相册 + 纯筛选相册），这里依次打开；最后在相册里改查询，标题旁出现"更新相册"
  { name: 'albums', run: js(`document.querySelectorAll('[data-album-row] [role="button"]')[0]?.click()`), wait: 3000 },
  { name: 'album-filters', run: js(`document.querySelectorAll('[data-album-row] [role="button"]')[1]?.click()`), wait: 3000 },
  { name: 'album-edited', run: js(typeSearch(QUERIES[0])), wait: 3000, after: clickText(() => t.organize.clear) },
  // 标签：打开侧栏第一个标签，选中第一项，T 把焦点放进检查器的标签输入框
  {
    name: 'tags',
    run: async (w) => {
      await js(typeSearch(''))(w)
      await js(`document.querySelector('[data-tag-row] [role="button"]')?.click()`)(w)
      await sleep(1500)
      await js(`document.querySelector('.photo-card')?.click()`)(w)
      await sleep(600)
      command('add-tag')(w)
    },
    wait: 2000,
  },
  // 标签名 / Eagle 注释也是搜索通道：结果卡片上有"标签""注释"角标（查询可用 VIXEL_CAPTURE_QUERIES 第 4、5 项覆盖）
  { name: 'tag-search', run: (w) => { command('source:all')(w); js(typeSearch(QUERIES[3] ?? '花卉'))(w) }, wait: 3000 },
  { name: 'note-search', run: js(typeSearch(QUERIES[4] ?? '游隼')), wait: 3000 },
  // Eagle 资源库作为文件夹出现在侧栏；选中一项，检查器里有 Eagle 的注释 / 来源 / 星级 / 文件夹
  {
    name: 'eagle',
    run: async (w) => {
      await js(typeSearch(''))(w)
      await js(`document.querySelector('nav [role="button"][title$=".library"]')?.click()`)(w)
      await sleep(1500)
      await js(`document.querySelector('.photo-card')?.click()`)(w)
    },
    wait: 2500,
  },
  { name: 'people', run: (w) => { js(typeSearch(''))(w); command('source:people')(w) }, wait: 6000 },
  { name: 'map', run: command('source:map'), wait: 3500 },
  { name: 'cleanup', run: command('source:cleanup'), wait: 4000 },
  { name: 'tasks', run: (w) => { command('source:all')(w); command('activity')(w) }, wait: 2000 },
]

export async function runCaptureTour(win: BrowserWindow, outDir: string, openSettings: () => BrowserWindow): Promise<void> {
  await mkdir(outDir, { recursive: true })
  win.setSize(1440, 900)
  win.center()
  await sleep(4000) // 首屏数据 + 缩略图
  for (const theme of ['light', 'dark'] as const) {
    nativeTheme.themeSource = theme
    await sleep(800)
    for (const step of STEPS) {
      await step.run(win)
      await sleep(step.wait ?? 1500)
      const img = await win.webContents.capturePage()
      await writeFile(join(outDir, `${theme}-${step.name}.png`), img.toPNG())
      console.log(`[capture] ${theme}-${step.name}.png`)
      await step.after?.(win)
    }
    // 设置窗口（通用页：外观、语言）
    const settings = openSettings()
    await sleep(2000)
    await writeFile(join(outDir, `${theme}-settings.png`), (await settings.webContents.capturePage()).toPNG())
    console.log(`[capture] ${theme}-settings.png`)
    settings.close()
    // 收起抽屉 / 清空搜索，下一轮从干净状态开始
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)(win)
    await js(typeSearch(''))(win)
    await sleep(800)
  }
  app.quit()
}

// ─── 录屏：VIXEL_RECORD=<out.mp4> ───────────────────────────────────────────
//
// 按脚本演示一遍真实界面，用 webContents 的帧订阅录成 1080p 视频（窗口 1280×720 × 1.5 倍缩放），
// 同时把每个场景的起止时间写到 <out>.timeline.json，供 scripts/make-promo.mjs 加字幕和片头片尾。
// 不需要系统录屏权限，也不会录到鼠标指针以外的任何桌面内容。

/** query：这一幕输入的搜索词，写进 timeline 供竖版放大显示（竖版里界面缩得太小，看不清搜索框） */
interface Scene { name: string; caption: string; query?: string; run: (win: BrowserWindow) => Promise<void> }

/** 逐字输入（触发搜索框自己的防抖），模拟真人打字 */
const typeSlowly = async (win: BrowserWindow, text: string): Promise<void> => {
  await js(typeSearch(''))(win)
  for (let i = 1; i <= text.length; i++) {
    await win.webContents.executeJavaScript(`try {
      const el = document.querySelector('input[data-search-input]');
      el.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(text.slice(0, i))}); el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}`)
    await sleep(160)
  }
}

const press = (key: string) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`)
const openFirst = js(`document.querySelector('.photo-card')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
/** 打开带"图中文字"角标的那张（图中文字命中优先展示） */
const openTextHit = js(`([...document.querySelectorAll('.photo-card')].find((c) => c.textContent.includes('图中文字')) ?? document.querySelector('.photo-card'))?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
const selectFirst = js(`document.querySelector('.photo-card')?.click()`)
const scrollGrid = (top: number) => js(`(() => { const el = [...document.querySelectorAll('[role="listbox"] div')].find((d) => d.scrollHeight > d.clientHeight + 10); el?.scrollTo({ top: ${top}, behavior: 'smooth' }) })()`)

const PROMO_SCENES: Scene[] = [
  { name: 'library', caption: '照片、视频、RAW，一个地方全部找得到', run: async (w) => {
    command('source:all')(w); await sleep(1800); await scrollGrid(420)(w); await sleep(1800); await scrollGrid(0)(w); await sleep(1200)
  } },
  { name: 'semantic', caption: '用一句话描述，不用记文件名', run: async (w) => {
    await typeSlowly(w, '瀑布'); await sleep(2200); await openFirst(w); await sleep(4200); await press('Escape')(w); await sleep(600)
  } },
  { name: 'object', caption: '物体、场景、动作都能搜', run: async (w) => {
    await typeSlowly(w, '花'); await sleep(2400); await selectFirst(w); await sleep(2800); await press('Escape')(w); await sleep(400)
  } },
  { name: 'ocr', caption: '视频画面里出现过的文字，也能搜到', run: async (w) => {
    await typeSlowly(w, 'STARBUCKS'); await sleep(2400); await openTextHit(w); await sleep(3600); await press('Escape')(w); await sleep(400)
  } },
  { name: 'ocr2', caption: '截图、手写笔记、菜单上的字', run: async (w) => {
    await typeSlowly(w, 'TODO'); await sleep(2600)
  } },
  { name: 'honest', caption: '没有把握时，它会直说', run: async (w) => {
    await typeSlowly(w, '猫'); await sleep(3000)
  } },
  { name: 'map', caption: '拍摄地点一目了然，地图也是离线的', run: async (w) => {
    await js(typeSearch(''))(w); await sleep(300); command('source:map')(w); await sleep(4200); command('source:all')(w); await sleep(600)
  } },
  { name: 'dark', caption: '浅色、深色，跟随系统', run: async (w) => {
    await typeSlowly(w, ''); await js(typeSearch(''))(w); await sleep(800)
    nativeTheme.themeSource = 'dark'; await sleep(2600); nativeTheme.themeSource = 'light'; await sleep(600)
  } },
]

/** 真实鼠标移动（webContents 输入事件）：悬停预览要真的 mouseenter / mousemove，合成 DOM 事件不触发 React 的 enter */
const hoverScrub = async (win: BrowserWindow, index: number, ms: number): Promise<void> => {
  const r = await win.webContents.executeJavaScript(`(() => { const c = document.querySelectorAll('.photo-card')[${index}]; if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })()`) as { x: number; y: number; w: number; h: number } | null
  if (!r) return
  const y = Math.round(r.y + r.h / 2)
  const steps = Math.max(10, Math.round(ms / 50))
  for (let i = 0; i <= steps; i++) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x + 4 + ((r.w - 8) * i) / steps), y })
    await sleep(ms / steps)
  }
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x + r.w + 400), y: 20 })
}

/** 搜一句话 → 打开第一条（详情里自动跳到命中片段，时间轴高亮） → 返回 */
const searchAndOpen = (q: string, open: (w: BrowserWindow) => Promise<void> = openFirst, hold = 4600) => async (w: BrowserWindow): Promise<void> => {
  await typeSlowly(w, q); await sleep(2000); await open(w); await sleep(hold); await press('Escape')(w); await sleep(500)
}

/**
 * 视频素材版（VIXEL_PROMO=video）：面向剪辑师 / 自媒体，演示库是公有领域 / CC0 素材
 * （~/workspace/dancer/vixel-demo/footage，来源见其中 LICENSES.md）。查询都在该库上验证过能稳定命中。
 */
const VIDEO_SCENES: Scene[] = [
  { name: 'library', caption: '一堆视频素材，不用整理、不用打标签', run: async (w) => {
    command('source:all')(w); await sleep(1800); await hoverScrub(w, 0, 2600); await sleep(400); await hoverScrub(w, 3, 2200); await sleep(600)
  } },
  { name: 'seagull', caption: '一句话描述你要的镜头', query: '海鸥喂小鸟', run: searchAndOpen('海鸥喂小鸟') },
  { name: 'rocket', caption: '直接跳到命中的那一段', query: '火箭发射', run: searchAndOpen('火箭发射', openFirst, 5200) },
  { name: 'english', caption: '中文、英文都能搜', query: 'train arriving at a station', run: searchAndOpen('train arriving at a station') },
  { name: 'ocr', caption: '画面里出现过的字，也能搜到', query: 'OLD SACRAMENTO', run: searchAndOpen('OLD SACRAMENTO', openTextHit) },
  { name: 'filter', caption: '按时长筛选，只看短镜头', run: async (w) => {
    await typeSlowly(w, ''); await js(typeSearch(''))(w); await sleep(500)
    await clickTitled(() => t.organize.filterTitle)(w); await sleep(1400)
    await clickText(() => t.organize.durShort)(w); await sleep(2800)
    await clickText(() => t.organize.clear)(w); await sleep(500)
    await clickTitled(() => t.organize.filterTitle)(w); await sleep(800)
  } },
  { name: 'offline', caption: '完全离线：素材不上传，不需要账号', query: '烟花', run: async (w) => {
    await typeSlowly(w, '烟花'); await sleep(2200); await hoverScrub(w, 0, 2400); await sleep(800)
  } },
]

export async function runRecording(win: BrowserWindow, outPath: string): Promise<void> {
  const { spawn } = await import('child_process')
  const mod = (await import('ffmpeg-static')) as unknown as { default?: string } & string
  const ffmpeg = (mod.default ?? mod) as string
  const FPS = 30
  win.setContentSize(1280, 720)
  win.center()
  // 窗口被遮挡 / 失焦时 Chromium 会停止绘制，帧订阅就收不到新帧（录出来一直是同一画面）
  win.webContents.setBackgroundThrottling(false)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.focus()
  nativeTheme.themeSource = 'light'
  await sleep(6000) // 首屏数据 + 缩略图 + 模型预热

  const enc = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-r', String(FPS), outPath],
  { stdio: ['pipe', 'ignore', 'inherit'] })

  let latest: Buffer | null = null
  let dirty: Electron.NativeImage | null = null
  win.webContents.beginFrameSubscription(false, (image) => { dirty = image })
  const t0 = Date.now()
  let written = 0
  // 按墙钟补帧：画面不变时重复上一帧，视频时长与真实演示一致
  const tick = setInterval(() => {
    if (dirty) { latest = dirty.toJPEG(92); dirty = null }
    if (!latest) return
    const due = Math.floor(((Date.now() - t0) * FPS) / 1000)
    while (written < due) { enc.stdin.write(latest); written++ }
  }, 1000 / FPS / 2)

  const timeline: Array<{ name: string; caption: string; query?: string; start: number; end: number }> = []
  const scenes = process.env.VIXEL_PROMO === 'video' ? VIDEO_SCENES : PROMO_SCENES
  for (const scene of scenes) {
    const start = (Date.now() - t0) / 1000
    await scene.run(win)
    timeline.push({ name: scene.name, caption: scene.caption, query: scene.query, start, end: (Date.now() - t0) / 1000 })
    console.log(`[record] ${scene.name} ${start.toFixed(1)}s`)
  }
  await sleep(500)
  clearInterval(tick)
  win.setAlwaysOnTop(false)
  win.webContents.endFrameSubscription()
  enc.stdin.end()
  await new Promise((r) => enc.on('close', r))
  await writeFile(`${outPath}.timeline.json`, JSON.stringify(timeline, null, 2))
  console.log(`[record] ${written} frames → ${outPath}`)
  app.quit()
}
