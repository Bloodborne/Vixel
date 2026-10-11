/**
 * 核心层写进任务面板的错误信息（src/core/**）。按出错时的界面语言写入数据库，切换语言后旧记录不变。
 * 推理进程和 CLI 不调用 setLocale，用默认的中文。
 */
const zh = {
  durationUnreadable: '无法读取时长（文件损坏或格式不支持）',
  allSegmentsFailed: (n: number, err: string) => `全部 ${n} 个片段失败：${err}`,
  someSegmentsFailed: (failed: number, n: number, err: string) => `${failed}/${n} 个片段失败：${err}`,
}

const en: typeof zh = {
  durationUnreadable: 'Cannot read duration (file damaged or format not supported)',
  allSegmentsFailed: (n, err) => `All ${n} segments failed: ${err}`,
  someSegmentsFailed: (failed, n, err) => `${failed}/${n} segments failed: ${err}`,
}

export default { zh, en }
