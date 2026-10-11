import { describe, it, expect } from 'vitest'
import { bucketOfRgb, maskForColor, COLOR_BUCKETS, isColorBucket } from '../../shared/colors'
import { extractPaletteFromRaw, parsePaletteJson } from './palette'

describe('bucketOfRgb (LCh 规则)', () => {
  const cases: Array<[string, [number, number, number], string]> = [
    ['pure red', [220, 30, 30], 'red'],
    ['crimson', [160, 20, 40], 'red'],
    ['orange', [245, 140, 20], 'orange'],
    ['brown (dark orange)', [139, 69, 19], 'brown'],
    ['chocolate dark', [92, 51, 23], 'brown'],
    ['yellow', [250, 210, 20], 'yellow'],
    ['green grass', [70, 160, 60], 'green'],
    ['dark green', [20, 90, 40], 'green'],
    ['cyan / teal', [0, 180, 190], 'cyan'],
    ['sky blue', [120, 180, 235], 'blue'],
    ['deep blue', [25, 60, 180], 'blue'],
    ['navy', [20, 30, 90], 'blue'],
    ['purple', [128, 50, 170], 'purple'],
    ['pink (light red)', [250, 170, 190], 'pink'],
    ['hot pink', [240, 100, 170], 'pink'],
    ['black', [12, 12, 12], 'black'],
    ['mid gray', [128, 128, 128], 'black'],
    ['white', [248, 248, 246], 'white'],
  ]
  for (const [name, [r, g, b], expected] of cases) {
    it(`${name} rgb(${r},${g},${b}) → ${expected}`, () => {
      expect(bucketOfRgb(r, g, b)).toBe(expected)
    })
  }
})

describe('maskForColor', () => {
  it('each bucket maps to a distinct bit', () => {
    const masks = COLOR_BUCKETS.map(maskForColor)
    expect(new Set(masks).size).toBe(COLOR_BUCKETS.length)
    for (const m of masks) expect(m & (m - 1)).toBe(0) // 单一位
  })
  it('unknown color → 0', () => {
    expect(maskForColor('ultraviolet')).toBe(0)
    expect(isColorBucket('ultraviolet')).toBe(false)
    expect(isColorBucket('pink')).toBe(true)
  })
})

/** 造一块纯色像素区 */
function solid(r: number, g: number, b: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(r, g, b)
  return out
}

describe('extractPaletteFromRaw', () => {
  it('half red / half blue → two dominant colors with ~50% each, both buckets flagged', () => {
    const data = new Uint8Array([...solid(220, 30, 30, 2048), ...solid(25, 60, 180, 2048)])
    const { palette, mask } = extractPaletteFromRaw(data, 3)
    expect(palette.length).toBeGreaterThanOrEqual(2)
    expect(palette[0].p).toBeGreaterThan(0.4)
    expect(palette[1].p).toBeGreaterThan(0.4)
    const buckets = palette.map((c) => c.bucket)
    expect(buckets).toContain('red')
    expect(buckets).toContain('blue')
    expect(mask & maskForColor('red')).toBeTruthy()
    expect(mask & maskForColor('blue')).toBeTruthy()
    expect(mask & maskForColor('mono')).toBeFalsy()
  })

  it('a 10% pink accent is below the 12% flag threshold; 15% is above', () => {
    const below = new Uint8Array([...solid(250, 170, 190, 410), ...solid(70, 160, 60, 3686)])
    expect(extractPaletteFromRaw(below, 3).mask & maskForColor('pink')).toBeFalsy()
    const above = new Uint8Array([...solid(250, 170, 190, 615), ...solid(70, 160, 60, 3481)])
    expect(extractPaletteFromRaw(above, 3).mask & maskForColor('pink')).toBeTruthy()
  })

  it('grayscale image → mono + black/white flags, no chromatic buckets', () => {
    const px: number[] = []
    for (let i = 0; i < 4096; i++) { const v = (i * 17) % 256; px.push(v, v, v) }
    const { mask } = extractPaletteFromRaw(new Uint8Array(px), 3)
    expect(mask & maskForColor('mono')).toBeTruthy()
    for (const b of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'brown']) {
      expect(mask & maskForColor(b)).toBeFalsy()
    }
  })

  it('transparent pixels are ignored (RGBA)', () => {
    const opaque = [220, 30, 30, 255]
    const clear = [25, 60, 180, 0]
    const px: number[] = []
    for (let i = 0; i < 1000; i++) px.push(...opaque)
    for (let i = 0; i < 1000; i++) px.push(...clear)
    const { palette, mask } = extractPaletteFromRaw(new Uint8Array(px), 4)
    expect(mask & maskForColor('blue')).toBeFalsy()
    expect(palette[0].bucket).toBe('red')
    expect(palette[0].p).toBeGreaterThan(0.9)
  })

  it('empty input → empty palette, zero mask', () => {
    expect(extractPaletteFromRaw(new Uint8Array(0), 3)).toEqual({ palette: [], mask: 0 })
  })

  it('palette is deterministic for the same input', () => {
    const px = new Uint8Array([...solid(220, 30, 30, 1000), ...solid(25, 60, 180, 1500), ...solid(250, 210, 20, 1596)])
    const a = extractPaletteFromRaw(px, 3)
    const b = extractPaletteFromRaw(px, 3)
    expect(a).toEqual(b)
  })
})

describe('parsePaletteJson', () => {
  it('parses valid palette JSON and drops malformed entries', () => {
    const json = JSON.stringify([
      { hex: '#ff0000', p: 0.5, bucket: 'red' },
      { bogus: true },
      { hex: '#00ff00', p: 0.3, bucket: 'green' },
    ])
    const out = parsePaletteJson(json)
    expect(out).toHaveLength(2)
    expect(out[0].bucket).toBe('red')
  })
  it('bad JSON / null → []', () => {
    expect(parsePaletteJson('oops')).toEqual([])
    expect(parsePaletteJson(null)).toEqual([])
    expect(parsePaletteJson('{"a":1}')).toEqual([])
  })
})
