/**
 * 索引扫描的跳过规则（纯函数；watcher 把它们接到 chokidar 的 ignored 和 add 处理上）。
 *
 * 1. 永不读取的文件：密钥 / 凭据类（.pem / .key / id_rsa / .env / .kdbx …）。
 *    它们本来就不是媒体扩展名，但明确列出 —— 这些文件连 stat 之外的读取都不该发生。
 * 2. 跳过的目录：隐藏目录（点开头）、node_modules / .git / 构建缓存、应用与资源包
 *    （.app / .photoslibrary / .fcpbundle …—— 包内是应用自己管理的内部结构）。
 *    用户亲手选为根目录的文件夹永远不跳过（见 watcher：根目录不做这些判定）。
 * 3. 云端占位文件：iCloud 的 `.xxx.icloud` 占位、"逻辑大小 > 0 但磁盘 0 块"的 dataless
 *    文件（macOS SF_DATALESS 的廉价近似，fs.stat 的 blocks 就能看出来）—— 绝不触发下载。
 *    Windows 的 OneDrive 按需文件用 GetFileAttributesW 的 OFFLINE / RECALL 位判定
 *    （见 isCloudFileAttributes；FFI 调用在 watcher 侧，按平台懒加载）。
 * 4. 数据集目录：同类媒体文件 ≥ DATASET_MIN_FILES 且名字绝大多数是机器生成
 *    （frame_0042 / clip_000123 / UUID / 长十六进制），视为训练集 / 导出帧之类的数据集，
 *    整目录跳过并在设置里列出，可逐个"仍然索引"。相机命名（IMG_1234 / DSC_0001 /
 *    PXL_2026… / 20240101_123456）明确豁免 —— 一卡相机照片不是数据集。
 */

import type { MediaKind } from '../shared/types'

// ── 1. 密钥 / 凭据文件 ──────────────────────────────────────────────────────

const SENSITIVE_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.kdbx', '.ppk',
  '.asc', '.gpg', '.pgp', '.der', '.csr', '.crt', '.cer', '.p8', '.keychain',
])

const SENSITIVE_NAME_RES = [
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i, // id_rsa, id_ed25519.pub, id_rsa.bak
  /^\.env(\..*)?$/i,                      // .env, .env.local（点开头本来就隐藏，双保险）
  /^(credentials|secrets?)(\.|$)/i,
]

export function isSensitiveFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
  if (SENSITIVE_EXTENSIONS.has(ext)) return true
  return SENSITIVE_NAME_RES.some((re) => re.test(fileName))
}

// ── 2. 跳过的目录 ───────────────────────────────────────────────────────────

const SKIP_DIR_NAMES = new Set([
  'node_modules', '__pycache__', 'bower_components',
  // 常见构建 / 缓存目录（非点开头的；点开头的由隐藏规则覆盖）
  'DerivedData', 'xcuserdata',
  // NAS 系统目录：群晖每个照片目录里都有 @eaDir（DSM 自己生成的缩略图 SYNOPHOTO_THUMB_*.jpg），
  // #recycle 是回收站，#snapshot 是快照（整库再来一份）；威联通是 @Recycle / @Recently-Snapshot。
  // 不跳过的话图库里会冒出成倍的缩略图和已删除的照片
  '@eaDir', '#recycle', '#snapshot', '@Recycle', '@Recently-Snapshot', '@Transcode',
  // Windows 卷根的系统目录（Docker 挂载 Windows 盘 / 桌面版选整盘时）
  '$RECYCLE.BIN', 'System Volume Information',
])

/** 应用 / 资源包：目录名带这些扩展名的是包，内部结构由对应应用管理，整包跳过 */
const BUNDLE_EXTENSIONS = new Set([
  '.app', '.framework', '.bundle', '.xcodeproj', '.xcworkspace', '.appex', '.kext',
  // 媒体类图库包：照片图库（.photoslibrary）由"照片"App 管理，内含 originals，
  // 但结构私有、体量巨大且随系统更新变化 —— 跳过内部；用户把 .photoslibrary 本身
  // 选为根目录时不受此规则影响（根目录永不自动跳过），设置里会提示。
  '.photoslibrary', '.migratedphotolibrary', '.aplibrary', '.imovielibrary',
  '.fcpbundle', '.fcpcache', '.lrlibrary', '.tvlibrary', '.musiclibrary',
])

