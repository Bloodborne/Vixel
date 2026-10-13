/**
 * 自动标签的 IPC 封装：逻辑在 src/services/autotags.ts（桌面与服务器共用），
 * 这里只注册 IPC；状态广播走服务层事件总线（index.ts 统一转发到各窗口）。
 */
import { ipcMain } from 'electron'
import { AUTOTAG_CHANNELS } from '../shared/autotags'
import type { VixelServices } from '../services/api'
import type { AutoTagService } from '../services/autotags'

export type { AutoTagService }

export function registerAutoTags(services: VixelServices): AutoTagService {
  ipcMain.handle(AUTOTAG_CHANNELS.STATUS, async () => services.api.autoTags.status())
  ipcMain.handle(AUTOTAG_CHANNELS.SET_ENABLED, async (_e, on: unknown) => services.api.autoTags.setEnabled(!!on))
  ipcMain.handle(AUTOTAG_CHANNELS.RERUN, async () => services.api.autoTags.rerun())
  return services.autoTags
}
