import { describe, it, expect } from 'vitest'
import { defaultShortcut, eventToAccelerator, formatShortcut, isValidShortcut, type KeyComboEvent } from './quickpanel'

const ev = (over: Partial<KeyComboEvent>): KeyComboEvent => ({
  key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over,
})

describe('defaultShortcut', () => {
  it('macOS 用 ⇧⌘Space，其余平台 Alt+Shift+Space', () => {
    expect(defaultShortcut('darwin')).toBe('Shift+Command+Space')
    expect(defaultShortcut('win32')).toBe('Alt+Shift+Space')
    expect(defaultShortcut('linux')).toBe('Alt+Shift+Space')
  })
})

describe('eventToAccelerator', () => {
  it('⇧⌘Space（录制默认组合）', () => {
    expect(eventToAccelerator(ev({ key: ' ', code: 'Space', metaKey: true, shiftKey: true }), true))
      .toBe('Shift+Command+Space')
  })
  it('字母键按 code 取，不随 Shift / 输入法变形', () => {
    expect(eventToAccelerator(ev({ key: 'ƒ', code: 'KeyF', altKey: true, metaKey: true }), true))
      .toBe('Alt+Command+F')
    expect(eventToAccelerator(ev({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), false))
      .toBe('Control+Shift+1')
  })
  it('只按修饰键 → null', () => {
    expect(eventToAccelerator(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), true)).toBeNull()
    expect(eventToAccelerator(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true)).toBeNull()
  })
  it('没有修饰键或只有 Shift → null；F 键例外', () => {
    expect(eventToAccelerator(ev({ key: 'a', code: 'KeyA' }), true)).toBeNull()
    expect(eventToAccelerator(ev({ key: 'A', code: 'KeyA', shiftKey: true }), true)).toBeNull()
    expect(eventToAccelerator(ev({ key: 'F6', code: 'F6' }), true)).toBe('F6')
    expect(eventToAccelerator(ev({ key: 'F6', code: 'F6', shiftKey: true }), true)).toBe('Shift+F6')
  })
  it('非 macOS 平台不收 Win 键组合（系统保留）', () => {
    expect(eventToAccelerator(ev({ key: ' ', code: 'Space', metaKey: true }), false)).toBeNull()
  })
  it('方向键 / 标点归一化', () => {
    expect(eventToAccelerator(ev({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true }), false)).toBe('Control+Up')
    expect(eventToAccelerator(ev({ key: '/', code: 'Slash', metaKey: true }), true)).toBe('Command+/')
  })
})

describe('isValidShortcut', () => {
  it('修饰键 + 键合法；裸键 / 纯 Shift 不合法', () => {
    expect(isValidShortcut('Shift+Command+Space', true)).toBe(true)
    expect(isValidShortcut('Alt+Shift+Space', false)).toBe(true)
    expect(isValidShortcut('Space', true)).toBe(false)
    expect(isValidShortcut('Shift+Space', true)).toBe(false)
    expect(isValidShortcut('F6', true)).toBe(true)
    expect(isValidShortcut('', true)).toBe(false)
    expect(isValidShortcut('Command+Shift', true)).toBe(false)
  })
  it('非 macOS 拒绝 Command / Super', () => {
    expect(isValidShortcut('Command+Space', false)).toBe(false)
    expect(isValidShortcut('Super+Space', false)).toBe(false)
    expect(isValidShortcut('Command+Space', true)).toBe(true)
  })
})

describe('formatShortcut', () => {
  it('macOS 符号拼接，按 ⌃⌥⇧⌘ 排序', () => {
    expect(formatShortcut('Shift+Command+Space', true)).toBe('⇧⌘Space')
    expect(formatShortcut('Command+Shift+Space', true)).toBe('⇧⌘Space')
    expect(formatShortcut('Control+Alt+P', true)).toBe('⌃⌥P')
  })
  it('Windows 用 + 连接，CommandOrControl → Ctrl', () => {
    expect(formatShortcut('Alt+Shift+Space', false)).toBe('Alt+Shift+Space')
    expect(formatShortcut('CommandOrControl+K', false)).toBe('Ctrl+K')
  })
})
