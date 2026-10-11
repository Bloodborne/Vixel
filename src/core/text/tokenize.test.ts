import { describe, it, expect } from 'vitest'
import { tokenizeForFtsSync } from './tokenize'

describe('tokenizeForFtsSync', () => {
  it('returns empty string for empty input', () => {
    expect(tokenizeForFtsSync('')).toBe('')
    expect(tokenizeForFtsSync('   ')).toBe('')
  })

  it('passes through pure ASCII unchanged (normalized whitespace)', () => {
    expect(tokenizeForFtsSync('hello world')).toBe('hello world')
    expect(tokenizeForFtsSync('iPhone   15')).toBe('iPhone 15')
  })

  it('cuts CJK text into words (jieba must actually run, not fall back to raw text)', () => {
    expect(tokenizeForFtsSync('海边的日落').split(' ')).toEqual(expect.arrayContaining(['海边', '日落']))
    // search 模式：长词再切出短词，搜"财务"也能命中"财务报表"
    expect(tokenizeForFtsSync('2024年财务报表').split(' ')).toEqual(expect.arrayContaining(['财务', '报表', '财务报表']))
  })

  it('handles mixed CJK + ASCII without crashing', () => {
    const out = tokenizeForFtsSync('iPhone 海边 sunset')
    expect(out.length).toBeGreaterThan(0)
    expect(out).toMatch(/iPhone/i)
  })
})
