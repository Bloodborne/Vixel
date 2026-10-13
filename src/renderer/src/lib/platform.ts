/**
 * 平台相关的界面文案。快捷键在源码里统一按 macOS 符号写（⌘ ⌥ ⇧），Windows / Linux 上换成 Ctrl / Alt / Shift；
 * 菜单本身由主进程用 CmdOrCtrl 注册，这里只管显示。
 */
import { t } from '../../../shared/i18n'

export const IS_MAC = /Mac/i.test(navigator.userAgent)

/** 网页版（服务器版，src/web/api.ts 注入的 window.api）：桌面专属 UI 按此隐藏 / 降级 */
export const IS_WEB = window.api.platform === 'web'

/** "在访达中显示" / Windows 的 "打开所在位置"（按钮窄，用短说法） */
export const revealLabel = IS_MAC ? t.common.revealMac : t.common.revealWin

/** '⌥⌘S' → macOS 原样；其他平台 'Ctrl+Alt+S' */
export function kbd(mac: string): string {
  if (IS_MAC) return mac
  const mods: string[] = []
  let key = mac
  for (const [glyph, name] of [['⌘', 'Ctrl'], ['⌥', 'Alt'], ['⇧', 'Shift']] as const) {
    if (key.includes(glyph)) { mods.push(name); key = key.split(glyph).join('') }
  }
  return [...mods, key].join('+')
}

/** 路径的最后一段（同时认 / 和 \，Windows 路径也能取到文件夹名） */
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
