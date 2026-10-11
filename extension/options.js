/** 选项：端口 + 配对令牌（在 Vixel 设置 → 通用 → 浏览器扩展 里拷贝） */
const msg = (k) => chrome.i18n.getMessage(k)
const DEFAULT_PORT = 41720

document.title = msg('optTitle')
document.getElementById('title').textContent = msg('optTitle')
document.getElementById('port-label').textContent = msg('optPort')
document.getElementById('token-label').textContent = msg('optToken')
document.getElementById('token-hint').textContent = msg('optTokenHint')
document.getElementById('save').textContent = msg('optSave')

chrome.storage.local.get(['port', 'token']).then(({ port, token }) => {
  document.getElementById('port').value = String(port || DEFAULT_PORT)
  document.getElementById('token').value = token || ''
})

document.getElementById('save').addEventListener('click', async () => {
  const port = Number(document.getElementById('port').value)
  const token = document.getElementById('token').value.trim()
  await chrome.storage.local.set({
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT,
    token,
  })
  const saved = document.getElementById('saved')
  saved.hidden = false
  saved.textContent = msg('optSaved')
  setTimeout(() => { saved.hidden = true }, 1500)
})
