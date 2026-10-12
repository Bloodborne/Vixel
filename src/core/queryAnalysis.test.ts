import { describe, it, expect } from 'vitest'
import { analyzeQuery } from './queryAnalysis'

describe('analyzeQuery — 类型词（中文）', () => {
  it('「火车的视频」剥出「火车」，类型 video', () => {
    const a = analyzeQuery('火车的视频')
    expect(a.strippedText).toBe('火车')
    expect(a.kinds).toEqual(['video'])
    expect(a.kindOnly).toBe(false)
  })

  it('「埃菲尔铁塔的视频」「下雪的视频」同理', () => {
    expect(analyzeQuery('埃菲尔铁塔的视频').strippedText).toBe('埃菲尔铁塔')
    expect(analyzeQuery('下雪的视频').strippedText).toBe('下雪')
  })

  it('「视频里的猫」吃掉助词，剩「猫」', () => {
    const a = analyzeQuery('视频里的猫')
    expect(a.strippedText).toBe('猫')
    expect(a.kinds).toEqual(['video'])
  })

  it('「手机截图」→「手机」+ screenshot（算 image）', () => {
    const a = analyzeQuery('手机截图')
    expect(a.strippedText).toBe('手机')
    expect(a.kinds).toEqual(['image'])
    expect(a.screenshot).toBe(true)
  })

  it('「屏幕截图」整体剥掉，不留「屏幕」', () => {
    const a = analyzeQuery('报错的屏幕截图')
    expect(a.strippedText).toBe('报错')
    expect(a.screenshot).toBe(true)
  })

  it('「仙人掌的照片」→ image', () => {
    const a = analyzeQuery('仙人掌的照片')
    expect(a.strippedText).toBe('仙人掌')
    expect(a.kinds).toEqual(['image'])
  })

  it('只有类型词：「视频」→ kindOnly', () => {
    const a = analyzeQuery('视频')
    expect(a.kindOnly).toBe(true)
    expect(a.kinds).toEqual(['video'])
    expect(a.strippedText).toBe('')
  })

  it('单字「歌」「图」不算类型词（歌剧院、图书馆不该被剥）', () => {
    expect(analyzeQuery('歌剧院').strippedText).toBe('歌剧院')
    expect(analyzeQuery('图书馆').strippedText).toBe('图书馆')
  })
})

describe('analyzeQuery — 类型词（英文）', () => {
  it('"video of a waterfall" → "a waterfall"', () => {
    const a = analyzeQuery('video of a waterfall')
    expect(a.strippedText).toBe('a waterfall')
    expect(a.kinds).toEqual(['video'])
  })

  it('"a video of fireworks" → "fireworks"', () => {
    const a = analyzeQuery('a video of fireworks')
    expect(a.strippedText).toBe('fireworks')
    expect(a.kinds).toEqual(['video'])
  })

  it('"a waterfall in a video" → "a waterfall"', () => {
    const a = analyzeQuery('a waterfall in a video')
    expect(a.strippedText).toBe('a waterfall')
    expect(a.kinds).toEqual(['video'])
  })

  it('"photo of my passport" → image', () => {
    const a = analyzeQuery('photo of my passport')
    expect(a.strippedText).toBe('my passport')
    expect(a.kinds).toEqual(['image'])
  })

  it('"screenshot of an error message" → screenshot (image)', () => {
    const a = analyzeQuery('screenshot of an error message')
    expect(a.strippedText).toBe('an error message')
    expect(a.kinds).toEqual(['image'])
    expect(a.screenshot).toBe(true)
  })

  it('复数与裸词："cat videos" → "cat"', () => {
    const a = analyzeQuery('cat videos')
    expect(a.strippedText).toBe('cat')
    expect(a.kinds).toEqual(['video'])
  })

  it('只有类型词："screenshots" → kindOnly', () => {
    const a = analyzeQuery('screenshots')
    expect(a.kindOnly).toBe(true)
    expect(a.kinds).toEqual(['image'])
  })

  it('不吃内容词：类型词是别的词的一部分时不剥（"videography" 不含词边界命中）', () => {
    expect(analyzeQuery('videography basics').strippedText).toBe('videography basics')
  })
})

describe('analyzeQuery — 无类型词', () => {
  it('普通查询原样返回', () => {
    const a = analyzeQuery('紫色的小花')
    expect(a.strippedText).toBe('紫色的小花')
    expect(a.kinds).toEqual([])
    expect(a.kindOnly).toBe(false)
    expect(a.isLookup).toBe(false)
  })

  it('空查询', () => {
    const a = analyzeQuery('  ')
    expect(a.strippedText).toBe('')
    expect(a.kindOnly).toBe(false)
    expect(a.isLookup).toBe(false)
  })
})

describe('analyzeQuery — 查号式查询', () => {
  it.each(['IMG_2682', 'N49', 'K7Q2LM', '4815162342', '2024-03', 'G12'])('"%s" 是 lookup', (q) => {
    expect(analyzeQuery(q).isLookup).toBe(true)
  })

  it('纯短数字不算（"450" 可能是语义的一部分，例如 450D 之外的场景）', () => {
    expect(analyzeQuery('450').isLookup).toBe(false)
  })

  it('混合内容词就不算 lookup', () => {
    expect(analyzeQuery('invoice 2024-03').isLookup).toBe(false)
    expect(analyzeQuery('海边日落').isLookup).toBe(false)
  })

  it('多个编号词都像编号 → lookup', () => {
    expect(analyzeQuery('IMG_2682 IMG_2683').isLookup).toBe(true)
  })

  it('带类型词的编号：「IMG_2682 的照片」剥掉类型词后仍是 lookup', () => {
    const a = analyzeQuery('IMG_2682的照片')
    expect(a.strippedText).toBe('IMG_2682')
    expect(a.isLookup).toBe(true)
    expect(a.kinds).toEqual(['image'])
  })
})
