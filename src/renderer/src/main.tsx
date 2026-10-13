import './lib/localeInit'
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SettingsWindow } from './components/settings/SettingsWindow'
import { QuickPanelWindow } from './components/quickpanel/QuickPanelWindow'
import './styles/globals.css'

// 设置窗口 / 快速搜索面板和主窗口共用这一个入口：桌面上主进程用 hash 区分（载入后不变），
// 网页版里 #settings 是应用内路由（设置不再是独立窗口），要跟随 hashchange
const isPanel = window.location.hash === '#panel'

// 面板窗口：macOS 毛玻璃（vibrancy）要从透明的网页背景里透出来，盖掉 body 的默认底色
if (isPanel) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
}

function Root(): JSX.Element {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return hash === '#settings' ? <SettingsWindow /> : hash === '#panel' ? <QuickPanelWindow /> : <App />
}

// 开发期（或 localStorage 设 vixel.profile=1）观测渲染进程长任务，>50ms 直接 console.warn
try {
  if (import.meta.env.DEV || localStorage.getItem('vixel.profile') === '1') {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) console.warn(`[longtask] ${Math.round(entry.duration)}ms @ ${(entry.startTime / 1000).toFixed(1)}s`)
      }
    }).observe({ entryTypes: ['longtask'] })
  }
} catch { /* 环境不支持就算了 */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
