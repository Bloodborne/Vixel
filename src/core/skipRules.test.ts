import { describe, it, expect } from 'vitest'
import {
  detectDataset, isCameraName, isCloudPlaceholderName, isCloudFileAttributes, isMachineName,
  isSensitiveFile, looksDataless, shouldIgnorePath, shouldSkipDirName,
} from './skipRules'
import type { MediaKind } from '../shared/types'

describe('isSensitiveFile', () => {
  it('密钥 / 凭据扩展名与名字', () => {
    for (const f of ['server.pem', 'host.key', 'bundle.p12', 'win.pfx', 'release.keystore',
      'app.jks', 'vault.kdbx', 'login.ppk', 'id_rsa', 'id_rsa.pub', 'id_ed25519', '.env', '.env.local',
      'credentials.json', 'secrets.yaml']) {
      expect(isSensitiveFile(f), f).toBe(true)
    }
  })
  it('普通媒体名不拦', () => {
    for (const f of ['IMG_1234.jpg', 'keyboard.png', 'monkey.mp4', 'envelope.heic', 'secretary.jpg']) {
      expect(isSensitiveFile(f), f).toBe(false)
    }
  })
})

describe('shouldSkipDirName / shouldIgnorePath', () => {
  it('隐藏目录、node_modules、.git、包', () => {
    for (const d of ['.git', '.cache', '.Trash', 'node_modules', '__pycache__',
      'Foo.app', 'Photos Library.photoslibrary', 'Project.fcpbundle', 'X.framework']) {
      expect(shouldSkipDirName(d), d).toBe(true)
    }
    for (const d of ['Photos', '相机胶卷', 'build photos', 'apple']) {
      expect(shouldSkipDirName(d), d).toBe(false)
    }
  })

  it('根目录永不忽略，哪怕它本身是 .photoslibrary', () => {
    const root = '/Users/x/Pictures/Photos Library.photoslibrary'
    expect(shouldIgnorePath(root, root)).toBe(false)
  })

  it('路径中间任何一级命中都忽略', () => {
    const root = '/Users/x/Pictures'
    expect(shouldIgnorePath(root, `${root}/node_modules/a/b.jpg`)).toBe(true)
    expect(shouldIgnorePath(root, `${root}/App.app/Contents/icon.png`)).toBe(true)
    expect(shouldIgnorePath(root, `${root}/.hidden/a.jpg`)).toBe(true)
    expect(shouldIgnorePath(root, `${root}/2024/夏天/IMG_0001.HEIC`)).toBe(false)
  })

  it('密钥文件与 iCloud 占位按最后一段忽略', () => {
    const root = '/w'
    expect(shouldIgnorePath(root, '/w/backup/id_rsa')).toBe(true)
    expect(shouldIgnorePath(root, '/w/photos/.IMG_8.HEIC.icloud')).toBe(true)
    expect(shouldIgnorePath(root, '/w/photos/IMG_8.HEIC.icloud')).toBe(true)
    expect(shouldIgnorePath(root, '/w/photos/IMG_8.HEIC')).toBe(false)
  })
})

describe('cloud placeholders', () => {
  it('.icloud 占位名', () => {
    expect(isCloudPlaceholderName('.report.pdf.icloud')).toBe(true)
    expect(isCloudPlaceholderName('movie.mp4.icloud')).toBe(true)
    expect(isCloudPlaceholderName('icloud-notes.jpg')).toBe(false)
  })
  it('dataless：逻辑大小 > 0 且磁盘 0 块', () => {
    expect(looksDataless(1024, 0)).toBe(true)
    expect(looksDataless(1024, 8)).toBe(false)
    expect(looksDataless(0, 0)).toBe(false)
    expect(looksDataless(1024, undefined)).toBe(false) // 平台不给 blocks 时不误伤
  })
  it('Windows OFFLINE / RECALL 属性位', () => {
    expect(isCloudFileAttributes(0x1000)).toBe(true)      // FILE_ATTRIBUTE_OFFLINE
    expect(isCloudFileAttributes(0x400000)).toBe(true)    // RECALL_ON_DATA_ACCESS
    expect(isCloudFileAttributes(0x40000)).toBe(true)     // RECALL_ON_OPEN
    expect(isCloudFileAttributes(0x20 | 0x80)).toBe(false) // ARCHIVE | NORMAL
  })
})

