import { describe, it, expect } from 'vitest'
import { evaluatePowerPolicy, LOW_POWER_SPEED_LIMIT, type PowerState } from './powerPolicy'

const base: PowerState = { onBattery: false, speedLimit: 100, thermalState: 'nominal' }

describe('evaluatePowerPolicy', () => {
  it('接电、不降频、温度正常 → 放行', () => {
    expect(evaluatePowerPolicy(base, true)).toEqual({ allowBackfill: true, reason: null })
    expect(evaluatePowerPolicy(base, false)).toEqual({ allowBackfill: true, reason: null })
  })

  it('电池：默认（允许电池索引）放行，用户关掉后等待', () => {
    const onBattery = { ...base, onBattery: true }
    expect(evaluatePowerPolicy(onBattery, true).allowBackfill).toBe(true)
    expect(evaluatePowerPolicy(onBattery, false)).toEqual({ allowBackfill: false, reason: 'battery' })
  })

  it('温度 serious / critical 等待，nominal / fair / unknown 不拦', () => {
    for (const thermalState of ['serious', 'critical'] as const) {
      expect(evaluatePowerPolicy({ ...base, thermalState }, true)).toEqual({ allowBackfill: false, reason: 'thermal' })
    }
    for (const thermalState of ['nominal', 'fair', 'unknown'] as const) {
      expect(evaluatePowerPolicy({ ...base, thermalState }, true).allowBackfill).toBe(true)
    }
  })

  it('低电量模式（speed limit 压低）等待；刚好在阈值也算', () => {
    expect(evaluatePowerPolicy({ ...base, speedLimit: LOW_POWER_SPEED_LIMIT }, true))
      .toEqual({ allowBackfill: false, reason: 'low-power' })
    expect(evaluatePowerPolicy({ ...base, speedLimit: LOW_POWER_SPEED_LIMIT + 1 }, true).allowBackfill).toBe(true)
    expect(evaluatePowerPolicy({ ...base, speedLimit: 50 }, true).allowBackfill).toBe(false)
  })

  it('多个原因并存时报告更具体的：thermal > low-power > battery', () => {
    const all: PowerState = { onBattery: true, speedLimit: 50, thermalState: 'critical' }
    expect(evaluatePowerPolicy(all, false).reason).toBe('thermal')
    expect(evaluatePowerPolicy({ ...all, thermalState: 'nominal' }, false).reason).toBe('low-power')
    expect(evaluatePowerPolicy({ ...all, thermalState: 'nominal', speedLimit: 100 }, false).reason).toBe('battery')
  })

  it('温度阻断不受"电池供电时也索引"设置影响（手动暂停才是最高优先级，在 indexer 里）', () => {
    expect(evaluatePowerPolicy({ ...base, thermalState: 'serious' }, true).allowBackfill).toBe(false)
  })
})
