/**
 * 索引的电源策略（纯函数，不碰 Electron）：大批量回填（首次索引、启动补扫、
 * OCR / 人脸 / 色板 / 自动标签回填）什么时候该等一等；少量新文件始终立即索引
 * （"live" 任务的放行门槛见 LIVE_TASK_BURST_MAX，判定在 indexer 里）。
 *
 * 输入来自 Electron powerMonitor（见 main/power.ts），各平台能拿到的信号不同：
 *
 *   信号                  macOS                         Windows
 *   ─────────────────────────────────────────────────────────────────────────
 *   电池 / 电源           on-battery / on-ac 事件 ✓     同左 ✓
 *   温度压力              thermal-state-change ✓        ✗（无此事件，按 unknown 处理）
 *                         (nominal/fair/serious/critical)
 *   低电量模式 / 省电模式  无直接 API；系统降低 CPU      speed-limit-change ✓（省电模式 /
 *                         speed limit，经                Power Throttling 时系统广播
 *                         speed-limit-change 间接可见    降低的速度上限）
 *
 * 所以"低电量模式"统一用 OS 广播的 CPU 速度上限近似：≤ LOW_POWER_SPEED_LIMIT 视为
 * 系统在省电 / 降频，回填暂缓。这在 macOS 同时覆盖了部分温度降频（与 thermal 状态互补），
 * 在 Windows 覆盖电池节能模式。Linux：只有电池信号。全部事件驱动，无轮询。
 */

export type ThermalState = 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'

export interface PowerState {
  /** 正在用电池供电 */
  onBattery: boolean
  /** OS 广播的 CPU 速度上限（%）；100 = 不限速。未知时传 100 */
  speedLimit: number
  /** macOS 温度状态；其余平台 'unknown' */
  thermalState: ThermalState
}

/** 回填等待的原因（给状态栏 / 任务抽屉解释用，和手动暂停区分开） */
export type PowerWaitReason = 'battery' | 'low-power' | 'thermal'

/** OS 把 CPU 速度上限压到这个值以下 → 视为低电量模式 / 省电模式 / 重度降频 */
export const LOW_POWER_SPEED_LIMIT = 60

/**
 * "少量新文件"的上限：电源策略挡住回填时，watcher 实时事件（新拷入的文件、
 * 收集箱收到的内容）产生的待办任务不超过这个数就照常跑；超过就当作回填一起等。
 */
export const LIVE_TASK_BURST_MAX = 20

export interface PowerDecision {
  allowBackfill: boolean
  reason: PowerWaitReason | null
}

/**
 * 回填是否放行。多个原因同时成立时报告最"具体"的那个：
 * 温度（设备已经在受热保护）> 低电量模式（用户显式要省电）> 电池（取决于设置）。
 */
export function evaluatePowerPolicy(state: PowerState, allowOnBattery: boolean): PowerDecision {
  if (state.thermalState === 'serious' || state.thermalState === 'critical') {
    return { allowBackfill: false, reason: 'thermal' }
  }
  if (state.speedLimit <= LOW_POWER_SPEED_LIMIT) {
    return { allowBackfill: false, reason: 'low-power' }
  }
  if (state.onBattery && !allowOnBattery) {
    return { allowBackfill: false, reason: 'battery' }
  }
  return { allowBackfill: true, reason: null }
}
