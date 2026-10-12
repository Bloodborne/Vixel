import { cpSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * pdfjs-dist 的运行时静态资源（见 src/main/pdfRender.ts）：
 *   cmaps           预定义 CMap（CJK 文字渲染必需）
 *   standard_fonts  PDF 14 种标准字体的替身（未内嵌字体的 PDF）
 *   wasm            JPX / JBIG2 / ICC 解码器
 *   iccs            CMYK 预置 ICC profile
 * 构建时从 node_modules 拷进 out/renderer（随 asar 打包，主进程 net.fetch(file://) 可读），
 * 开发模式不拷（pdfRender.ts 直接读 node_modules）。
 */
function copyPdfjsAssets(): { name: string; apply: 'build'; closeBundle: () => void } {
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    closeBundle() {
      for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        cpSync(resolve('node_modules/pdfjs-dist', dir), resolve('out/renderer', dir), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // inference：推理 utilityProcess 的入口（见 src/main/inference.ts）
        input: {
          index: resolve('src/main/index.ts'),
          inference: resolve('src/main/inference.ts')
        },
        external: ['better-sqlite3', 'sharp', 'onnxruntime-node', 'sqlite-vec']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // pdf：PDF 渲染隐藏窗口的最小 preload（见 src/main/pdfRender.ts）
        input: {
          index: resolve('src/preload/index.ts'),
          pdf: resolve('src/preload/pdf.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        // pdf.html：PDF 渲染隐藏窗口（pdf.js + canvas），与主界面分开打包
        input: {
          index: resolve('src/renderer/index.html'),
          pdf: resolve('src/renderer/pdf.html')
        }
      }
    },
    plugins: [react(), copyPdfjsAssets()]
  }
})
