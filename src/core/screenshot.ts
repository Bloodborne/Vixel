/**
 * 截图判定。
 *
 * macOS：系统截图带扩展属性 `com.apple.metadata:kMDItemIsScreenCapture`（随文件
 * 移动 / 拷贝保留）。经 koffi 直调 libc 的 getxattr 读取 —— 每次调用是一个 syscall，
 * 实测 ~2–4 µs / 文件（见 docs / CHANGELOG），比起起一个 `xattr -p` 子进程（~10 ms）
 * 快三个数量级，入库路径上可以放心逐文件读。
 *
 * 没有该属性（Windows 截图、微信 / QQ 传来的、安卓截屏拷过来的）退回文件名模式；
 * Windows 额外认 Pictures\Screenshots 目录。判定结果 0 / 1 存进 photos.is_screenshot，
 * NULL 表示还没判过（旧库启动后由后台回填补上）。
 */

export const SCREENSHOT_XATTR = 'com.apple.metadata:kMDItemIsScreenCapture'

/** 各平台 / 各应用的截图文件名模式（匹配文件名开头） */
const SCREENSHOT_NAME_RES = [
  /^Screenshot[-_ (]/i,         // Windows 11 / Android / Snip & Sketch："Screenshot 2026-01-02 100000.png"、"Screenshot (12).png"
  /^Screenshot_\d/i,            // Android："Screenshot_20260102-100000.png"
  /^Screen ?Shot[-_ ]/i,        // macOS 英文（旧："Screen Shot 2019-… at …"）
  /^(屏幕截图|屏幕快照)/,       // Windows 中文 / 旧版 macOS 中文
  /^截屏/,                      // 小米 / 华为等："截屏2026-01-02_10_00_00.png"
  /^截图/,
  /^Snipaste_\d/i,
  /^微信截图_/, /^WeChat Screenshot/i,
  /^QQ截图/, /^TIM截图/,
  /^CleanShot /i,
  /^SCR[-_]\d/i,                // 部分安卓（如 Pixel 录屏截帧）
]

export function matchesScreenshotName(fileName: string): boolean {
  return SCREENSHOT_NAME_RES.some((re) => re.test(fileName))
}

/** Windows 的系统截图目录 Pictures\Screenshots（Win+PrtScr 落盘处）：按路径段判 */
export function inScreenshotsFolder(filePath: string): boolean {
  const segments = filePath.split(/[/\\]/)
  // 最后一段是文件名，不算
  return segments.slice(0, -1).some((s) => /^screenshots$/i.test(s))
}

// ── macOS xattr（koffi → libc getxattr），懒加载，失败永久降级为 null ────────

type GetXattrFn = (path: string, name: string, value: Uint8Array | null, size: number, position: number, options: number) => number
let getxattrFn: GetXattrFn | null | undefined

function loadGetxattr(): GetXattrFn | null {
  if (getxattrFn !== undefined) return getxattrFn
  getxattrFn = null
  if (process.platform === 'darwin') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi') as typeof import('koffi')
      const libc = koffi.load('libSystem.B.dylib')
      getxattrFn = libc.func(
        'long getxattr(const char *path, const char *name, _Out_ uint8_t *value, size_t size, uint32_t position, int options)'
      ) as GetXattrFn
    } catch (err) {
      console.warn('[screenshot] getxattr unavailable, falling back to name patterns:', err)
    }
  }
  return getxattrFn
}

const SCRATCH = new Uint8Array(512)

/**
 * macOS：文件是否带 kMDItemIsScreenCapture 属性。
 * 返回 true / false；非 macOS、FFI 不可用或读取出错时 null（调用方退回文件名模式）。
 * 属性存在即视为截图（Spotlight 只给截图写这个键，值是 bplist 的 true）。
 */
export function xattrIsScreenCapture(filePath: string): boolean | null {
  const fn = loadGetxattr()
  if (!fn) return null
  try {
    const n = fn(filePath, SCREENSHOT_XATTR, SCRATCH, SCRATCH.length, 0, 0)
    // n ≥ 0：属性在（返回其长度）。-1：ENOATTR（没有）/ 其他 errno —— 一律按"没有"，
    // 名字模式还会兜底；ERANGE 不会出现（bplist 值远小于 512 字节）。
    return n >= 0
  } catch {
    return null
  }
}

/**
 * 综合判定 → 0 / 1（is_screenshot 的取值；调用时机：入库 / 启动回填）。
 * xattr 命中 → 1；否则文件名模式 → 1；Windows 上再看 Screenshots 目录；都不是 → 0。
 * 注意 xattr 的"没有"不否决名字模式：从 Windows / 微信拷来的截图没有 xattr。
 */
export function detectScreenshot(filePath: string, fileName: string): 0 | 1 {
  if (xattrIsScreenCapture(filePath) === true) return 1
  if (matchesScreenshotName(fileName)) return 1
  if (process.platform === 'win32' && inScreenshotsFolder(filePath)) return 1
  return 0
}
