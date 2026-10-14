const zh = {
  // 窗口标签
  tabGeneral: '通用',
  tabFolders: '文件夹',
  tabModel: 'AI 模型',
  // 通用 › 外观
  appearance: '外观',
  themeSystem: '跟随系统',
  themeLight: '浅色',
  themeDark: '深色',
  appearanceNote: '大图详情和快速查看始终使用深色背景，便于看片。',
  // 通用 › 语言
  language: '语言',
  languageSystem: '跟随系统',
  languageNote: '切换后窗口会重新载入。搜索不受界面语言影响，中文、英文等都能搜。',
  // 通用 › 索引（电源策略）
  indexingSection: '索引',
  indexOnBattery: '电池供电时也索引',
  indexOnBatteryNote: '关闭后，大批量索引会等到接通电源再继续；新加入的少量文件仍会立即索引。低电量模式或机器过热时也会自动暂缓。',
  // 文件夹
  noFolders: '还没有添加文件夹',
  noFoldersHint: '添加文件夹后自动扫描并索引，原文件不会被移动或修改',
  addFolder: '添加文件夹',
  // 文件夹 › 跳过的数据集目录
  skippedDatasets: (n: number) => `跳过了 ${n} 个看起来像数据集的文件夹`,
  skippedDatasetDetail: (n: number) => `${n} 个同类文件，名字多为机器生成`,
  indexAnyway: '仍然索引',
  indexAnywayDone: '已加入索引',
  // 选中的根目录本身是"照片"图库包
  photosLibraryRoot: '这是「照片」App 管理的图库包：内部结构私有、可能随系统更新变化。建议改为从「照片」导出后再索引导出的文件夹。',
  folderUnreadableServer: '容器读不到这个目录（权限不足）。群晖上照片共享文件夹通常只授权给 administrators 等用户组：在 compose 里加 group_add: ["101"]（管理员组；或其他有读权限的组），或在 控制面板 › 共享文件夹 › 编辑 › 权限 里给 PUID 对应的用户勾选「只读」，然后重启容器。',
  folderUnreadableDesktop: '读不到这个文件夹：可能是外接盘没连接，或系统没有授予 Vixel 访问权限。',
  removeFolderTitle: '确认移除文件夹',
  /** 名称两侧要加引号，由组件加粗显示，所以拆成前后两段 */
  removeFolderAskBefore: '确定要移除 ',
  removeFolderAskAfter: ' 吗？',
  removeFolderCountBefore: '该文件夹包含 ',
  removeFolderCountAfter: ' 项已索引的内容，将从搜索库中移除。',
  removeFolderNote: '此操作只会从 Vixel 中移除索引，不会删除原始文件。',
  removing: '移除中...',
  confirmRemove: '确认移除',
}

const en: typeof zh = {
  tabGeneral: 'General',
  tabFolders: 'Folders',
  tabModel: 'AI Model',
  appearance: 'Appearance',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  appearanceNote: 'Photo detail and Quick Look always use a dark background.',
  language: 'Language',
  languageSystem: 'System',
  languageNote: 'Vixel reloads after switching. Search works in any language regardless of this setting.',
  indexingSection: 'Indexing',
  indexOnBattery: 'Index on battery',
  indexOnBatteryNote: 'When off, bulk indexing waits until the Mac is plugged in; a handful of newly added files are still indexed right away. Indexing also pauses automatically in Low Power Mode or when the machine runs hot.',
  noFolders: 'No folders yet',
  noFoldersHint: 'Added folders are scanned and indexed automatically. Original files are never moved or changed.',
  addFolder: 'Add Folder',
  skippedDatasets: (n: number) => `Skipped ${n} folder${n === 1 ? '' : 's'} that look like datasets`,
  skippedDatasetDetail: (n: number) => `${n.toLocaleString('en-US')} files of one kind, mostly machine-named`,
  indexAnyway: 'Index anyway',
  indexAnywayDone: 'Indexing',
  photosLibraryRoot: 'This is a Photos library bundle managed by the Photos app: its internal layout is private and can change with system updates. Consider exporting from Photos and indexing the exported folder instead.',
  folderUnreadableServer: 'The container can’t read this folder (permission denied). On Synology, shared folders are usually granted to groups such as administrators: add group_add: ["101"] to the compose file (the administrators group, or another group that can read the share), or give the PUID user Read-only access under Control Panel › Shared Folder › Edit › Permissions, then restart the container.',
  folderUnreadableDesktop: 'Can’t read this folder: the drive may be disconnected, or the system hasn’t granted Vixel access.',
  removeFolderTitle: 'Remove Folder?',
  removeFolderAskBefore: 'Remove ',
  removeFolderAskAfter: '?',
  removeFolderCountBefore: 'Its ',
  removeFolderCountAfter: ' indexed items will be removed from search.',
  removeFolderNote: 'Only the index is removed from Vixel. Original files are not deleted.',
  removing: 'Removing…',
  confirmRemove: 'Remove',
}

export default { zh, en }
