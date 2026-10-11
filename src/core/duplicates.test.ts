import { describe, expect, it } from 'vitest'
import { groupNearDuplicates, pickKeeper, reclaimableBytes, stemOf, TIME_WINDOW_MS, type DupCandidate } from './duplicates'

// 确定性伪随机，生成 768 维单位向量
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}
function unit(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  return v.map((x) => x / n)
}
function randomVec(seed: number): Float32Array {
  const r = rng(seed)
  return unit(Float32Array.from({ length: 768 }, r))
}
/** 在 base 上加噪声，噪声比例越小越像（noise 0.15 ≈ 余弦 0.99，0.6 ≈ 0.85） */
function near(base: Float32Array, seed: number, noise: number): Float32Array {
  const n = randomVec(seed)
  return unit(base.map((x, i) => x + noise * n[i]))
}

let nextId = 1
function cand(hash: string, ts: number, extra: Partial<DupCandidate> = {}): DupCandidate {
  return { photoId: nextId++, fileHash: hash, fileName: `${hash}.jpg`, width: 4000, height: 3000, fileSize: 1000, takenAt: null, copies: 1, ts, ...extra }
}

describe('stemOf', () => {
  it('strips extension and export / copy suffixes', () => {
    expect(stemOf('IMG_1234.HEIC')).toBe('img_1234')
    expect(stemOf('IMG_1234 (1).jpg')).toBe('img_1234')
    expect(stemOf('IMG_1234-edited.jpg')).toBe('img_1234')
    expect(stemOf('IMG_1234 copy 2.jpg')).toBe('img_1234')
    expect(stemOf('海边 副本.png')).toBe('海边')
  })
  it('keeps sequence numbers that are part of the camera name', () => {
    expect(stemOf('IMG_1234.jpg')).not.toBe(stemOf('IMG_1235.jpg'))
    expect(stemOf('DSC01234.ARW')).toBe('dsc01234')
  })
})

describe('pickKeeper', () => {
  it('prefers more pixels, then larger file, then earlier capture', () => {
    const items = [
      cand('a', 0, { width: 2000, height: 1500, fileSize: 5000 }),
      cand('b', 0, { width: 4000, height: 3000, fileSize: 1000 }),
      cand('c', 0, { width: 4000, height: 3000, fileSize: 2000 }),
    ]
    expect(pickKeeper(items)).toBe('c')
    const tie = [cand('x', 0, { takenAt: '2024-05-02 10:00:00' }), cand('y', 0, { takenAt: '2024-05-01 10:00:00' })]
    expect(pickKeeper(tie)).toBe('y')
  })
})

describe('groupNearDuplicates', () => {
  it('groups a burst inside the time window and leaves unrelated shots alone', async () => {
    const base = randomVec(1)
    const vecs: Record<string, Float32Array> = {
      b1: base, b2: near(base, 2, 0.15), b3: near(base, 3, 0.15),
      u1: randomVec(10), u2: randomVec(11),
    }
    const cands = [cand('b1', 0), cand('b2', 1000), cand('u1', 1500), cand('b3', 2000), cand('u2', 3000)]
    const groups = await groupNearDuplicates(cands, (h) => vecs[h])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.fileHash).sort()).toEqual(['b1', 'b2', 'b3'])
    expect(groups[0].similarity).toBeGreaterThan(0.95)
  })

  it('does not group look-alikes far apart in time unless the file names share a stem', async () => {
    const base = randomVec(5)
    const vecs: Record<string, Float32Array> = { a: base, b: near(base, 6, 0.15), c: near(base, 7, 0.15) }
    const far = TIME_WINDOW_MS * 100
    const cands = [
      cand('a', 0, { fileName: 'IMG_0001.HEIC' }),
      cand('b', far, { fileName: 'IMG_0001 (1).jpg' }), // 同名主干：连上
      cand('c', far * 2, { fileName: 'IMG_0777.jpg' }), // 时间远、名字不同：不连
    ]
    const groups = await groupNearDuplicates(cands, (h) => vecs[h])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.fileHash).sort()).toEqual(['a', 'b'])
  })

  it('rejects similar-but-different shots below the threshold', async () => {
    const base = randomVec(20)
    const vecs: Record<string, Float32Array> = { a: base, b: near(base, 21, 0.6) } // ≈ 0.85
    const groups = await groupNearDuplicates([cand('a', 0), cand('b', 500)], (h) => vecs[h])
    expect(groups).toHaveLength(0)
  })

  it('skips items without vectors and reports progress', async () => {
    const base = randomVec(30)
    const vecs: Record<string, Float32Array | null> = { a: base, b: null, c: near(base, 31, 0.1) }
    const seen: number[] = []
    const groups = await groupNearDuplicates([cand('a', 0), cand('b', 100), cand('c', 200)], (h) => vecs[h], {
      yieldEvery: 1, onProgress: (d) => seen.push(d),
    })
    expect(groups[0].items.map((i) => i.fileHash).sort()).toEqual(['a', 'c'])
    expect(seen.at(-1)).toBe(3)
  })

  it('handles thousands of identical timestamps without comparing every pair', async () => {
    // 整批拷贝进来的文件修改时间相同：每张只和后面 MAX_NEIGHBOURS 张比
    let calls = 0
    const cands = Array.from({ length: 3000 }, (_, i) => cand(`h${i}`, 0, { fileName: `photo-${String(i).padStart(5, '0')}.jpg` }))
    const groups = await groupNearDuplicates(cands, (h) => { calls++; return randomVec(Number(h.slice(1)) + 100) })
    expect(groups).toHaveLength(0)
    expect(calls).toBeLessThan(3000 * 2)
  })

  it('counts reclaimable bytes for every extra copy on disk', async () => {
    const base = randomVec(40)
    const vecs: Record<string, Float32Array> = { a: base, b: near(base, 41, 0.1) }
    const groups = await groupNearDuplicates(
      [cand('a', 0, { width: 4000, height: 3000 }), cand('b', 10, { width: 1000, height: 750, fileSize: 300, copies: 2 })],
      (h) => vecs[h]
    )
    expect(groups[0].keeperHash).toBe('a')
    expect(reclaimableBytes(groups)).toBe(600)
  })
})
