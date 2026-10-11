/** 地图视图 */
const zh = {
  clickForDetails: '点击查看详情 →',
  loading: '加载中...',
  loadFailed: '地图加载失败',
  emptyTitle: '暂无带位置信息的内容',
  emptyHint: '手机拍摄的图片和视频通常包含 GPS 数据',
  withLocation: (n: number) => `${n.toLocaleString('zh-CN')} 项有位置信息`,
}

const en: typeof zh = {
  clickForDetails: 'Click for details →',
  loading: 'Loading…',
  loadFailed: 'Map failed to load',
  emptyTitle: 'Nothing with location data yet',
  emptyHint: 'Photos and videos taken on phones usually include GPS data',
  withLocation: (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'item' : 'items'} with location`,
}

export default { zh, en }
