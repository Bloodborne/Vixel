import { describe, it, expect } from 'vitest'
import { cpuFlagsHaveAvx } from './index'

describe('cpuFlagsHaveAvx', () => {
  it('detects avx in /proc/cpuinfo flags', () => {
    expect(cpuFlagsHaveAvx('processor\t: 0\nflags\t\t: fpu sse4_2 avx avx2 fma\n')).toBe(true)
  })
  it('J4125 / Denverton style flags (sse4_2, no avx) are unsupported', () => {
    expect(cpuFlagsHaveAvx('processor\t: 0\nflags\t\t: fpu sse sse2 ssse3 sse4_1 sse4_2 aes sha_ni\n')).toBe(false)
  })
  it('does not match avx512 / avx_vnni substrings as avx', () => {
    expect(cpuFlagsHaveAvx('flags\t\t: sse4_2 avx_vnni\n')).toBe(false)
  })
  it('unknown format counts as supported (never disable by mistake)', () => {
    expect(cpuFlagsHaveAvx('Features\t: fp asimd\n')).toBe(true)
  })
})
