/**
 * 快速搜索面板的键盘选择逻辑（纯函数）：列表一列、紧凑网格多列共用。
 * 面板焦点始终在输入框，方向键只改"选中下标"，不改 DOM 焦点。
 */

export interface NavState {
  /** 当前选中下标；-1 = 无选中 */
  index: number
  /** 结果总数 */
  count: number
  /** 每行列数：列表 1，紧凑网格 > 1 */
  cols: number
}

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

/** 该按键在当前布局下是否由选择逻辑接管（列表布局的 ←→ 留给输入框移动光标） */
export function handlesKey(key: string, cols: number): key is NavKey {
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End') return true
  return cols > 1 && (key === 'ArrowLeft' || key === 'ArrowRight')
}

/** 移动选中项：不环绕，越界收到边界；没有结果时保持 -1 */
export function moveSelection({ index, count, cols }: NavState, key: NavKey): number {
  if (count <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  // 还没有选中：↓ / → 进入第一项，↑ / ← 进入最后一项
  if (index < 0) return key === 'ArrowUp' || key === 'ArrowLeft' ? count - 1 : 0
  const step = key === 'ArrowLeft' ? -1
    : key === 'ArrowRight' ? 1
    : key === 'ArrowUp' ? -cols
    : cols
  const next = index + step
  // 顶行再按 ↑ 停在原地（网格里跳到 0 会横向乱飘）；其余越界夹到边界
  if (next < 0) return key === 'ArrowUp' ? index : 0
  return Math.min(count - 1, Math.max(0, next))
}

/** 结果集变化后收编选中项：空 → -1，否则夹进范围（新搜索通常传 0 预选第一条） */
export function clampSelection(index: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(count - 1, Math.max(0, index))
}
