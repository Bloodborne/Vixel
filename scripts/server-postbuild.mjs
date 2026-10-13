#!/usr/bin/env node
// build:server 的收尾：tsc 按 rootDir=src 输出到 dist/server/{server,services,core,shared}/，
// 在 dist/server/index.js 放一个入口 shim，使文档里的 `node dist/server/index.js` 成立。
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
writeFileSync(
  join(root, 'dist/server/index.js'),
  `// 入口 shim（scripts/server-postbuild.mjs 生成）：真正的入口在 ./server/index.js\nrequire('./server/index.js')\n`
)
console.log('dist/server/index.js shim written')
