/** 自动标签：检查器里的自动标签块、设置里的开关 */
const zh = {
  autoHint: '自动标签 · 点 ✓ 确认，× 删除（以后不会再自动打上）',
  confirm: '确认这个标签',
  settingTitle: '自动标签',
  settingOn: '根据画面内容自动打标签',
  settingNote: '离线完成，不上传任何内容。自动打的标签带 ✦，可以确认或删除；关闭会去掉还没确认的自动标签。',
  rerun: '重新生成',
  running: (done: number, total: number) => `正在生成 ${done}/${total}`,
  upToDate: (n: number) => `已处理 ${n.toLocaleString('zh-CN')} 项`,
  waiting: '库里内容超过 20 项后开始生成',
}

const en: typeof zh = {
  autoHint: 'Auto tag · ✓ to keep, × to remove (it won’t be added again)',
  confirm: 'Keep this tag',
  settingTitle: 'Auto Tags',
  settingOn: 'Tag photos and videos by what’s in them',
  settingNote: 'Runs offline; nothing is uploaded. Auto tags are marked ✦ and can be kept or removed. Turning this off removes auto tags you haven’t kept.',
  rerun: 'Regenerate',
  running: (done, total) => `Generating ${done}/${total}`,
  upToDate: (n) => `${n.toLocaleString('en-US')} items processed`,
  waiting: 'Starts once the library has more than 20 items',
}

export default { zh, en }
