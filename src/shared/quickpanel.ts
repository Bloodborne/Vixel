/**
 * 快速搜索面板（⇧⌘Space）：主进程 / 渲染进程共用的常量与纯逻辑。
 *
 * 快捷键一律用 Electron accelerator 字符串（'Shift+Command+Space'）存取，
 * 展示时再按平台格式化（macOS '⇧⌘Space'，Windows 'Alt+Shift+Space'）。
 * 纯函数（录制按键 → accelerator、校验、格式化）放这里，方便单测。
 */

export const QUICKPANEL_CHANNELS = {
  // 渲染进程（设置 / 面板）→ 主进程
  GET_SETTINGS: 'quickpanel:get-settings',
  SET_ENABLED: 'quickpanel:set-enabled',
  SET_SHORTCUT: 'quickpanel:set-shortcut',
  HIDE: 'quickpanel:hide',
  RESIZE: 'quickpanel:resize',
  OPEN_RESULT: 'quickpanel:open-result',
  OPEN_QUERY: 'quickpanel:open-query',
  OPEN_EXTERNAL: 'quickpanel:open-external',
  COPY_FILES: 'quickpanel:copy-files',
  PREVIEW_FILE: 'quickpanel:preview-file',
  START_DRAG: 'quickpanel:start-drag',
  GET_PENDING: 'quickpanel:get-pending',
  // 主进程 → 面板
  SHOWN: 'quickpanel:shown',
  // 主进程 → 主窗口（面板里 ↩ / ⌘O 的落点）
  SHOW_RESULT: 'quickpanel:show-result',
  RUN_SEARCH: 'quickpanel:run-search',
} as const

/** 设置页 / 菜单需要的全部状态 */
export interface QuickPanelSettings {
  enabled: boolean
  /** Electron accelerator，如 'Shift+Command+Space' */
  shortcut: string
  /** register() 的真实结果：false = 被其他应用占用（启用时才有意义） */
  registered: boolean
}

/** ↩ / ⌘O 发往主窗口的动作；主窗口不存在时先存起来，渲染端挂载后拉取 */
export type QuickPanelPending =
  | { type: 'result'; result: unknown }
  | { type: 'query'; query: string }

/** 默认快捷键：macOS ⇧⌘Space（⌘Space 是 Spotlight）；Windows Alt+Shift+Space（Ctrl+Space 常被输入法占用，Win+ 系统保留） */
export function defaultShortcut(platform: string): string {
  return platform === 'darwin' ? 'Shift+Command+Space' : 'Alt+Shift+Space'
}

/** 录制快捷键时收到的按键事件（KeyboardEvent 的子集，纯数据便于测试） */
export interface KeyComboEvent {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn', 'FnLock',
])

/** e.code → accelerator 键名（布局无关：KeyA 永远是 A，不随输入法 / 修饰键变化） */
function codeToKey(e: KeyComboEvent): string | null {
  const c = e.code
  if (MODIFIER_CODES.has(c)) return null
  if (/^Key[A-Z]$/.test(c)) return c.slice(3)
  if (/^Digit[0-9]$/.test(c)) return c.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c
  if (/^Numpad[0-9]$/.test(c)) return `num${c.slice(6)}`
  const map: Record<string, string> = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    Escape: 'Escape', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  }
  if (map[c]) return map[c]
  // 兜底：单字符的 key（非字母数字布局）直接用大写
  if (e.key.length === 1 && e.key !== ' ') return e.key.toUpperCase()
  return null
}

/**
 * 按键事件 → accelerator。无效组合返回 null：
 *   - 没按下非修饰键（只按了 ⌘⇧ 之类）
 *   - 没有修饰键，或只有 Shift（F1–F24 例外，可单独做快捷键）
 *   - 非 macOS 平台的 Meta（Win 键组合系统保留）
 */
export function eventToAccelerator(e: KeyComboEvent, isMac: boolean): string | null {
  const key = codeToKey(e)
  if (!key) return null
  if (e.metaKey && !isMac) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Command')
  const isFKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
  const hasPrimary = e.ctrlKey || e.altKey || e.metaKey
  if (!isFKey && !hasPrimary) return null
  return [...mods, key].join('+')
}

/** accelerator 是否形如"修饰键+键"（SET_SHORTCUT 的入口校验，防呆） */
export function isValidShortcut(acc: string, isMac: boolean): boolean {
  if (typeof acc !== 'string' || !acc) return false
  const parts = acc.split('+')
  const MODS = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'])
  const mods = parts.filter((p) => MODS.has(p))
  const keys = parts.filter((p) => !MODS.has(p))
  if (keys.length !== 1 || keys[0].length === 0) return false
  if (!isMac && mods.some((m) => m === 'Command' || m === 'Cmd' || m === 'Meta' || m === 'Super')) return false
  const isFKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(keys[0])
  const hasPrimary = mods.some((m) => m !== 'Shift')
  return isFKey || hasPrimary
}

const MAC_GLYPHS: Record<string, string> = {
  Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧',
  Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘', Meta: '⌘', Super: '⌘',
}
/** macOS 的修饰键习惯顺序：⌃ ⌥ ⇧ ⌘ */
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']

/**
 * accelerator → 展示文案。macOS：'Shift+Command+Space' → '⇧⌘Space'；
 * 其他平台：'CommandOrControl' 显示为 Ctrl，用 + 连接：'Alt+Shift+Space'。
 */
export function formatShortcut(acc: string, isMac: boolean): string {
  const parts = acc.split('+').filter(Boolean)
  if (isMac) {
    const glyphs = parts.filter((p) => MAC_GLYPHS[p]).map((p) => MAC_GLYPHS[p])
    glyphs.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b))
    const keys = parts.filter((p) => !MAC_GLYPHS[p])
    return glyphs.join('') + keys.join('')
  }
  const WIN_NAMES: Record<string, string> = {
    Command: 'Win', Cmd: 'Win', Meta: 'Win', Super: 'Win',
    CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Control: 'Ctrl', Option: 'Alt',
  }
  return parts.map((p) => WIN_NAMES[p] ?? p).join('+')
}
