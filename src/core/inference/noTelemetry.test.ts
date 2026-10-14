import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/** 会加载 onnxruntime 的进程入口：第一个 import 必须是 noTelemetry（服务器入口允许 bootstrap 在前） */
const ENTRIES = ['src/main/index.ts', 'src/main/inference.ts', 'src/server/index.ts', 'src/server/inference-worker.ts']

describe('onnxruntime telemetry is disabled in every process entry', () => {
  it.each(ENTRIES)('%s', (file) => {
    const imports = readFileSync(join(__dirname, '../../..', file), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('import '))
      .filter((l) => !l.includes("'./bootstrap'"))
    expect(imports[0]).toContain('noTelemetry')
  })

  it('sets ORT_DISABLE_TELEMETRY', async () => {
    delete process.env.ORT_DISABLE_TELEMETRY
    await import('./noTelemetry')
    expect(process.env.ORT_DISABLE_TELEMETRY).toBe('1')
  })
})