describe('机器命名 vs 相机命名', () => {
  it('机器生成的名字', () => {
    for (const n of ['frame-0042', 'frame_000001', 'clip_000123', '000123', 'img000124',
      'sample_00017', 'step_000100_sample_03', 'tile_12_34',
      '0d9fbd51-6c21-4bb0-bb4c-3a7db36cf413', 'c0ffee00c0ffee00c0ffee00']) {
      expect(isMachineName(n), n).toBe(true)
    }
  })
  it('相机 / 手机命名豁免', () => {
    for (const n of ['IMG_1234', 'IMG_0001', 'DSC_0001', 'DSC01234', 'DSCN1234', 'MVI_8233',
      'PXL_20260101_123456789', 'IMG_20240101_123456', 'VID_20240101_093011',
      'IMG-20240101-WA0012', 'GOPR0042', 'DJI_0127_D', 'P1010001', '20240101_123456',
      'Screenshot 2026-01-01 at 10.00.00', '屏幕截图 2026-01-01 100000']) {
      expect(isCameraName(n), n).toBe(true)
      expect(isMachineName(n), n).toBe(false)
    }
  })
  it('人起的名字两边都不算', () => {
    for (const n of ['wood_anemones', '全家福2024', 'sunset at pier', 'logo-final-v2', '2024_01_vacation']) {
      expect(isMachineName(n), n).toBe(false)
    }
  })
})

describe('detectDataset', () => {
  const files = (names: string[], kind: MediaKind = 'image') => names.map((name) => ({ name, kind }))
  const seq = (prefix: string, n: number, ext = '.png') =>
    Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(6, '0')}${ext}`)

  it('250 个 frame_000001.png → 数据集', () => {
    const v = detectDataset(files(seq('frame_', 250)))
    expect(v.isDataset).toBe(true)
    expect(v.fileCount).toBe(250)
    expect(v.machineRatio).toBeGreaterThan(0.99)
  })

  it('数量不够（199）不算', () => {
    expect(detectDataset(files(seq('frame_', 199))).isDataset).toBe(false)
  })

  it('500 张相机照片（IMG_0001…）不是数据集', () => {
    const names = Array.from({ length: 500 }, (_, i) => `IMG_${String(i).padStart(4, '0')}.JPG`)
    expect(detectDataset(files(names)).isDataset).toBe(false)
  })

  it('机器名占比不足 80% 不算', () => {
    const names = [...seq('frame_', 150), ...Array.from({ length: 100 }, (_, i) => `假期照片 ${i} 海边.jpg`)]
    const v = detectDataset(files(names))
    expect(v.isDataset).toBe(false)
  })

  it('按主导的同类媒体判：少量其他类型不稀释', () => {
    const mixed = [...files(seq('frame_', 240)), ...files(['readme.txt'].map((n) => n), 'image').map((f) => ({ ...f, kind: null }))]
    expect(detectDataset(mixed).isDataset).toBe(true)
  })

  it('UUID 命名的视频数据集', () => {
    const names = Array.from({ length: 220 }, (_, i) =>
      `0d9fbd51-6c21-4bb0-bb4c-${String(i).padStart(12, '0')}.mp4`)
    expect(detectDataset(files(names, 'video')).isDataset).toBe(true)
  })

  it('自定义阈值', () => {
    expect(detectDataset(files(seq('clip_', 20)), { minFiles: 10 }).isDataset).toBe(true)
  })
})
