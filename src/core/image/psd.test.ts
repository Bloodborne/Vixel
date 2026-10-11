import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { writeFile, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { parsePsdComposite } from './psd'

// vitest 从仓库根运行；tsconfig.cli 也会编译测试文件，避免 import.meta
const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'design')

// 合成图内容见 scripts/make-design-fixtures.mjs：64×48，上半 红|绿|蓝 三条，下半灰渐变
function checkComposite(c: { data: Buffer; width: number; height: number; channels: number }): void {
  expect(c.width).toBe(64)
  expect(c.height).toBe(48)
  const px = (x: number, y: number): [number, number, number] => {
    const o = (y * c.width + x) * c.channels
    return [c.data[o], c.data[o + 1], c.data[o + 2]]
  }
  expect(px(5, 5)).toEqual([230, 0, 0])    // 红条
  expect(px(32, 5)).toEqual([0, 200, 0])   // 绿条
  expect(px(60, 5)).toEqual([0, 0, 240])   // 蓝条
  const [r, g, b] = px(32, 40)             // 下半灰渐变：三通道相等
  expect(r).toBe(g)
  expect(g).toBe(b)
}

describe('parsePsdComposite', () => {
  it('parses a raw (compression 0) RGB PSD', async () => {
    const c = await parsePsdComposite(join(FIXTURES, 'merged-raw.psd'))
    expect(c.colorMode).toBe('rgb')
    expect(c.channels).toBe(3)
    checkComposite(c)
  })

  it('parses an RLE (compression 1) RGB PSD to identical pixels', async () => {
    const raw = await parsePsdComposite(join(FIXTURES, 'merged-raw.psd'))
    const rle = await parsePsdComposite(join(FIXTURES, 'merged-rle.psd'))
    expect(Buffer.compare(raw.data, rle.data)).toBe(0)
  })

  it('parses a grayscale PSD into equal RGB channels', async () => {
    const c = await parsePsdComposite(join(FIXTURES, 'gray.psd'))
    expect(c.colorMode).toBe('grayscale')
    for (let i = 0; i < 10; i++) {
      expect(c.data[i * 3]).toBe(c.data[i * 3 + 1])
      expect(c.data[i * 3 + 1]).toBe(c.data[i * 3 + 2])
    }
  })

  it('rejects truncated files with a clear error', async () => {
    const whole = await readFile(join(FIXTURES, 'merged-raw.psd'))
    const dir = await mkdtemp(join(tmpdir(), 'vixel-psd-test-'))
    try {
      const p = join(dir, 'broken.psd')
      await writeFile(p, whole.subarray(0, whole.length - 500))
      await expect(parsePsdComposite(p)).rejects.toThrow(/truncated|EOF/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects non-PSD bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vixel-psd-test-'))
    try {
      const p = join(dir, 'not.psd')
      await writeFile(p, Buffer.from('definitely not a psd file, just text padding padding'))
      await expect(parsePsdComposite(p)).rejects.toThrow(/signature/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
