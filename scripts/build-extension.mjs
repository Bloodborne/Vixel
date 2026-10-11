/**
 * 打包浏览器扩展：extension/ → dist/vixel-extension-<版本>.zip（Chrome / Edge 开发者模式直接拖入，
 * 或解压后"加载已解压的扩展程序"）。图标已从 build/icon.png 预生成（sips），在仓库里。
 *   npm run build:extension
 */
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'extension')
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'))

for (const f of ['manifest.json', 'bg.js', 'popup.html', 'popup.js', 'options.html', 'options.js',
  'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png',
  '_locales/zh_CN/messages.json', '_locales/en/messages.json']) {
  if (!existsSync(join(src, f))) {
    console.error(`missing extension/${f}`)
    process.exit(1)
  }
}

mkdirSync(join(root, 'dist'), { recursive: true })
const out = join(root, 'dist', `vixel-extension-${manifest.version}.zip`)
// zip 在 macOS / Linux 自带；Windows 下可手动压缩 extension/ 目录
execFileSync('zip', ['-r', '-X', '-q', '-FS', out, '.', '-x', '.*'], { cwd: src, stdio: 'inherit' })
console.log(`extension ${manifest.version} → ${out}`)
