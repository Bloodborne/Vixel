/**
 * 必须是 main.tsx 的第一个 import：ES 模块按 import 顺序求值，各组件模块顶层的文案表
 * （如设置页标签）在求值时就读了 `t`，所以语言要在它们之前定下。切换语言时主进程整窗 reload。
 */
import { setLocale } from '../../../shared/i18n'

setLocale(window.api.locale)
document.documentElement.lang = window.api.locale
