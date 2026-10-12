import { describe, it, expect } from 'vitest'
import { dropFilesBuffer, filenamesPlist } from './fileClipboard'

describe('filenamesPlist（macOS NSFilenamesPboardType）', () => {
  it('路径数组 → plist XML', () => {
    const xml = filenamesPlist(['/Users/a/照片/海边.jpg', '/tmp/b.mp4'])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<plist version="1.0">')
    expect(xml).toContain('<string>/Users/a/照片/海边.jpg</string>')
    expect(xml).toContain('<string>/tmp/b.mp4</string>')
    expect(xml.indexOf('海边')).toBeLessThan(xml.indexOf('b.mp4'))
  })
  it('XML 特殊字符转义（文件名里的 & < >）', () => {
    const xml = filenamesPlist(['/tmp/a&b<c>.jpg'])
    expect(xml).toContain('<string>/tmp/a&amp;b&lt;c&gt;.jpg</string>')
    expect(xml).not.toContain('a&b')
  })
})

describe('dropFilesBuffer（Windows CF_HDROP / DROPFILES）', () => {
  it('20 字节头：pFiles=20、pt/fNC=0、fWide=1', () => {
    const buf = dropFilesBuffer(['C:\\a.jpg'])
    expect(buf.readUInt32LE(0)).toBe(20) // pFiles：路径列表偏移
    expect(buf.readInt32LE(4)).toBe(0) // pt.x
    expect(buf.readInt32LE(8)).toBe(0) // pt.y
    expect(buf.readUInt32LE(12)).toBe(0) // fNC
    expect(buf.readUInt32LE(16)).toBe(1) // fWide：UTF-16
  })
  it('单路径：UTF-16LE + 双 NUL 收尾', () => {
    const buf = dropFilesBuffer(['C:\\a.jpg'])
    expect(buf.subarray(20).toString('utf16le')).toBe('C:\\a.jpg\0\0')
    // 小端：'C' = 0x43 0x00
    expect(buf[20]).toBe(0x43)
    expect(buf[21]).toBe(0x00)
    expect(buf.subarray(buf.length - 4).equals(Buffer.from([0, 0, 0, 0]))).toBe(true)
  })
  it('多路径：每条 NUL 结束，整个列表再补一个 NUL', () => {
    const buf = dropFilesBuffer(['C:\\a.jpg', 'D:\\素材\\猫.png'])
    expect(buf.subarray(20).toString('utf16le')).toBe('C:\\a.jpg\0D:\\素材\\猫.png\0\0')
  })
  it('中文路径按 UTF-16 编码（每个字符两字节）', () => {
    const path = 'D:\\素材\\猫.png'
    const buf = dropFilesBuffer([path])
    expect(buf.length).toBe(20 + (path.length + 2) * 2)
  })
  it('超长文件名（255 字符）完整进列表', () => {
    const long = `E:\\${'长'.repeat(120)}${'x'.repeat(130)}.jpg`
    const buf = dropFilesBuffer([long])
    expect(buf.subarray(20).toString('utf16le')).toBe(`${long}\0\0`)
  })
})
