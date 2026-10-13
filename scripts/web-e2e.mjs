#!/usr/bin/env node
/**
 * Vixel 网页版端到端巡检（plan.md 测试层级 4）：本机 Chrome 无头 + CDP 驱动，零额外依赖
 * （WebSocket 客户端复用仓库已有的 `ws`）。桌面 1440×900 与手机 390×844（@3x，触屏仿真）
 * 两种视口、中英两种语言跑同一组场景，每步 PASS/FAIL + 截图，任何 FAIL 退出码非零。
 *
 *   npm run test:web -- --url http://127.0.0.1:18080 --password <pw> \
 *     [--out dir] [--viewport desktop|mobile|both] [--lang zh|en|both] \
 *     [--live-dir <库目录>] [--chrome <二进制>]
 *
 *   --live-dir：实时更新步骤往该目录写入一张新图（必须指向测试副本的库目录，
 *               不给则该步记 SKIP）。套件只读写服务器背后的测试副本，不碰真实数据。
 *
 * 场景：错误口令 → 正确口令登录 → 网格缩略图解码 → （手机）抽屉 → 搜"瀑布"进视频详情
 * （从命中片段起播、可拖动、观察到 Range 206、片段条可点）→ 以图搜图（上传裁剪）→ 人物 →
 * 地图 → 收藏并在收藏视图确认（再还原）→ 筛选（方向）收窄结果 → 智能相册存 / 开 / 删 →
 * 设置·文件夹只读 → 语言 zh↔en 切换（再还原）→ 实时更新（新图入库目录，无刷新出现在网格）→
 * 退出登录。
 */