export function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

export function isBundleName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && BUNDLE_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

export function shouldSkipDirName(name: string): boolean {
  return isHiddenName(name) || SKIP_DIR_NAMES.has(name) || isBundleName(name)
}

// ── 3. 云端占位 ─────────────────────────────────────────────────────────────

/** iCloud Drive 已驱逐文件的占位名：`.报告.pdf.icloud`（有时无前导点） */
export function isCloudPlaceholderName(fileName: string): boolean {
  return /\.icloud$/i.test(fileName)
}

/**
 * 逻辑大小 > 0 但磁盘上一个块都没有：macOS 上是 dataless（SF_DATALESS）文件的
 * 廉价判据（fs.stat 自带 blocks，无需额外 syscall / FFI）。读它会触发云端下载。
 */
export function looksDataless(size: number, blocks: number | null | undefined): boolean {
  return size > 0 && blocks === 0
}

// Windows 文件属性位（GetFileAttributesW）：OneDrive 等按需文件
const FILE_ATTRIBUTE_OFFLINE = 0x1000
const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000

/** Windows：这些属性位任一在 → 云端占位，读取会触发下载 */
export function isCloudFileAttributes(attributes: number): boolean {
  return (attributes & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)) !== 0
}

// ── 路径级判定（chokidar ignored 用） ──────────────────────────────────────

/**
 * 监视根目录下的一条路径该不该整个忽略。root 本身永不忽略（用户亲手选的）。
 * 中间每一级目录按目录规则判；最后一段按目录 + 文件规则判（chokidar 的 ignored
 * 对目录和文件都会调用，媒体文件不会撞上目录规则的名字）。
 */
export function shouldIgnorePath(root: string, fullPath: string): boolean {
  if (fullPath === root) return false
  let rel = fullPath.startsWith(root) ? fullPath.slice(root.length) : fullPath
  const segments = rel.split(/[/\\]/).filter(Boolean)
  if (segments.length === 0) return false
  for (let i = 0; i < segments.length - 1; i++) {
    if (shouldSkipDirName(segments[i])) return true
  }
  const last = segments[segments.length - 1]
  return shouldSkipDirName(last) || isSensitiveFile(last) || isCloudPlaceholderName(last)
}

// ── 4. 数据集目录 ───────────────────────────────────────────────────────────

/** 一个目录里同类媒体至少这么多、且机器命名占比 ≥ DATASET_MACHINE_RATIO 才算数据集 */
export const DATASET_MIN_FILES = 200
export const DATASET_MACHINE_RATIO = 0.8

/**
 * 相机 / 手机 / 常见应用的拍摄命名 —— 明确不算机器生成（一卡相机照片不是数据集）。
 * 匹配不含扩展名的基础名。
 */
