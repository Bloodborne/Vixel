/** 主窗口外壳：状态栏、侧栏、工具栏、搜索框、空状态 / 提示条（App.tsx） */
const zh = {
  // 状态栏
  thumbnails: (done: number, total: number) => `生成缩略图 ${done}/${total}`,
  indexing: (done: number, total: number) => `生成索引 ${done}/${total}`,
  segments: (kind: 'audio' | 'video', done: number, total: number) => `处理${kind === 'audio' ? '音频' : '视频'}片段 ${done}/${total}`,
  processingMedia: '处理音视频…',
  ocrProgress: (done: number, total: number) => `识别图内文字 ${done}/${total}`,
  detectingFaces: '检测人脸…',
  modelInitFailed: '语义模型初始化失败',
  modelMissing: '语义模型缺失',
  modelNotReady: '语义模型未就绪',
  selected: (n: number) => ` · 已选 ${n.toLocaleString('zh-CN')}`,
  viewActivity: (key: string) => `查看活动 (${key})`,
  indexPaused: '索引已暂停',
  upToDate: '索引已是最新',
  addFolderToStart: '添加文件夹开始使用',
  modelIssueHint: '语义搜索暂不可用，点击打开设置查看模型状态',
  failedCount: (n: number) => `${n} 失败`,
  resume: '继续',
  pause: '暂停',
  densityTitle: (info: boolean) => `信息密度：${info ? '信息式' : '沉浸式'} (G)`,
  thumbSizeTitle: (bigger: string, smaller: string) => `缩略图大小 (${bigger} / ${smaller})`,
}

const en: typeof zh = {
  thumbnails: (done, total) => `Generating thumbnails ${done}/${total}`,
  indexing: (done, total) => `Indexing ${done}/${total}`,
  segments: (kind, done, total) => `Processing ${kind} segments ${done}/${total}`,
  processingMedia: 'Processing audio and video…',
  ocrProgress: (done, total) => `Reading text in images ${done}/${total}`,
  detectingFaces: 'Detecting faces…',
  modelInitFailed: 'Search model failed to load',
  modelMissing: 'Search model missing',
  modelNotReady: 'Search model loading',
  selected: (n) => ` · ${n.toLocaleString('en-US')} selected`,
  viewActivity: (key) => `Activity (${key})`,
  indexPaused: 'Indexing paused',
  upToDate: 'Up to date',
  addFolderToStart: 'Add a folder to get started',
  modelIssueHint: 'Semantic search is unavailable. Click to check the model in Settings.',
  failedCount: (n) => `${n} failed`,
  resume: 'Resume',
  pause: 'Pause',
  densityTitle: (info) => `Density: ${info ? 'details' : 'immersive'} (G)`,
  thumbSizeTitle: (bigger, smaller) => `Thumbnail size (${bigger} / ${smaller})`,
}

export default { zh, en }
