import { describe, it, expect } from 'vitest'
import { cpus } from 'os'
import { cpuSessionOptions } from './session-options'

describe('cpuSessionOptions', () => {
  it('defaults: half the cores, CPU EP, arena left at the onnxruntime default', () => {
    const o = cpuSessionOptions({})
    expect(o.executionProviders).toEqual(['cpu'])
    expect(o.intraOpNumThreads).toBe(Math.max(1, Math.floor(cpus().length / 2)))
    expect(o.interOpNumThreads).toBe(1)
    expect('enableCpuMemArena' in o).toBe(false)
  })

  it('honours VIXEL_THREADS and ignores junk values', () => {
    expect(cpuSessionOptions({ VIXEL_THREADS: '2' }).intraOpNumThreads).toBe(2)
    expect(cpuSessionOptions({ VIXEL_THREADS: '0' }).intraOpNumThreads).toBe(Math.max(1, Math.floor(cpus().length / 2)))
    expect(cpuSessionOptions({ VIXEL_THREADS: 'x' }).intraOpNumThreads).toBe(Math.max(1, Math.floor(cpus().length / 2)))
  })

  it('VIXEL_ORT_MEM_ARENA=0 disables the CPU memory arena', () => {
    expect(cpuSessionOptions({ VIXEL_ORT_MEM_ARENA: '0' }).enableCpuMemArena).toBe(false)
    expect('enableCpuMemArena' in cpuSessionOptions({ VIXEL_ORT_MEM_ARENA: '1' })).toBe(false)
  })
})