const CAMERA_NAME_RES = [
  /^_?IMG[-_ ]?E?\d{3,5}(\s?\(\d+\)|[-_ ]?(edited|copy|副本))?$/i, // IMG_1234（Apple / Canon）
  /^IMG[-_]\d{8}[-_]WA\d+$/i,              // WhatsApp IMG-20240101-WA0012
  /^(IMG|VID|PANO|PXL|MVIMG)[-_]\d{8}[-_]\d{6,9}.*$/i, // Android IMG_20240101_123456 / Pixel PXL_…
  /^DSC[-_ ]?\d{3,5}$/i,                   // Nikon DSC_0001
  /^DSC\d{5}$/i,                           // Sony DSC01234
  /^(DSCN|DSCF|SDC|SAM|CIMG|KIMG|EPSN)[-_]?\d{3,5}$/i,
  /^(MVI|MOV|VID)[-_ ]?\d{3,5}$/i,         // 相机视频 MVI_1234
  /^(GOPR|GP|GX|GH)\d{4,6}$/i,             // GoPro
  /^DJI[-_ ]?\d{3,5}.*$/i,                 // 无人机 DJI_0127_D
  /^P\d{7}$/i,                             // Panasonic P1010001
  /^R\d{7}$/i,                             // Ricoh
  /^\d{8}[-_ ]\d{6}.*$/,                   // 20240101_123456（Samsung / OnePlus / 录屏）
  /^WIN_\d{8}.*$/i,                        // Windows 相机
  /^WP_\d{8}.*$/i,
  /^FullSizeRender.*$/i,
  /^(Screen ?Shot|Screenshot)[-_ ].*$/i,   // 截图是用户内容，不是数据集
  /^(屏幕截图|屏幕快照|截屏|截图).*$/,
  /^(photo|image|picture)[-_ ]?\d{1,3}$/i, // 导出常见的 Photo 1 / image-12（小序号）
]

/** UUID：8-4-4-4-12 十六进制 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 长十六进制（内容 hash 命名） */
const HEX_RE = /^[0-9a-f]{12,}$/i
/** 机器序列：可选短前缀 + 3 位以上数字（frame-0042 / clip_000123 / 000123 / img000124） */
const SEQ_RE = /^[a-z]{0,16}[-_. ]?\d{3,}[a-z]?$/i
/**
 * 带多段编号的生成名：step_000100_sample_03 / tile_12_34 之类 ——
 * 全是短字母数字段、至少两段纯数字、且以数字段结尾（"2024_01_vacation" 这种
 * 日期开头、人话结尾的名字不算）。
 */
function isMultiSeqName(baseName: string): boolean {
  const segments = baseName.split(/[-_. ]+/)
  if (segments.length < 3) return false
  if (!segments.every((s) => /^[a-z0-9]{1,16}$/i.test(s))) return false
  const digitSegments = segments.filter((s) => /^\d{2,}$/.test(s))
  return digitSegments.length >= 2 && /^\d+$/.test(segments[segments.length - 1])
}

export function isCameraName(baseName: string): boolean {
  return CAMERA_NAME_RES.some((re) => re.test(baseName))
}

/** 名字看起来是机器生成（已豁免相机命名） */
export function isMachineName(baseName: string): boolean {
  if (isCameraName(baseName)) return false
  return UUID_RE.test(baseName) || HEX_RE.test(baseName) || SEQ_RE.test(baseName) || isMultiSeqName(baseName)
}

export interface DatasetVerdict {
  isDataset: boolean
  /** 主导媒体类型的文件数（判定依据） */
  fileCount: number
  machineRatio: number
}

export interface DatasetOptions {
  minFiles?: number
  machineRatio?: number
}

const stripExt = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * 一个目录的文件清单 → 是否像数据集。
 * 只看"同类媒体"里数量最多的一类：混合内容（照片 + 视频 + 文档）的普通目录不会误判。
 */
export function detectDataset(
  files: Array<{ name: string; kind: MediaKind | null }>,
  opts: DatasetOptions = {}
): DatasetVerdict {
  const minFiles = opts.minFiles ?? DATASET_MIN_FILES
  const ratioNeeded = opts.machineRatio ?? DATASET_MACHINE_RATIO
  const byKind = new Map<MediaKind, string[]>()
  for (const f of files) {
    if (!f.kind) continue
    const list = byKind.get(f.kind)
    if (list) list.push(f.name)
    else byKind.set(f.kind, [f.name])
  }
  let dominant: string[] = []
  for (const list of byKind.values()) if (list.length > dominant.length) dominant = list
  if (dominant.length < minFiles) {
    return { isDataset: false, fileCount: dominant.length, machineRatio: 0 }
  }
  const machine = dominant.filter((n) => isMachineName(stripExt(n))).length
  const machineRatio = machine / dominant.length
  return { isDataset: machineRatio >= ratioNeeded, fileCount: dominant.length, machineRatio }
}
