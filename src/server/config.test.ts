import { describe, it, expect } from 'vitest'
import { parseServerConfig, ConfigError } from './config'

const repoRoot = '/repo'
const base = { VIXEL_DATA_DIR: '/data', VIXEL_PASSWORD: 'hunter22' }

describe('parseServerConfig', () => {
  it('applies defaults (port 8080, host 0.0.0.0, resources dirs)', () => {
    const c = parseServerConfig(base, repoRoot)
    expect(c.port).toBe(8080)
    expect(c.host).toBe('0.0.0.0')
    expect(c.dataDir).toBe('/data')
    expect(c.modelsDir).toBe('/repo/resources/models')
    expect(c.litertDir).toBe(`/repo/resources/litert/${process.platform}-${process.arch}`)
    expect(c.libraryDirs).toEqual([])
    expect(c.password).toBe('hunter22')
  })

  it('parses comma-separated library dirs, trimming blanks', () => {
    const c = parseServerConfig({ ...base, VIXEL_LIBRARY_DIRS: '/photos/a, /photos/b ,,' }, repoRoot)
    expect(c.libraryDirs).toEqual(['/photos/a', '/photos/b'])
  })

  it('requires VIXEL_DATA_DIR', () => {
    expect(() => parseServerConfig({ VIXEL_PASSWORD: 'x'.repeat(8) }, repoRoot)).toThrow(ConfigError)
  })

  it('refuses to start without a password unless VIXEL_ALLOW_NO_AUTH=1', () => {
    expect(() => parseServerConfig({ VIXEL_DATA_DIR: '/data' }, repoRoot)).toThrow(/VIXEL_PASSWORD/)
    const c = parseServerConfig({ VIXEL_DATA_DIR: '/data', VIXEL_ALLOW_NO_AUTH: '1' }, repoRoot)
    expect(c.password).toBeNull()
    expect(c.allowNoAuth).toBe(true)
  })

  it('rejects too-short passwords and bad ports', () => {
    expect(() => parseServerConfig({ VIXEL_DATA_DIR: '/d', VIXEL_PASSWORD: 'abc' }, repoRoot)).toThrow(/at least 4/)
    expect(() => parseServerConfig({ ...base, VIXEL_PORT: 'nope' }, repoRoot)).toThrow(/VIXEL_PORT/)
    expect(() => parseServerConfig({ ...base, VIXEL_PORT: '70000' }, repoRoot)).toThrow(/VIXEL_PORT/)
  })

  it('honours explicit overrides', () => {
    const c = parseServerConfig({
      ...base,
      VIXEL_PORT: '9090',
      VIXEL_HOST: '127.0.0.1',
      VIXEL_MODELS_DIR: '/models',
      VIXEL_LITERT_DIR: '/litert',
    }, repoRoot)
    expect(c.port).toBe(9090)
    expect(c.host).toBe('127.0.0.1')
    expect(c.modelsDir).toBe('/models')
    expect(c.litertDir).toBe('/litert')
  })
})
