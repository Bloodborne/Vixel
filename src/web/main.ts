/**
 * 网页版入口：先装好 window.api（含同步可读的 locale），再动态 import 应用。
 * renderer 的第一个 import（lib/localeInit.ts）在模块求值时同步读 window.api.locale，
 * 所以这两步的顺序是硬约束 —— 静态 import 应用模块会先于本文件的代码执行。
 * 未登录时 createWebApi 的第一个请求就会 401 → 跳转 /login（服务器渲染的登录页）。
 */
import { createWebApi } from './api'

createWebApi()
  .then(async (api) => {
    window.api = api
    // 网页版专属的 CSS 钩子（globals.css 里按 [data-platform="web"] 限定的规则）
    document.documentElement.dataset.platform = 'web'
    await import('../renderer/src/main')
  })
  .catch((err) => {
    console.error('[web] bootstrap failed:', err)
    const root = document.getElementById('root')
    if (root) {
      root.innerHTML = ''
      const p = document.createElement('p')
      p.style.cssText = 'margin:40vh auto 0;max-width:32em;text-align:center;font:14px system-ui;color:#999;'
      p.textContent = `Vixel failed to load: ${err instanceof Error ? err.message : String(err)}`
      root.appendChild(p)
    }
  })
