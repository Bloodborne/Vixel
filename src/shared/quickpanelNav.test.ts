import { describe, it, expect } from 'vitest'
import { clampSelection, handlesKey, moveSelection } from './quickpanelNav'

describe('handlesKey', () => {
  it('↑↓ / Home / End 总是接管；←→ 只在网格布局接管（列表留给输入框）', () => {
    expect(handlesKey('ArrowDown', 1)).toBe(true)
    expect(handlesKey('ArrowUp', 1)).toBe(true)
    expect(handlesKey('Home', 1)).toBe(true)
    expect(handlesKey('ArrowLeft', 1)).toBe(false)
    expect(handlesKey('ArrowRight', 1)).toBe(false)
    expect(handlesKey('ArrowLeft', 6)).toBe(true)
    expect(handlesKey('a', 6)).toBe(false)
  })
})

describe('moveSelection（列表，cols=1）', () => {
  const s = (index: number, count = 5): Parameters<typeof moveSelection>[0] => ({ index, count, cols: 1 })
  it('↓ 逐项前进，到底停住', () => {
    expect(moveSelection(s(0), 'ArrowDown')).toBe(1)
    expect(moveSelection(s(4), 'ArrowDown')).toBe(4)
  })
  it('↑ 逐项后退，到顶停住', () => {
    expect(moveSelection(s(3), 'ArrowUp')).toBe(2)
    expect(moveSelection(s(0), 'ArrowUp')).toBe(0)
  })
  it('无选中时 ↓ 进入第一项、↑ 进入最后一项', () => {
    expect(moveSelection(s(-1), 'ArrowDown')).toBe(0)
    expect(moveSelection(s(-1), 'ArrowUp')).toBe(4)
  })
  it('Home / End', () => {
    expect(moveSelection(s(3), 'Home')).toBe(0)
    expect(moveSelection(s(1), 'End')).toBe(4)
  })
  it('空结果恒为 -1', () => {
    expect(moveSelection(s(-1, 0), 'ArrowDown')).toBe(-1)
    expect(moveSelection(s(-1, 0), 'End')).toBe(-1)
  })
})

describe('moveSelection（网格，cols=6）', () => {
  const s = (index: number, count = 14): Parameters<typeof moveSelection>[0] => ({ index, count, cols: 6 })
  it('←→ 走一格，↑↓ 走一行', () => {
    expect(moveSelection(s(3), 'ArrowRight')).toBe(4)
    expect(moveSelection(s(3), 'ArrowLeft')).toBe(2)
    expect(moveSelection(s(3), 'ArrowDown')).toBe(9)
    expect(moveSelection(s(9), 'ArrowUp')).toBe(3)
  })
  it('顶行 ↑ 原地不动；末行 ↓ 夹到最后一项', () => {
    expect(moveSelection(s(2), 'ArrowUp')).toBe(2)
    expect(moveSelection(s(9), 'ArrowDown')).toBe(13)
    expect(moveSelection(s(13), 'ArrowDown')).toBe(13)
  })
})

describe('clampSelection', () => {
  it('结果集缩小后收编下标；清空 → -1', () => {
    expect(clampSelection(7, 5)).toBe(4)
    expect(clampSelection(0, 5)).toBe(0)
    expect(clampSelection(-1, 5)).toBe(0)
    expect(clampSelection(3, 0)).toBe(-1)
  })
})
