// 用 hdiutil 生成 macOS 安装镜像。
// electron-builder 自带的 dmg 目标会通过 AppleScript 找 Finder 布置窗口，
// 在没有交互桌面 / 自动化权限的机器上会一直卡住，所以这里只让它出 zip，
// dmg 由本脚本从已打包好的 .app 直接生成（带 Applications 快捷方式）。
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version, name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const appName = 'TVBox Desktop'

const targets = [
  { dir: 'mac', arch: 'x64' },
  { dir: 'mac-arm64', arch: 'arm64' }
]

let built = 0
for (const { dir, arch } of targets) {
  const appPath = join(root, 'release', dir, `${appName}.app`)
  if (!existsSync(appPath)) {
    console.log(`[dmg] 跳过 ${arch}：没有找到 ${appPath}`)
    continue
  }

  const stage = mkdtempSync(join(tmpdir(), `tvbox-dmg-${arch}-`))
  try {
    // verbatimSymlinks 必须开：否则 Node 会把 framework 里的相对软链
    // （Versions/Current/...）改写成指向构建目录的绝对路径，装到别的机器上就废了。
    cpSync(appPath, join(stage, `${appName}.app`), { recursive: true, verbatimSymlinks: true })
    symlinkSync('/Applications', join(stage, 'Applications'))
    const out = join(root, 'release', `${appName}-${version}-${arch}.dmg`)
    execFileSync(
      'hdiutil',
      ['create', '-quiet', '-volname', appName, '-srcfolder', stage, '-ov', '-format', 'UDZO', out],
      { stdio: 'inherit' }
    )
    console.log(`[dmg] ${out}`)
    built += 1
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

if (!built) {
  console.error(`[dmg] 没有生成任何镜像（package: ${name}）`)
  process.exit(1)
}
