/**
 * 把"文件本身"（而不是路径文字）写进系统剪贴板。
 *
 *   macOS   NSFilenamesPboardType：路径数组的 XML plist（经 Electron clipboard.writeBuffer）。
 *           访达粘贴（⌘V）认这个 legacy pasteboard type（AppKit 自动桥接到现代的 file-url types）。
 *   Windows CF_HDROP（标准格式 15）：DROPFILES 头 + 双 NUL 结尾的 UTF-16 路径列表。
 *           资源管理器 Ctrl+V 只认它。Electron 的 clipboard.writeBuffer 写不了无名的标准格式
 *           （自定义名会落进 Chromium 的 "web custom format" 注册区，Explorer 读不到），
 *           所以经 koffi 直调 Win32（OpenClipboard / GlobalAlloc / SetClipboardData）。
 *
 * 负载构造是纯函数（便于单测）；实际写剪贴板在 main/quickPanel.ts，失败时回退为
 * 复制路径文字，界面如实提示。
 */

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** NSFilenamesPboardType 的 plist 负载 */
export function filenamesPlist(paths: string[]): string {
  const items = paths.map((p) => `  <string>${xmlEscape(p)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${items}
</array>
</plist>
`
}

// ── Windows CF_HDROP ────────────────────────────────────────────────────────

/** DROPFILES 头的大小（shellapi.h：DWORD pFiles + POINT pt + BOOL fNC + BOOL fWide） */
const DROPFILES_HEADER_SIZE = 20
const CF_HDROP = 15
const GMEM_MOVEABLE = 0x0002

/**
 * CF_HDROP 负载：20 字节 DROPFILES 头（pFiles=20、fWide=1）+ UTF-16LE 路径列表，
 * 每条路径以 NUL 结束、列表再追加一个 NUL（双 NUL 收尾）。
 */
export function dropFilesBuffer(paths: string[]): Buffer {
  const header = Buffer.alloc(DROPFILES_HEADER_SIZE)
  header.writeUInt32LE(DROPFILES_HEADER_SIZE, 0) // pFiles：路径列表相对结构起点的偏移
  // pt.x / pt.y / fNC 保持 0（非拖放场景无意义）
  header.writeUInt32LE(1, 16) // fWide = 1：宽字符（UTF-16），中文路径不走 ANSI 码页
  const list = Buffer.from(paths.join('\0') + '\0\0', 'utf16le')
  return Buffer.concat([header, list])
}

interface Win32ClipboardApi {
  OpenClipboard: (hwnd: number | bigint) => boolean
  EmptyClipboard: () => boolean
  SetClipboardData: (format: number, mem: unknown) => unknown
  CloseClipboard: () => boolean
  GetLastError: () => number
  GlobalAlloc: (flags: number, size: number) => unknown
  GlobalLock: (mem: unknown) => unknown
  GlobalUnlock: (mem: unknown) => boolean
  GlobalFree: (mem: unknown) => unknown
  RtlMoveMemory: (dst: unknown, src: Buffer, n: number) => void
}

let winApi: Win32ClipboardApi | null | undefined

function loadWin32Clipboard(): Win32ClipboardApi | null {
  if (winApi !== undefined) return winApi
  winApi = null
  if (process.platform === 'win32') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi') as typeof import('koffi')
      const user32 = koffi.load('user32.dll')
      const kernel32 = koffi.load('kernel32.dll')
      winApi = {
        // HWND 按指针宽度整数传（0 = NULL；来自 BrowserWindow.getNativeWindowHandle）
        OpenClipboard: user32.func('bool __stdcall OpenClipboard(uintptr_t hwnd)') as Win32ClipboardApi['OpenClipboard'],
        EmptyClipboard: user32.func('bool __stdcall EmptyClipboard()') as Win32ClipboardApi['EmptyClipboard'],
        SetClipboardData: user32.func('void* __stdcall SetClipboardData(uint32 format, void* mem)') as Win32ClipboardApi['SetClipboardData'],
        CloseClipboard: user32.func('bool __stdcall CloseClipboard()') as Win32ClipboardApi['CloseClipboard'],
        GetLastError: kernel32.func('uint32 __stdcall GetLastError()') as Win32ClipboardApi['GetLastError'],
        GlobalAlloc: kernel32.func('void* __stdcall GlobalAlloc(uint32 flags, size_t size)') as Win32ClipboardApi['GlobalAlloc'],
        GlobalLock: kernel32.func('void* __stdcall GlobalLock(void* mem)') as Win32ClipboardApi['GlobalLock'],
        GlobalUnlock: kernel32.func('bool __stdcall GlobalUnlock(void* mem)') as Win32ClipboardApi['GlobalUnlock'],
        GlobalFree: kernel32.func('void* __stdcall GlobalFree(void* mem)') as Win32ClipboardApi['GlobalFree'],
        RtlMoveMemory: kernel32.func('void __stdcall RtlMoveMemory(void* dst, const uint8_t* src, size_t n)') as Win32ClipboardApi['RtlMoveMemory'],
      }
    } catch (err) {
      console.warn('[clipboard] win32 clipboard API unavailable:', err)
    }
  }
  return winApi
}

/** 同步小睡（主进程，≤ 150ms 总量）：OpenClipboard 被别的进程短暂占用时重试间隔 */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch { /* SharedArrayBuffer 不可用就立即重试 */ }
}

/**
 * Windows：把文件列表以 CF_HDROP 写进剪贴板（资源管理器 Ctrl+V 粘贴成文件副本）。
 * hwnd 传发起窗口的句柄（BrowserWindow.getNativeWindowHandle 的小端指针值；0 = NULL）：
 * OpenClipboard 和所有权挂在真实窗口上更可靠（Chromium 自己也这么做），剪贴板监视类
 * 工具（剪贴板历史、Eagle 等）短暂占用时按指数退避重试。
 * 失败抛错，调用方回退为复制路径文字。注意 Electron 的 clipboard.availableFormats()
 * 看不到 CF_HDROP（Chromium 只映射它认识的格式），验证要用
 * PowerShell `Get-Clipboard -Format FileDropList`。
 */
export function writeClipboardHdrop(paths: string[], hwnd: bigint | number = 0): void {
  const api = loadWin32Clipboard()
  if (!api) throw new Error('win32 clipboard API unavailable')
  const payload = dropFilesBuffer(paths)
  // 剪贴板是全局互斥资源：别的进程（剪贴板历史、同步工具）可能短暂占着，退避重试
  let opened = false
  let lastErr = 0
  for (let i = 0; i < 12; i++) {
    if (api.OpenClipboard(hwnd)) { opened = true; break }
    lastErr = api.GetLastError()
    sleepSync(10 + i * 10)
  }
  if (!opened) throw new Error(`OpenClipboard failed (clipboard busy, GetLastError=${lastErr})`)
  try {
    if (!api.EmptyClipboard()) throw new Error('EmptyClipboard failed')
    const h = api.GlobalAlloc(GMEM_MOVEABLE, payload.length)
    if (!h) throw new Error('GlobalAlloc failed')
    const p = api.GlobalLock(h)
    if (!p) {
      api.GlobalFree(h)
      throw new Error('GlobalLock failed')
    }
    try {
      api.RtlMoveMemory(p, payload, payload.length)
    } finally {
      api.GlobalUnlock(h)
    }
    if (!api.SetClipboardData(CF_HDROP, h)) {
      api.GlobalFree(h) // 只有失败时归我们释放；成功后内存归系统所有
      throw new Error('SetClipboardData failed')
    }
  } finally {
    api.CloseClipboard()
  }
}