import { spawn, execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from 'fs'
import os from 'os'
import { join, resolve, basename } from 'path'
import WebSocket from 'ws'

// ─── 参数 ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const BASE = (flag('url') ?? '').replace(/\/$/, '')
const PASSWORD = flag('password') ?? process.env.VIXEL_PASSWORD
const OUT = resolve(flag('out', 'e2e-out'))
const VIEWPORTS = { desktop: ['desktop'], mobile: ['mobile'], both: ['desktop', 'mobile'] }[flag('viewport', 'both')]
const LANGS = { zh: ['zh'], en: ['en'], both: ['zh', 'en'] }[flag('lang', 'both')]
const LIVE_DIR = flag('live-dir') ? resolve(flag('live-dir')) : null
const CHROME = flag('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

if (!BASE || !PASSWORD || !VIEWPORTS || !LANGS) {
  console.error('usage: node scripts/web-e2e.mjs --url <base> --password <pw> [--out dir] [--viewport desktop|mobile|both] [--lang zh|en|both] [--live-dir <library dir>] [--chrome <bin>]')
  process.exit(2)
}

// 界面文案（选择器用）：与 src/shared/i18n 对应语言保持一致
const STR = {
  zh: {
    all: '全部', people: '人物', map: '地图', favorites: '收藏', landscape: '横向', clear: '清除',
    tabGeneral: '通用', tabFolders: '文件夹', addFolder: '添加文件夹', settingsPrefix: '设置 (',
    filterTitle: '筛选：方向、分辨率、时长、颜色、人物、收藏', langButton: '简体中文', imageSearch: '以图搜图',
  },
  en: {
    all: 'All', people: 'People', map: 'Map', favorites: 'Favorites', landscape: 'Landscape', clear: 'Clear',
    tabGeneral: 'General', tabFolders: 'Folders', addFolder: 'Add Folder', settingsPrefix: 'Settings (',
    filterTitle: 'Filter by orientation, resolution, duration, color, person, favorites', langButton: 'English', imageSearch: 'Image search',
  },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 回到 资料库 › 全部 的浏览网格（清掉查询）：几个步骤的共同起点，彼此独立不受前一步失败影响 */
async function goAll({ page, mobile, S }) {
  if (mobile) {
    await page.click('[data-sidebar-toggle]')
    await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
  }
  await page.clickNavRow(S.all)
  await page.waitFor(`!!document.querySelector('input[data-search-input]')`, 8000, 'grid view with search box')
  await page.setSearch('')
  await sleep(600)
  await page.waitFor(`document.querySelectorAll('.photo-card').length >= 10`, 20000, 'browse grid')
}

// ─── CDP 客户端 ──────────────────────────────────────────────────────────────

class Chrome {
  static async launch({ mobile }) {
    const profile = mkdtempSync(join(os.tmpdir(), 'vixel-e2e-chrome-'))
    const proc = spawn(CHROME, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--window-size=1440,980',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    const wsUrl = await new Promise((resolveUrl, reject) => {
      let buf = ''
      proc.stderr.on('data', (d) => {
        buf += d
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
        if (m) resolveUrl(m[1])
      })
      proc.on('exit', () => reject(new Error('Chrome exited before DevTools was ready')))
      setTimeout(() => reject(new Error('DevTools endpoint not found in 15s:\n' + buf)), 15000)
    })
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
    const chrome = new Chrome(proc, ws, profile)
    ws.on('message', (d) => chrome.#onMessage(JSON.parse(d)))
    return chrome
  }

  #id = 0
  #pending = new Map()
  #eventHandlers = []
  constructor(proc, ws, profile) { this.proc = proc; this.ws = ws; this.profile = profile }

  #onMessage(msg) {
    if (msg.id && this.#pending.has(msg.id)) {
      const { resolve, reject, method } = this.#pending.get(msg.id)
      this.#pending.delete(msg.id)
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
      else resolve(msg.result)
    } else if (msg.method) {
      for (const fn of this.#eventHandlers) fn(msg)
    }
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.#id
      this.#pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  onEvent(fn) { this.#eventHandlers.push(fn) }

  async close() {
    try { this.ws.close() } catch { /* ignore */ }
    this.proc.kill()
    await sleep(300)
    rmSync(this.profile, { recursive: true, force: true })
  }
}

class Page {
  /** @param {Chrome} chrome */
  static async create(chrome, { mobile }) {
    const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(chrome, sessionId)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Network.enable')
    if (mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    } else {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    }
    chrome.onEvent((msg) => {
      if (msg.sessionId !== sessionId) return
      if (msg.method === 'Network.responseReceived') {
        const r = msg.params.response
        page.responses.push({ url: r.url, status: r.status })
        if (page.responses.length > 4000) page.responses.splice(0, 2000)
      }
    })
    return page
  }

  constructor(chrome, sessionId) { this.chrome = chrome; this.sessionId = sessionId; this.responses = [] }
  send(method, params = {}) { return this.chrome.send(method, params, this.sessionId) }

  async goto(url) {
    await this.send('Page.navigate', { url })
    await this.waitFor(`document.readyState === 'complete'`, 15000)
  }

  /** 执行表达式并取可序列化的值（promise 自动 await） */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  in: ${expression.slice(0, 200)}`)
    return r.result.value
  }

  /** 轮询直到表达式为真值（返回该值）；超时抛错 */
  async waitFor(expression, timeout = 10000, label = expression) {
    const deadline = Date.now() + timeout
    for (;;) {
      const v = await this.eval(expression).catch(() => undefined)
      if (v) return v
      if (Date.now() > deadline) throw new Error(`timeout (${timeout}ms) waiting for: ${String(label).slice(0, 160)}`)
      await sleep(200)
    }
  }

  /** CSS 选择器点击（synthetic click；isTouch 由媒体查询判定，与真实点按等效） */
  async click(selector) {
    const ok = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
    if (!ok) throw new Error(`click: not found: ${selector}`)
  }

  /** 按文案找侧栏 / 抽屉里的导航行并点击 */
  async clickNavRow(label) {
    const ok = await this.eval(`(() => {
      const row = [...document.querySelectorAll('nav [role="button"]')].find((b) => (b.textContent || '').startsWith(${JSON.stringify(label)}))
      if (!row) return false
      row.click(); return true
    })()`)
    if (!ok) throw new Error(`nav row not found: ${label}`)
  }

  /** React 受控输入框赋值（原生 setter + input 事件，300ms 防抖后生效） */
  async setSearch(q) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector('input[data-search-input]')
      if (!el) return false
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, ${JSON.stringify(q)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!ok) throw new Error('search input not found')
  }

  async key(key) {
    await this.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`)
  }

  /** 真实触摸滑动（横扫翻页用） */
  async swipe(fromX, fromY, toX, toY) {
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] })
    const steps = 6
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y: fromY + ((toY - fromY) * i) / steps }],
      })
      await sleep(16)
    }
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  async setFileInput(selector, file) {
    await this.send('DOM.enable')
    const { root } = await this.send('DOM.getDocument')
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) throw new Error(`file input not found: ${selector}`)
    await this.send('DOM.setFileInputFiles', { files: [file], nodeId })
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(data, 'base64'))
  }

  /** 状态栏左侧 "N 项 / N items" 里的数字 */
  async itemCount() {
    return this.eval(`(() => { const el = document.querySelector('footer span'); const n = parseInt(el?.textContent ?? '', 10); return Number.isFinite(n) ? n : -1 })()`)
  }

  net(pattern, status) {
    return this.responses.filter((r) => r.url.includes(pattern) && (status === undefined || r.status === status)).length
  }
}

// ─── 场景步骤 ────────────────────────────────────────────────────────────────

