/** 主进程：窗口标题、对话框、IPC 返回给界面的错误（src/main/*.ts） */
const zh = {
  settingsTitle: '设置',
  videoMissing: '视频文件已不存在',
  startupFailedTitle: 'Vixel 无法启动',
  startupFailedDetail: (msg: string, dataDir: string) => `${msg}\n\n数据目录：${dataDir}`,
}

const en: typeof zh = {
  settingsTitle: 'Settings',
  videoMissing: 'The video file no longer exists',
  startupFailedTitle: 'Vixel could not start',
  startupFailedDetail: (msg, dataDir) => `${msg}\n\nData folder: ${dataDir}`,
}

export default { zh, en }
