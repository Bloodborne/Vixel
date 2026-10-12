import { describe, it, expect } from 'vitest'
import { filenamesPlist, fileNameWBuffer } from './fileClipboard'

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

describe('fileNameWBuffer（Windows CF_FILENAMEW）', () => {
  it('UTF-16LE 编码、NUL 结尾', () => {
    const buf = fileNameWBuffer('C:\\a.jpg')
    expect(buf.toString('utf16le')).toBe('C:\\a.jpg\0')
    // 小端：'C' = 0x43 0x00
    expect(buf[0]).toBe(0x43)
    expect(buf[1]).toBe(0x00)
    expect(buf.subarray(buf.length - 2).equals(Buffer.from([0, 0]))).toBe(true)
  })
  it('中文路径按 UTF-16 编码（每个字符两字节）', () => {
    const buf = fileNameWBuffer('D:\\素材\\猫.png')
    expect(buf.length).toBe(('D:\\素材\\猫.png'.length + 1) * 2)
    expect(buf.toString('utf16le')).toBe('D:\\素材\\猫.png\0')
  })
})
