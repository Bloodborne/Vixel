/** 弹窗：连接状态（GET /v1/ping，带令牌看是否配对）+ 最近保存列表 */
const msg = (k, subs) => chrome.i18n.getMessage(k, subs)

const DEFAULT_PORT = 41720

async function cfg() {
  const { port, token } = await chrome.storage.local.get(['port', 'token'])
  return { port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT, token: token || '' }
}

async function checkStatus() {
  const dot = document.getElementById('dot')
  const text = document.getElementById('status-text')
  const { port, token } = await cfg()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/ping`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const body = await res.json()
    if (body.paired) {
      dot.className = 'dot ok'
      text.textContent = msg('popupConnected', [body.version || ''])
    } else {
      dot.className = 'dot bad'
      text.textContent = msg('popupUnpaired')
    }
  } catch {
    dot.className = 'dot bad'
    text.textContent = msg('popupOffline')
  }
}

async function renderRecent() {
  const { recent = [] } = await chrome.storage.local.get('recent')
  document.getElementById('recent-title').textContent = msg('popupRecent')
  const ul = document.getElementById('recent')
  const empty = document.getElementById('empty')
  if (recent.length === 0) {
    empty.hidden = false
    empty.textContent = msg('popupEmpty')
    return
  }
  for (const r of recent) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = r.name || r.url || ''
    name.title = r.url || r.pageUrl || ''
    const st = document.createElement('span')
    st.className = r.ok ? 'st' : 'st bad'
    st.textContent = r.ok ? msg(r.status === 'exists' ? 'statusExists' : 'statusSaved') : `${msg('statusFailed')}: ${r.error || ''}`
    li.append(name, st)
    ul.appendChild(li)
  }
}

document.getElementById('options').textContent = msg('popupOptions')
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage())
checkStatus()
renderRecent()
