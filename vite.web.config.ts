/**
 * 网页版（服务器版前端）的构建：`npm run build:web` → dist/web，由 src/server 静态服务。
 * 与 electron-vite 的 renderer 构建共用同一套 React 代码（src/renderer/src），
 * 只有入口不同：src/web/main.ts 先注入 window.api（HTTP/WS 实现）再加载应用。
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },
})
