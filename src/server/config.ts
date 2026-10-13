/**
 * 服务器配置：全部来自环境变量（Docker / NAS 的习惯），启动时解析一次。
 *
 *   VIXEL_DATA_DIR       数据目录（library.db、thumbnails、各种缓存）。必填。
 *   VIXEL_LIBRARY_DIRS   逗号分隔的媒体库目录；启动时登记为监视文件夹并保持同步
 *   VIXEL_MODELS_DIR     模型目录（默认 <repo>/resources/models）
 *   VIXEL_LITERT_DIR     LiteRT-LM 原生库目录（默认 <repo>/resources/litert/<platform>-<arch>）
 *   VIXEL_PORT           HTTP + WebSocket 端口（默认 8080）
 *   VIXEL_HOST           监听地址（默认 0.0.0.0）
 *   VIXEL_PASSWORD       单用户口令；不设则拒绝启动（本机开发可 VIXEL_ALLOW_NO_AUTH=1）
 *   VIXEL_ALLOW_NO_AUTH  =1 允许无口令启动（仅本地开发）
 *   VIXEL_THREADS        CPU 推理线程数（透传给 LiteRT，见 litertProvider）
 *   VIXEL_WEB_DIR        网页前端构建产物目录（默认 <repo>/dist/web，npm run build:web）
 */
import { isAbsolute, join, resolve } from 'path'

export interface ServerConfig {
  dataDir: string
  libraryDirs: string[]
  modelsDir: string
  litertDir: string
  port: number
  host: string
  password: string | null
  allowNoAuth: boolean
  webDir: string
}

export class ConfigError extends Error {}

export function parseServerConfig(env: Record<string, string | undefined>, repoRoot: string): ServerConfig {
  const dataDir = env.VIXEL_DATA_DIR?.trim()
  if (!dataDir) throw new ConfigError('VIXEL_DATA_DIR is required (library.db, thumbnails and caches live there)')

  const libraryDirs = (env.VIXEL_LIBRARY_DIRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => resolve(p))
  for (const dir of libraryDirs) {
    if (!isAbsolute(dir)) throw new ConfigError(`VIXEL_LIBRARY_DIRS entries must be absolute paths, got: ${dir}`)
  }

  const port = env.VIXEL_PORT ? Number(env.VIXEL_PORT) : 8080
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`VIXEL_PORT must be a port number, got: ${env.VIXEL_PORT}`)
  }

  const password = env.VIXEL_PASSWORD?.trim() || null
  const allowNoAuth = env.VIXEL_ALLOW_NO_AUTH === '1'
  if (!password && !allowNoAuth) {
    throw new ConfigError('VIXEL_PASSWORD is required (set VIXEL_ALLOW_NO_AUTH=1 only for local development)')
  }
  if (password && password.length < 4) {
    throw new ConfigError('VIXEL_PASSWORD must be at least 4 characters')
  }

  return {
    dataDir: resolve(dataDir),
    libraryDirs,
    modelsDir: env.VIXEL_MODELS_DIR?.trim() || join(repoRoot, 'resources', 'models'),
    litertDir: env.VIXEL_LITERT_DIR?.trim() || join(repoRoot, 'resources', 'litert', `${process.platform}-${process.arch}`),
    port,
    host: env.VIXEL_HOST?.trim() || '0.0.0.0',
    password,
    allowNoAuth,
    webDir: env.VIXEL_WEB_DIR?.trim() || join(repoRoot, 'dist', 'web'),
  }
}
