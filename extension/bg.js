/**
 * 存到 Vixel —— service worker。
 *
 * 图片字节由扩展自己在浏览器里取（fetch），再 POST 给本机 Vixel 的收集服务
 * （http://127.0.0.1:<端口>/v1/collect，Bearer 令牌 + X-Vixel-Meta 元数据头）。
 * Vixel 本身从不发起对外请求；本扩展也只和 127.0.0.1 通信（图片本身除外）。
 */

const DEFAULT_PORT = 41720
const MAX_RECENT = 10

const cfg = async () => {
  const { port, token } = await chrome.storage.local.get(['port', 'token'])
  return { port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT, token: token || '' }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save-image', title: chrome.i18n.getMessage('menuSaveImage'), contexts: ['image'] })
  chrome.contextMenus.create({ id: 'save-screenshot', title: chrome.i18n.getMessage('menuSaveShot'), contexts: ['page'] })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const run = async () => {
    if (info.menuItemId === 'save-image' && info.srcUrl) {
      await saveImage(info.srcUrl, tab)
    } else if (info.menuItemId === 'save-screenshot') {
      await saveScreenshot(tab)
    }
  }
  run().catch((err) => record({ ok: false, name: info.srcUrl || (tab && tab.title) || '', error: String((err && err.message) || err) }))
})

async function saveImage(srcUrl, tab) {
  // data: URL（页面内嵌图片）也能转成字节；http(s) 直接取
  const res = await fetch(srcUrl)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const blob = await res.blob()
  await post(blob, {
    url: /^https?:/i.test(srcUrl) ? srcUrl : undefined,
    pageUrl: tab && tab.url,
    pageTitle: tab && tab.title,
  })
}

async function saveScreenshot(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab ? tab.windowId : undefined, { format: 'png' })
  const blob = await (await fetch(dataUrl)).blob()
  await post(blob, { pageUrl: tab && tab.url, pageTitle: tab && tab.title, name: (tab && tab.title) || 'Screenshot' })
}

/** X-Vixel-Meta：base64url(JSON)，只带有值的字段 */
function metaHeader(meta) {
  const clean = {}
  for (const k of Object.keys(meta)) if (meta[k]) clean[k] = meta[k]
  const bytes = new TextEncoder().encode(JSON.stringify(clean))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function post(blob, meta) {
  const { port, token } = await cfg()
  const type = /^image\/[a-z0-9.+-]+$/i.test(blob.type) ? blob.type : 'image/unknown'
  const res = await fetch(`http://127.0.0.1:${port}/v1/collect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, 'X-Vixel-Meta': metaHeader(meta) },
    body: blob,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status)
  await record({ ok: true, status: body.status, name: meta.name || meta.url || meta.pageTitle || '', url: meta.url, pageUrl: meta.pageUrl })
}

/** 最近保存记录（popup 显示）+ 角标反馈 */
async function record(entry) {
  const { recent = [] } = await chrome.storage.local.get('recent')
  recent.unshift({ ...entry, at: Date.now() })
  await chrome.storage.local.set({ recent: recent.slice(0, MAX_RECENT) })
  const ok = !!entry.ok
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#c62828' })
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' })
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500)
}