/**
 * 每步：{ name, run(ctx) }。run 抛错 = FAIL（message 即原因），返回字符串 = PASS 备注，
 * 返回 { skip: reason } = SKIP。每步结束（成败都）截一张图。
 */
const STEPS = [
  {
    name: 'login-wrong-password',
    async run({ page, base }) {
      await page.goto(base + '/')
      await page.waitFor(`location.pathname === '/login'`, 8000, 'redirect to /login')
      await page.eval(`(() => {
        const pw = document.getElementById('pw')
        pw.value = 'definitely-wrong-password'
        document.getElementById('f').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })()`)
      await page.waitFor(`(document.getElementById('err')?.textContent ?? '').length > 0`, 8000, 'error message shown')
      const err = await page.eval(`document.getElementById('err').textContent`)
      if (await page.eval(`location.pathname`) !== '/login') throw new Error('left /login on wrong password')
      return `error shown: "${err}"`
    },
  },
  {
    name: 'login',
    async run({ page, base, password, lang }) {
      await page.eval(`(() => {
        const pw = document.getElementById('pw')
        pw.value = ${JSON.stringify(password)}
        document.getElementById('f').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })()`)
      await page.waitFor(`location.pathname === '/' && !!window.api`, 15000, 'app loaded after login')
      // 本次巡检的语言：走应用自己的设置链路（保存后整页刷新）
      const setting = lang === 'zh' ? 'zh-CN' : 'en'
      const cur = await page.eval(`window.api.getLocaleSetting()`)
      if (cur !== setting) {
        await page.eval(`void window.api.setLocaleSetting(${JSON.stringify(setting)})`)
        await sleep(1500)
        await page.waitFor(`location.pathname === '/' && !!window.api`, 15000, 'app reloaded in run language')
      }
      await page.waitFor(`document.querySelectorAll('.photo-card').length > 0`, 20000, 'grid rendered')
      return `locale = ${setting}`
    },
  },
  {
    name: 'grid-thumbnails',
    async run({ page }) {
      await page.waitFor(`[...document.querySelectorAll('.photo-card img')].filter((i) => i.naturalWidth > 0).length >= 6`, 30000, '>=6 thumbnails decoded')
      const decoded = await page.eval(`[...document.querySelectorAll('.photo-card img')].filter((i) => i.naturalWidth > 0).length`)
      const overflow = await page.eval(`document.scrollingElement.scrollWidth - window.innerWidth`)
      if (overflow > 1) throw new Error(`horizontal page overflow: ${overflow}px`)
      return `${decoded} thumbnails decoded, no horizontal overflow`
    },
  },
  {
    name: 'drawer',
    async run({ page, mobile, S, shot }) {
      if (!mobile) return { skip: 'desktop keeps the docked sidebar' }
      const touch = await page.eval(`matchMedia('(hover: none)').matches`)
      if (!touch) throw new Error('(hover: none) not active under touch emulation')
      await page.click('[data-sidebar-toggle]')
      await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000, 'drawer opened')
      await shot('drawer-open')
      await page.clickNavRow(S.people)
      await page.waitFor(`!document.querySelector('[data-drawer]')`, 5000, 'drawer closed after selecting')
      await page.click('[data-sidebar-toggle]')
      await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
      await page.clickNavRow(S.all)
      await page.waitFor(`!document.querySelector('[data-drawer]')`, 5000)
      await page.waitFor(`document.querySelectorAll('.photo-card').length > 0`, 10000)
      return 'drawer opens from hamburger, closes on selection'
    },
  },
  {
    name: 'search-video-detail',
    async run({ page, mobile, shot }) {
      await page.setSearch('瀑布')
      // 等副标题出现引号查询（搜索真正生效，而不是浏览网格里恰好有 waterfall）
      await page.waitFor(`(document.querySelector('header p')?.textContent || '').includes('瀑布')`, 20000, 'search applied')
      await page.waitFor(`[...document.querySelectorAll('.photo-card')].some((c) => (c.getAttribute('aria-label') || '').includes('waterfall'))`, 20000, 'waterfall.mp4 in results')
      // 展开"较弱的匹配"：详情页的 ← → / 横扫翻页需要多于一个同列表结果
      await page.eval(`(() => { document.querySelector('[data-weak-toggle]')?.click() })()`)
      await sleep(600)
      await shot('search-results')
      // 打开详情：触屏单击即开，桌面双击
      const open = `(() => {
        const card = [...document.querySelectorAll('.photo-card')].find((c) => (c.getAttribute('aria-label') || '').includes('waterfall'))
        if (!card) return false
        card.dispatchEvent(new MouseEvent(${JSON.stringify(mobile ? 'click' : 'dblclick')}, { bubbles: true }))
        return true
      })()`
      if (!(await page.eval(open))) throw new Error('waterfall card not found')
      await page.waitFor(`!!document.querySelector('[role="dialog"] video')`, 15000, 'video element in detail')
      // 从命中片段起播
      await page.waitFor(`(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime >= 0 && v.readyState >= 2 })()`, 20000, 'video playing')
      const t0 = await page.eval(`document.querySelector('video').currentTime`)
      // 片段条可点：点第一个片段 → 跳到片段开头
      const segs = await page.eval(`document.querySelectorAll('.segment-strip button').length`)
      if (segs < 1) throw new Error('segment timeline has no segments')
      // 拖动（seek）：跳到中段，等 seeked
      const seeked = await page.eval(`new Promise((resolve) => {
        const v = document.querySelector('video')
        const target = Math.max(2, (v.duration || 10) / 2)
        v.addEventListener('seeked', () => resolve(Math.abs(v.currentTime - target) < 1), { once: true })
        v.currentTime = target
        setTimeout(() => resolve(false), 8000)
      })`)
      if (!seeked) throw new Error('seek did not complete')
      await page.eval(`(() => { document.querySelectorAll('.segment-strip button')[0].click() })()`)
      await sleep(500)
      const afterSeg = await page.eval(`document.querySelector('video').currentTime`)
      const ranged = page.net('/media/media/', 206)
      if (ranged < 1) throw new Error('no 206 (Range) response observed for /media/media/')
      await shot('video-detail')
      // 手机：横扫到下一个结果再扫回来
      let swipeNote = ''
      if (mobile) {
        const before = await page.eval(`document.querySelector('[data-detail-pos]')?.textContent`)
        if (/^1 \/ 1$/.test((before || '').trim())) {
          swipeNote = '; single result — swipe untestable here'
        } else {
          await page.swipe(330, 300, 60, 300)
          await sleep(800)
          const after = await page.eval(`document.querySelector('[data-detail-pos]')?.textContent`)
          if (after === before) throw new Error(`swipe did not navigate (${before} -> ${after})`)
          await page.swipe(60, 300, 330, 300)
          await sleep(800)
          swipeNote = `; swipe ${before} -> ${after} -> back`
        }
      }
      await page.key('Escape')
      await page.waitFor(`!document.querySelector('[role="dialog"]')`, 5000, 'detail closed')
      await page.setSearch('')
      await sleep(800)
      return `plays at ${t0.toFixed(1)}s, seek ok, segment tap -> ${afterSeg.toFixed(1)}s, ${ranged} Range 206 responses${swipeNote}`
    },
  },
  {
    name: 'image-search-upload',
    async run({ page, cropFile, cropSource }) {
      await page.waitFor(`!!document.querySelector('[data-upload-image] input[type="file"]')`, 8000, 'upload button')
      await page.setFileInput('[data-upload-image] input[type="file"]', cropFile)
      await page.waitFor(`!!document.querySelector('[data-image-chip]')`, 15000, 'query image chip')
      // 副标题在结果返回前就已变成"以图搜图"，必须等结果本身：第一屏卡片里出现原图
      try {
        await page.waitFor(
          `[...document.querySelectorAll('.photo-card')].slice(0, 5).some((c) => (c.getAttribute('aria-label') || '').includes(${JSON.stringify(cropSource)}))`,
          45000,
          'source image in top results'
        )
      } catch {
        const names = await page.eval(`[...document.querySelectorAll('.photo-card')].slice(0, 5).map((c) => c.getAttribute('aria-label'))`)
        throw new Error(`crop of ${cropSource} did not surface it in top results: ${JSON.stringify(names)}`)
      }
      const names = await page.eval(`[...document.querySelectorAll('.photo-card')].slice(0, 3).map((c) => c.getAttribute('aria-label'))`)
      return `top results: ${names.join(', ')}`
    },
  },
  {
    name: 'image-search-clear',
    async run({ page }) {
      if (!(await page.eval(`!!document.querySelector('[data-image-chip]')`))) return { skip: 'no image query active (previous step failed)' }
      await page.click('[data-clear-image]')
      await page.waitFor(`!document.querySelector('[data-image-chip]')`, 8000, 'image query cleared')
      await page.waitFor(`document.querySelectorAll('.photo-card').length > 0`, 15000, 'browse grid back')
      return 'query image cleared'
    },
  },
  {
    name: 'people',
    async run({ page, mobile, S }) {
      if (mobile) {
        await page.click('[data-sidebar-toggle]')
        await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
      }
      await page.clickNavRow(S.people)
      await page.waitFor(`[...document.querySelectorAll('img')].filter((i) => i.src.includes('/media/face/') && i.naturalWidth > 0).length > 0`, 20000, 'face thumbnails decoded')
      const faces = await page.eval(`[...document.querySelectorAll('img')].filter((i) => i.src.includes('/media/face/') && i.naturalWidth > 0).length`)
      return `${faces} face image(s) decoded`
    },
  },
  {
    name: 'map',
    async run({ page, mobile, S }) {
      if (mobile) {
        await page.click('[data-sidebar-toggle]')
        await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
      }
      await page.clickNavRow(S.map)
      await page.waitFor(`!!document.querySelector('.leaflet-container')`, 20000, 'leaflet container')
      await page.waitFor(`document.querySelectorAll('.leaflet-marker-icon').length > 0`, 20000, 'markers rendered')
      const markers = await page.eval(`document.querySelectorAll('.leaflet-marker-icon').length`)
      // 离线底图画在 canvas / svg 上：容器里应有非空图层
      const layers = await page.eval(`document.querySelectorAll('.leaflet-container canvas, .leaflet-container svg, .leaflet-container img').length`)
      if (layers === 0) throw new Error('no basemap layers rendered')
      return `${markers} marker(s), ${layers} layer node(s), offline basemap`
    },
  },
  {
    name: 'favorite-toggle',
    async run(ctx) {
      const { page, mobile, S, shot } = ctx
      await goAll(ctx)
      // 选第一张图片卡片（视频详情的滑动留给原生控件，图片上才能横扫翻页）
      const name = await page.eval(`[...document.querySelectorAll('.photo-card')].map((c) => c.getAttribute('aria-label')).find((n) => /\\.(cr2|cr3|nef|arw|dng|jpe?g|png|webp|heic|tiff?)$/i.test(n || ''))`)
      if (!name) throw new Error('no image card found in browse grid')
      const cardSel = `.photo-card[aria-label=${JSON.stringify(name)}]`
      const heartSel = `!!document.querySelector(${JSON.stringify(`.photo-card[aria-label=${JSON.stringify(name)}] span[aria-label]`)})`
      let swipeNote = ''
      if (mobile) {
        // 手机：单击打开详情 → 横扫翻页（浏览集里有足够的同列表项）→ ⓘ 信息面板 → 心形
        await page.click(cardSel)
        await page.waitFor(`!!document.querySelector('[role="dialog"]')`, 10000, 'detail opened')
        const pos0 = await page.eval(`document.querySelector('[data-detail-pos]')?.textContent`)
        await page.swipe(330, 300, 60, 300)
        await sleep(800)
        const pos1 = await page.eval(`document.querySelector('[data-detail-pos]')?.textContent`)
        if (pos1 === pos0) throw new Error(`swipe did not navigate (${pos0} -> ${pos1})`)
        await page.swipe(60, 300, 330, 300)
        await sleep(800)
        swipeNote = `; swipe ${pos0} -> ${pos1} -> back`
        await page.click('[data-detail-info]')
        await page.waitFor(`!!document.querySelector('[data-detail-inspector] [data-favorite-toggle]')`, 8000, 'info sheet')
        await shot('favorite-info-sheet')
        await page.click('[data-detail-inspector] [data-favorite-toggle]')
        await page.waitFor(`document.querySelector('[data-detail-inspector] [data-favorite-toggle]')?.getAttribute('aria-pressed') === 'true'`, 8000, 'favorited')
        await page.key('Escape')
        await page.waitFor(`!document.querySelector('[role="dialog"]')`, 5000)
      } else {
        await page.click(cardSel)
        await page.key('f')
        await page.waitFor(heartSel, 8000, 'heart badge on card')
      }
      // 收藏视图里能看到（先等标题切换，避免在旧视图上误判）
      if (mobile) {
        await page.click('[data-sidebar-toggle]')
        await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
      }
      await page.clickNavRow(S.favorites)
      await page.waitFor(`document.querySelector('h1')?.textContent === ${JSON.stringify(S.favorites)}`, 8000, 'Favorites view opened')
      await page.waitFor(`[...document.querySelectorAll('.photo-card')].some((c) => c.getAttribute('aria-label') === ${JSON.stringify(name)})`, 10000, 'item in Favorites view')
      await shot('favorites-view')
      // 还原
      if (mobile) {
        await page.eval(`(() => { [...document.querySelectorAll('.photo-card')].find((c) => c.getAttribute('aria-label') === ${JSON.stringify(name)}).click() })()`)
        await page.waitFor(`!!document.querySelector('[role="dialog"]')`, 10000)
        await page.click('[data-detail-info]')
        await page.waitFor(`!!document.querySelector('[data-detail-inspector] [data-favorite-toggle]')`, 8000)
        await page.click('[data-detail-inspector] [data-favorite-toggle]')
        await page.waitFor(`document.querySelector('[data-detail-inspector] [data-favorite-toggle]')?.getAttribute('aria-pressed') === 'false'`, 8000, 'unfavorited')
        await page.key('Escape')
        await page.waitFor(`!document.querySelector('[role="dialog"]')`, 5000)
        await page.click('[data-sidebar-toggle]')
        await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
      } else {
        await page.eval(`(() => { [...document.querySelectorAll('.photo-card')].find((c) => c.getAttribute('aria-label') === ${JSON.stringify(name)}).click() })()`)
        await page.key('f')
        await page.waitFor(`![...document.querySelectorAll('.photo-card')].some((c) => c.getAttribute('aria-label') === ${JSON.stringify(name)})`, 10000, 'removed from Favorites view')
      }
      await page.clickNavRow(S.all)
      await page.waitFor(`document.querySelectorAll('.photo-card').length > 0`, 15000)
      return `favorited and restored: ${name}${swipeNote}`
    },
  },
  {
    name: 'filter-orientation',
    async run(ctx) {
      const { page, S, shot } = ctx
      await goAll(ctx)
      const before = await page.itemCount()
      await page.click(`button[title=${JSON.stringify(S.filterTitle)}]`)
      await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(S.landscape)})`, 8000, 'filter bar expanded')
      await page.eval(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(S.landscape)}).click() })()`)
      await page.waitFor(`(() => { const n = parseInt(document.querySelector('footer span')?.textContent ?? '', 10); return Number.isFinite(n) && n > 0 && n < ${before} })()`, 15000, `count narrows from ${before}`)
      const after = await page.itemCount()
      await shot('filter-active')
      await page.eval(`(() => { const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === ${JSON.stringify(S.clear)}); btns[btns.length - 1]?.click() })()`)
      await page.waitFor(`(() => { const n = parseInt(document.querySelector('footer span')?.textContent ?? '', 10); return n === ${before} })()`, 15000, 'count restored after clear')
      await page.click(`button[title=${JSON.stringify(S.filterTitle)}]`)
      await sleep(400)
      return `landscape narrows ${before} -> ${after}, cleared back to ${before}`
    },
  },
  {
    name: 'smart-album',
    async run(ctx) {
      const { page, mobile, S, shot } = ctx
      await goAll(ctx)
      // 清掉以前跑剩的同名 / 未命名相册，并记下现有 id（结尾只删这次新建的）
      await page.eval(`(async () => {
        for (const a of await window.api.getSmartAlbums()) {
          if (a.name === '瀑布' || a.name === '未命名相册' || a.name === 'Untitled Album') await window.api.deleteSmartAlbum(a.id)
        }
      })()`)
      const beforeIds = await page.eval(`window.api.getSmartAlbums().then((xs) => xs.map((x) => x.id))`)
      await page.setSearch('瀑布')
      // 等查询真正生效（副标题出现引号查询），再存为相册 —— 否则存下的是空查询
      await page.waitFor(`(document.querySelector('header p')?.textContent || '').includes('瀑布')`, 20000, 'query applied')
      await page.waitFor(`!!document.querySelector('[data-save-search]')`, 15000, 'save-search star')
      await page.click('[data-save-search]')
      // 保存即打开相册：标题变为相册名
      await page.waitFor(`document.querySelector('h1')?.textContent === '瀑布'`, 10000, 'album opened after save')
      await shot('album-saved')
      // 从侧栏 / 抽屉再次打开
      if (mobile) {
        await page.click('[data-sidebar-toggle]')
        await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
      }
      await page.clickNavRow(S.all)
      await page.waitFor(`document.querySelectorAll('.photo-card').length > 0`, 15000)
      if (mobile) {
        await page.click('[data-sidebar-toggle]')
        await page.waitFor(`!!document.querySelector('[data-drawer]')`, 5000)
      }
      const opened = await page.eval(`(() => {
        const row = [...document.querySelectorAll('[data-album-row]')].find((r) => (r.textContent || '').includes('瀑布'))
        if (!row) return false
        row.querySelector('[role="button"]').click(); return true
      })()`)
      if (!opened) throw new Error('album row not found in sidebar')
      await page.waitFor(`document.querySelector('h1')?.textContent === '瀑布' && document.querySelectorAll('.photo-card').length > 0`, 15000, 'album reopened with results')
      // 删除（网页版没有相册右键菜单 —— 原生菜单是桌面专属；用 API 清理这次新建的）
      await page.eval(`(async () => {
        const before = new Set(${JSON.stringify(beforeIds)})
        for (const a of await window.api.getSmartAlbums()) {
          if (!before.has(a.id)) await window.api.deleteSmartAlbum(a.id)
        }
      })()`)
      await page.waitFor(`![...document.querySelectorAll('[data-album-row]')].some((r) => (r.textContent || '').includes('瀑布'))`, 10000, 'album deleted')
      await page.setSearch('')
      await sleep(800)
      return 'saved, reopened from sidebar, deleted (delete via api: web has no album context menu yet)'
    },
  },
  {
    name: 'settings-folders-readonly',
    async run({ page, S }) {
      await page.click(`button[title^=${JSON.stringify(S.settingsPrefix)}]`)
      await page.waitFor(`location.hash === '#settings'`, 8000, 'settings route')
      await page.eval(`(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(S.tabFolders)})?.click() })()`)
      await page.waitFor(`!!document.querySelector('[data-server-folders-note]')`, 8000, 'server folders note')
      await page.waitFor(`document.querySelectorAll('[data-folder-row]').length > 0`, 10000, 'folder list')
      const folders = await page.eval(`document.querySelectorAll('[data-folder-row]').length`)
      const addButtons = await page.eval(`[...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === ${JSON.stringify(S.addFolder)}).length`)
      if (addButtons > 0) throw new Error('Add Folder button present in web edition')
      const removeButtons = await page.eval(`[...document.querySelectorAll('[data-folder-row] button')].length`)
      if (removeButtons > 0) throw new Error('folder remove buttons present in web edition')
      return `${folders} folders listed read-only, no add/remove controls`
    },
  },
  {
    name: 'language-switch',
    async run({ page, lang, S, shot }) {
      // 在设置 › 通用里切到另一种语言（整页刷新），验证后切回；上一步失败时自行进入设置
      if (await page.eval(`location.hash`) !== '#settings') {
        await page.click(`button[title^=${JSON.stringify(S.settingsPrefix)}]`)
        await page.waitFor(`location.hash === '#settings'`, 8000)
      }
      const other = lang === 'zh' ? STR.en : STR.zh
      await page.eval(`(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(S.tabGeneral)})?.click() })()`)
      await sleep(400)
      await page.eval(`(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(other.langButton)})?.click() })()`)
      await sleep(1500)
      await page.waitFor(`!!window.api && [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === ${JSON.stringify(other.tabGeneral)})`, 20000, 'UI reloaded in other language')
      await shot('language-switched')
      await page.eval(`(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(S.langButton)})?.click() })()`)
      await sleep(1500)
      await page.waitFor(`!!window.api && [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === ${JSON.stringify(S.tabGeneral)})`, 20000, 'UI restored to run language')
      return `switched ${lang} -> ${lang === 'zh' ? 'en' : 'zh'} -> ${lang}`
    },
  },
  {
    name: 'live-update',
    async run({ page, liveDir, runId }) {
      if (!liveDir) return { skip: 'no --live-dir given' }
      // 回到主界面 · 全部 · 无查询（浏览模式下库变化会自动刷新网格）
      await page.eval(`(() => { location.hash = '' })()`)
      await sleep(600)
      await page.waitFor(`document.querySelectorAll('.photo-card').length > 0`, 15000, 'browse grid')
      await page.eval(`window.__e2eNoReload = 1`)
      const src = readdirSync(liveDir).find((f) => /\.jpe?g$/i.test(f))
      if (!src) throw new Error(`no jpg in ${liveDir} to derive a new image from`)
      const name = `live-e2e-${runId}.jpg`
      const dest = join(liveDir, name)
      // 重采样出一张内容不同的新图（不同 hash），拷进库目录
      execFileSync('sips', ['-Z', '512', join(liveDir, src), '--out', dest], { stdio: 'ignore' })
      try {
        await page.waitFor(
          `[...document.querySelectorAll('.photo-card')].some((c) => (c.getAttribute('aria-label') || '') === ${JSON.stringify(name)}) && window.__e2eNoReload === 1`,
          90000,
          `${name} appears in grid without reload`
        )
      } finally {
        rmSync(dest, { force: true })
      }
      return `${name} appeared via WS-driven refresh, no page reload`
    },
  },
  {
    name: 'logout',
    async run({ page, S }) {
      await page.click(`button[title^=${JSON.stringify(S.settingsPrefix)}]`)
      await page.waitFor(`location.hash === '#settings'`, 8000)
      await page.eval(`(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(S.tabGeneral)})?.click() })()`)
      await page.waitFor(`!!document.querySelector('[data-logout]')`, 8000, 'logout button')
      await page.click('[data-logout]')
      await page.waitFor(`location.pathname === '/login'`, 10000, 'back at /login')
      return 'session cleared, back at /login'
    },
  },
]

