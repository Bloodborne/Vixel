/** 以图搜图：拖入 / 粘贴查询图、搜索框芯片、右键"以此图搜索"（App.tsx / SearchBar / Toolbar / menu.ts） */
const zh = {
  // 右键菜单（取代了"查找相似内容"：同一套向量，但连视频片段一起搜，门槛按库标定）
  searchWithThis: '以此图搜索',
  // 拖拽悬停时工具栏上的落点
  dropHint: '松开以图搜图',
  // 副标题 / 芯片
  title: '以图搜图',
  queryImage: '查询图',
  clearQuery: '清除查询图 (Esc)',
  placeholderWithImage: '补充一句描述，可进一步缩小范围…',
  // 查询图本身在库里：已排除
  selfExcluded: '这张图就在资料库里，已从结果中排除，下面是其余相近的内容。',
  // 没有过相关性门槛的命中
  lowConfidence: '没有和这张图明显相近的内容，下面按相似度列出最接近的结果。',
  noMatchHint: '换一张更有辨识度的图，或补充一句文字描述',
  // 失败提示（空状态）
  errorDecodeTitle: '无法读取这张图片',
  errorDecodeHint: '支持常见图片格式（JPEG / PNG / HEIC / WebP / RAW 等），换一张试试',
  errorModelTitle: '语义模型未就绪',
  errorModelHint: '以图搜图需要本地模型，等状态栏里的模型加载完成后再试',
}

const en: typeof zh = {
  searchWithThis: 'Search with This Image',
  dropHint: 'Drop to search by image',
  title: 'Image search',
  queryImage: 'Query image',
  clearQuery: 'Clear query image (Esc)',
  placeholderWithImage: 'Add words to narrow it down…',
  selfExcluded: 'This image is in your library; it has been excluded, and the closest other items are shown below.',
  lowConfidence: 'Nothing clearly matches this image. The closest items are listed below by similarity.',
  noMatchHint: 'Try a more distinctive image, or add a few words',
  errorDecodeTitle: 'Could not read that image',
  errorDecodeHint: 'Common formats work (JPEG / PNG / HEIC / WebP / RAW) — try another image',
  errorModelTitle: 'Search model not ready',
  errorModelHint: 'Image search needs the on-device model. Try again once the status bar shows it is loaded.',
}

export default { zh, en }
