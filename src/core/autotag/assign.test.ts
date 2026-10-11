import { describe, it, expect } from 'vitest'
import { assignLabels, labelBaseline, mergeAssignments, MIN_SD, type LabelVector } from './assign'
import { VOCABULARY } from './vocabulary'

const DIM = 16
function unit(...pairs: Array<[number, number]>): Float32Array {
  const v = new Float32Array(DIM)
  for (const [i, x] of pairs) v[i] = x
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}
// 标签 i 指向第 i 维；图片 = 少量"噪声"维 + 可选的突出维
const labels: LabelVector[] = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, vector: unit([i, 1]) }))
const noise = (seed: number): Float32Array => unit(...Array.from({ length: 8 }, (_, i): [number, number] => [i, 1 + ((seed * (i + 3)) % 7) / 20]), [12, 3])

describe('autotag assignment', () => {
  const library = Array.from({ length: 40 }, (_, k) => noise(k))
  const baseline = labelBaseline(library, labels)

  it('assigns the label an item clearly stands out on', () => {
    const img = unit(...Array.from({ length: 8 }, (_, i): [number, number] => [i, 1]), [12, 3], [2, 4])
    const got = assignLabels(img, labels, baseline)
    expect(got[0]?.labelId).toBe('l2')
  })

  it('assigns nothing to a typical item', () => {
    expect(assignLabels(noise(99), labels, baseline)).toEqual([])
  })

  it('second labels need a higher score than the first', () => {
    // l2 很突出、l5 稍突出：只打 l2；l5 也很突出时两个都打
    const weak = unit(...Array.from({ length: 8 }, (_, i): [number, number] => [i, 1]), [12, 3], [2, 4], [5, 3.6])
    const strong = unit(...Array.from({ length: 8 }, (_, i): [number, number] => [i, 1]), [12, 3], [2, 4], [5, 4])
    const w = assignLabels(weak, labels, baseline, { margin: 1 }).map((a) => a.labelId)
    const s = assignLabels(strong, labels, baseline, { margin: 1 }).map((a) => a.labelId)
    expect(w).toContain('l2')
    expect(s).toEqual(expect.arrayContaining(['l2', 'l5']))
    expect(s.length).toBeGreaterThanOrEqual(w.length)
  })

  it('per-label extra z can veto an otherwise passing label', () => {
    const img = unit(...Array.from({ length: 8 }, (_, i): [number, number] => [i, 1]), [12, 3], [2, 4])
    const strict = labels.map((l) => (l.id === 'l2' ? { ...l, extraZ: 100 } : l))
    expect(assignLabels(img, strict, baseline).map((a) => a.labelId)).not.toContain('l2')
  })

  it('small libraries use the sd floor so scores are not inflated', () => {
    expect(labelBaseline([noise(1), noise(2)], labels).sd).toBeGreaterThanOrEqual(MIN_SD)
  })

  it('merges video segment results keeping the best score per label', () => {
    const merged = mergeAssignments([
      [{ labelId: 'a', cosine: 0.7, z: 3.1 }],
      [{ labelId: 'a', cosine: 0.72, z: 4 }, { labelId: 'b', cosine: 0.7, z: 3.5 }],
    ])
    expect(merged.map((m) => [m.labelId, m.z])).toEqual([['a', 4], ['b', 3.5]])
  })

  it('vocabulary ids are unique and every label has names and prompts', () => {
    const ids = VOCABULARY.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of VOCABULARY) expect(l.zh && l.en && l.prompts.length > 0).toBeTruthy()
  })
})
