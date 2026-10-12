/**
 * 电源策略的 Electron 接线（决策本体在 core/powerPolicy.ts，纯函数）。
 *
 * 全部事件驱动（无轮询）：
 *   - on-battery / on-ac               电池 ↔ 电源（macOS / Windows / Linux）
 *   - thermal-state-change             温度状态（仅 macOS：nominal…critical）
 *   - speed-limit-change               OS 广播的 CPU 速度上限（macOS / Windows）。
 *     Electron 没有直接的"低电量模式"API —— macOS 低电量模式和 Windows 节能模式
 *     都会把这个上限压低，经它间接检测（阈值见 powerPolicy.LOW_POWER_SPEED_LIMIT）。
 *
 * 调试 / 截图巡检：
 *   - 环境变量 VIXEL_POWER_SIM=battery|low-power|thermal 启动时就模拟对应状态
 *   - getPowerController().simulate(...) 运行中注入（capture tour 用）
 */
import { powerMonitor } from 'electron'
import { evaluatePowerPolicy, type PowerState, type PowerWaitReason } from '../core/powerPolicy'

export interface PowerController {
  /** 设置变了（电池开关）后重算一次 */
  refresh(): void
  /** 注入模拟状态（覆盖对应字段）；null 清除。截图巡检 / 手动验证用 */
  simulate(overrides: Partial<PowerState> | null): void
  /** 诊断：当前生效状态与结论 */
  snapshot(): PowerState & { reason: PowerWaitReason | null; simulated: boolean }
}

let controller: PowerController | null = null

/** capture tour 等主进程内部调用方拿控制器（initPowerPolicy 之前为 null） */
export function getPowerController(): PowerController | null {
  return controller
}

function simFromEnv(): Partial<PowerState> | null {
  switch (process.env.VIXEL_POWER_SIM) {
    case 'battery': return { onBattery: true }
    case 'low-power': return { speedLimit: 50 }
    case 'thermal': return { thermalState: 'serious' }
    default: return null
  }
}

export function initPowerPolicy(opts: {
  /** 设置："电池供电时也索引"（默认开） */
  allowOnBattery: () => boolean
  onChange: (reason: PowerWaitReason | null) => void
}): PowerController {
  let sim: Partial<PowerState> | null = simFromEnv()
  // speed limit 没有 getter，只有事件；未知按 100（不限速）
  let speedLimit = 100
  let lastReason: PowerWaitReason | null | undefined

  const state = (): PowerState => ({
    onBattery: powerMonitor.isOnBatteryPower(),
    speedLimit,
    thermalState: process.platform === 'darwin' ? powerMonitor.getCurrentThermalState() : 'unknown',
    ...(sim ?? {}),
  })

  const recompute = (): void => {
    const { reason } = evaluatePowerPolicy(state(), opts.allowOnBattery())
    if (reason !== lastReason) {
      lastReason = reason
      console.log(`[power] backfill ${reason ? `waiting (${reason})` : 'allowed'}`)
      opts.onChange(reason)
    }
  }

  powerMonitor.on('on-battery', recompute)
  powerMonitor.on('on-ac', recompute)
  if (process.platform === 'darwin') {
    powerMonitor.on('thermal-state-change', recompute)
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    // 类型声明里 listener 无参，实际随事件带 limit（%）；防御性取第一个数字参数
    ;(powerMonitor as NodeJS.EventEmitter).on('speed-limit-change', (...args: unknown[]) => {
      const limit = args.find((a) => typeof a === 'number') as number | undefined
      if (limit !== undefined) speedLimit = limit
      recompute()
    })
  }

  recompute()

  controller = {
    refresh: recompute,
    simulate: (overrides) => {
      sim = overrides
      recompute()
    },
    snapshot: () => ({ ...state(), reason: lastReason ?? null, simulated: sim !== null }),
  }
  return controller
}
