/**
 * 把"文件本身"（而不是路径文字）写进系统剪贴板的负载构造（纯函数，便于单测）。
 *
 *   macOS   NSFilenamesPboardType：路径数组的 XML plist。访达粘贴（⌘V）认这个
 *           legacy pasteboard type（AppKit 自动桥接到现代的 file-url types）。
 *   Windows CF_FILENAMEW（注册名 'FileNameW'）：单个路径的 UTF-16LE + NUL。
 *           资源管理器粘贴时按"复制文件"处理（CF_HDROP 的单文件兄弟格式，
 *           Electron clipboard.writeBuffer 写不了无名的标准格式 CF_HDROP）。
 *
 * 实际写剪贴板在 main/quickPanel.ts；失败时回退为复制路径文字，界面如实提示。
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

/** CF_FILENAMEW 负载：UTF-16LE、以 NUL 结尾（Windows API 的宽字符串约定） */
export function fileNameWBuffer(path: string): Buffer {
  return Buffer.from(path + '\0', 'utf16le')
}