// ─── 运行器 ──────────────────────────────────────────────────────────────────

/** 某一步失败后的兜底复位：回主界面、关浮层、清查询图和查询，别让失败级联到后面的步骤 */
async function recover(page) {
  try {
    await page.eval(`(() => { if (location.hash) location.hash = '' })()`)
    await sleep(400)
    for (let i = 0; i < 3; i++) await page.key('Escape')
    await page.eval(`(() => { document.querySelector('[data-clear-image]')?.click() })()`)
    await page.setSearch('').catch(() => {})
    await sleep(1000)
  } catch { /* 尽力而为 */ }
}

async function runSuite(viewport, lang, cropFile, cropSource) {
  const mobile = viewport === 'mobile'
  const dir = join(OUT, `${viewport}-${lang}`)
  mkdirSync(dir, { recursive: true })
  const chrome = await Chrome.launch({ mobile })
  const results = []
  try {
    const page = await Page.create(chrome, { mobile })
    const runId = `${viewport}-${lang}-${Date.now().toString(36)}`
    let idx = 0
    for (const step of STEPS) {
      idx++
      const prefix = String(idx).padStart(2, '0')
      const shot = (suffix) => page.screenshot(join(dir, `${prefix}-${step.name}-${suffix}.png`))
      const ctx = { page, base: BASE, password: PASSWORD, lang, mobile, S: STR[lang], shot, liveDir: LIVE_DIR, cropFile, cropSource, runId }
      let status = 'PASS'
      let note = ''
      try {
        const r = await step.run(ctx)
        if (r && typeof r === 'object' && r.skip) { status = 'SKIP'; note = r.skip }
        else note = r ?? ''
      } catch (e) {
        status = 'FAIL'
        note = e.message
      }
      await page.screenshot(join(dir, `${prefix}-${step.name}.png`)).catch(() => {})
      results.push({ viewport, lang, step: step.name, status, note })
      console.log(`  [${viewport}/${lang}] ${status === 'PASS' ? '✓' : status === 'SKIP' ? '–' : '✗'} ${step.name}${note ? ` — ${note}` : ''}`)
      if (status === 'FAIL') {
        if (step.name === 'login' || step.name === 'login-wrong-password') break // 后面全都依赖登录
        await recover(page)
      }
    }
  } finally {
    await chrome.close()
  }
  return results
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  if (!existsSync(CHROME)) {
    console.error(`Chrome not found at ${CHROME} (use --chrome)`)
    process.exit(2)
  }
  // 以图搜图的查询图：从库里（--live-dir 同级）或内置演示图裁一块。没有 --live-dir 时需要
  // 一张本地图：从服务器下载第一张缩略图不行（要原图语义），所以要求 --live-dir 或 --crop-source。
  let cropFile = null
  let cropSource = null
  const cropSrcArg = flag('crop-source') ?? (LIVE_DIR ? (() => {
    const f = readdirSync(LIVE_DIR).find((x) => /\.jpe?g$/i.test(x) && !x.startsWith('live-e2e-'))
    return f ? join(LIVE_DIR, f) : null
  })() : null)
  if (cropSrcArg) {
    cropSource = basename(cropSrcArg)
    cropFile = join(OUT, `crop-of-${cropSource}`)
    // 中心裁剪约 70%：与原图字节完全不同，但主体仍在画面里（过小的固定裁剪可能只剩背景）
    const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', cropSrcArg], { encoding: 'utf8' })
    const w = parseInt(dims.match(/pixelWidth: (\d+)/)?.[1] ?? '0', 10)
    const h = parseInt(dims.match(/pixelHeight: (\d+)/)?.[1] ?? '0', 10)
    if (w < 10 || h < 10) throw new Error(`cannot read dimensions of ${cropSrcArg}`)
    execFileSync('sips', ['-c', String(Math.round(h * 0.7)), String(Math.round(w * 0.7)), cropSrcArg, '--out', cropFile], { stdio: 'ignore' })
  }

  const all = []
  for (const viewport of VIEWPORTS) {
    for (const lang of LANGS) {
      console.log(`\n── ${viewport} · ${lang} ──`)
      all.push(...(await runSuite(viewport, lang, cropFile, cropSource)))
    }
  }

  const fails = all.filter((r) => r.status === 'FAIL')
  const skips = all.filter((r) => r.status === 'SKIP')
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), results: all }, null, 1))
  console.log(`\n${all.length} steps: ${all.length - fails.length - skips.length} PASS, ${skips.length} SKIP, ${fails.length} FAIL`)
  console.log(`screenshots + summary.json in ${OUT}`)
  if (fails.length > 0) {
    for (const f of fails) console.error(`  FAIL [${f.viewport}/${f.lang}] ${f.step}: ${f.note}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
