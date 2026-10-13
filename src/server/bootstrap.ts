/**
 * Node ABI 引导（必须是服务器入口 import 的第一个模块）：
 *
 * 仓库的 node_modules 由 postinstall（electron-builder install-app-deps）按 Electron 的
 * NODE_MODULE_VERSION 重建，其中 better-sqlite3 是 ABI 绑定的 —— 普通 Node 22 加载会报
 * ERR_DLOPEN_FAILED。其余原生依赖（sharp / koffi / onnxruntime-node / @node-rs/jieba）都是
 * N-API 或多 ABI 预编译，两边通用。
 *
 * 解法：`server/package.json` 里声明同版本的 better-sqlite3，`npm run server:deps` 在
 * server/node_modules 装出 Node ABI 的构建；本模块在普通 Node 下把这些包的解析重定向过去。
 * Electron（桌面 / CLI via ELECTRON_RUN_AS_NODE）完全不受影响；Docker 镜像（阶段 3）里
 * 整个 node_modules 本来就按 Node ABI 安装，override 目录不存在时这里是空操作。
 */
import Module from 'module'
import { existsSync } from 'fs'
import { join } from 'path'

/** 需要 Node ABI 构建的包（ABI 绑定、非 N-API） */
const NODE_ABI_PACKAGES = new Set(['better-sqlite3'])

export function enableNodeAbiOverrides(repoRoot: string): void {
  if (process.versions.electron) return
  const overrideBase = join(repoRoot, 'server')
  if (!existsSync(join(overrideBase, 'node_modules'))) return

  type ModuleInternal = { _resolveFilename(request: string, ...rest: unknown[]): string }
  const M = Module as unknown as ModuleInternal
  const orig = M._resolveFilename
  M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]): string {
    const top = request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]
    if (NODE_ABI_PACKAGES.has(top)) {
      try {
        return require.resolve(request, { paths: [overrideBase] })
      } catch {
        // server/node_modules 里没有：退回正常解析（会在加载时报 ABI 错误，错误信息更直观）
      }
    }
    return orig.call(this, request, ...rest)
  }
  console.log(`[server] native module overrides active: ${join(overrideBase, 'node_modules')} (${[...NODE_ABI_PACKAGES].join(', ')})`)
}

// 入口 `import './bootstrap'` 时立即生效（CommonJS 的 require 按 import 顺序执行，
// 排在后面的 db/core 模块加载 better-sqlite3 时已经重定向）
enableNodeAbiOverrides(join(__dirname, '..', '..', '..'))
