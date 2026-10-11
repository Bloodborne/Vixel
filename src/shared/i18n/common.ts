/** 多处共用的词：媒体类型、数量、时长、通用按钮。各区域专属的文案放在自己的文件里。 */
const n = (v: number): string => v.toLocaleString('zh-CN')
const nEn = (v: number): string => v.toLocaleString('en-US')
const plural = (v: number, one: string, many: string): string => `${nEn(v)} ${v === 1 ? one : many}`

const zh = {
  appName: 'Vixel',
  // 媒体类型
  all: '全部',
  image: '图片',
  images: '图片',
  video: '视频',
  videos: '视频',
  audio: '音频',
  // 数量
  items: (v: number) => `${n(v)} 项`,
  imageCount: (v: number) => `${n(v)} 张图片`,
  videoCount: (v: number) => `${n(v)} 个视频`,
  audioCount: (v: number) => `${n(v)} 个音频`,
  photoCount: (v: number) => `${n(v)} 张照片`,
  /** 列表分隔：12 张图片 · 3 个视频 */
  sep: ' · ',
  // 时长（口语化，约 3 分钟）
  seconds: (v: number) => `${v} 秒`,
  minutes: (v: number) => `${v} 分钟`,
  hours: (v: string) => `${v} 小时`,
  // 通用按钮 / 动作
  ok: '好',
  cancel: '取消',
  close: '关闭',
  delete: '删除',
  remove: '移除',
  rename: '重命名',
  retry: '重试',
  save: '保存',
  open: '打开',
  more: '更多',
  loading: '加载中…',
  unknown: '未知',
  none: '无',
  settings: '设置',
  // 系统集成
  revealMac: '在访达中显示',
  revealWin: '打开所在位置',
  revealWinLong: '打开文件所在的位置',
  openWithDefault: '用默认应用打开',
  copyPath: '拷贝路径',
}

const en: typeof zh = {
  appName: 'Vixel',
  all: 'All',
  image: 'Image',
  images: 'Images',
  video: 'Video',
  videos: 'Videos',
  audio: 'Audio',
  items: (v) => plural(v, 'item', 'items'),
  imageCount: (v) => plural(v, 'image', 'images'),
  videoCount: (v) => plural(v, 'video', 'videos'),
  audioCount: (v) => plural(v, 'audio file', 'audio files'),
  photoCount: (v) => plural(v, 'photo', 'photos'),
  sep: ' · ',
  seconds: (v) => `${v} s`,
  minutes: (v) => `${v} min`,
  hours: (v) => `${v} h`,
  ok: 'OK',
  cancel: 'Cancel',
  close: 'Close',
  delete: 'Delete',
  remove: 'Remove',
  rename: 'Rename',
  retry: 'Retry',
  save: 'Save',
  open: 'Open',
  more: 'More',
  loading: 'Loading…',
  unknown: 'Unknown',
  none: 'None',
  settings: 'Settings',
  revealMac: 'Show in Finder',
  revealWin: 'Show in Explorer',
  revealWinLong: 'Show in File Explorer',
  openWithDefault: 'Open with Default App',
  copyPath: 'Copy Path',
}

export default { zh, en }
