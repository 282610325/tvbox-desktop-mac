import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PlayerInfo } from '@shared/types'
import { getSettings } from './settings'

/**
 * 外部播放器接入（macOS）。
 * 内置 Chromium 播不了 mkv / ts / HEVC 这类格式时，把地址交给本机已装的播放器
 * 是最省事也最稳的做法。macOS 上播放器要么是 .app 包，要么是 Homebrew 装的 CLI。
 */

interface Candidate {
  name: string
  paths: string[]
}

const APP_DIRS = ['/Applications', join(homedir(), 'Applications'), '/System/Applications']
const BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function inApps(name: string): string[] {
  return APP_DIRS.map((dir) => join(dir, name))
}

function candidates(): Candidate[] {
  return [
    {
      name: 'IINA',
      paths: inApps('IINA.app')
    },
    {
      name: 'VLC',
      paths: inApps('VLC.app')
    },
    {
      name: 'mpv',
      paths: [...inApps('mpv.app'), join('/opt/homebrew/bin', 'mpv'), join('/usr/local/bin', 'mpv'), join('/usr/bin', 'mpv')]
    },
    {
      name: 'Infuse',
      paths: inApps('Infuse.app')
    },
    {
      name: 'Movist Pro',
      paths: inApps('Movist Pro.app')
    },
    {
      name: 'Elmedia Player',
      paths: inApps('Elmedia Player.app')
    },
    {
      name: 'QuickTime Player',
      paths: ['/System/Applications/QuickTime Player.app']
    }
  ]
}

/** 默认偏好顺序。用户没在设置里写 prefer 时用它 */
export const DEFAULT_PREFER = [
  'IINA',
  'VLC',
  'mpv',
  'Infuse',
  'Movist Pro',
  'Elmedia Player',
  'QuickTime Player'
]

/** 绝对路径直接看文件；只写了命令名（如 `mpv`）就去 PATH 里找 */
function resolveCommand(command: string): string | null {
  const raw = command.trim()
  if (!raw) return null
  if (raw.startsWith('/') || raw.startsWith('~')) {
    const path = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw
    return existsSync(path) ? path : null
  }
  for (const dir of BIN_DIRS) {
    const path = join(dir, raw)
    if (existsSync(path)) return path
  }
  return null
}

/** 扫描本机常见安装路径，按用户设置的偏好排序 */
export async function detectPlayers(): Promise<PlayerInfo[]> {
  const settings = await getSettings()
  const prefer = settings.externalPlayer.prefer?.length
    ? settings.externalPlayer.prefer
    : DEFAULT_PREFER
  const found: PlayerInfo[] = []
  const seen = new Set<string>()

  for (const candidate of candidates()) {
    for (const path of candidate.paths) {
      if (seen.has(path) || !existsSync(path)) continue
      seen.add(path)
      found.push({ name: candidate.name, path, source: 'scan' })
      break
    }
  }

  const rank = (info: PlayerInfo): number => {
    const i = prefer.indexOf(info.name)
    return i < 0 ? prefer.length : i
  }
  found.sort((a, b) => rank(a) - rank(b))

  // 设置里手填的那条：扫不到也照样列出来，不然界面上会出现
  // 「一个都没找到」但上面明明配着一个能用的播放器这种别扭局面
  const manual = resolveCommand(settings.externalPlayer.command ?? '')
  if (manual && !seen.has(manual)) {
    found.unshift({ name: '设置里指定的', path: manual, source: 'manual' })
  }
  return found
}

/** 用户手动指定的播放器优先，其次按偏好列表在本机找一个 */
export async function resolvePlayer(): Promise<string | null> {
  const settings = await getSettings()
  const raw = settings.externalPlayer.command?.trim()
  if (raw) {
    const resolved = resolveCommand(raw)
    if (resolved) return resolved
    throw new Error(`设置里指定的播放器不存在：${raw}`)
  }
  const found = await detectPlayers()
  return found[0]?.path ?? null
}

export interface OpenPlayerResult {
  player: string
  args: string[]
}

/** 调用外部播放器打开一个地址 */
export async function openInPlayer(rawUrl: string, title = ''): Promise<OpenPlayerResult> {
  const url = (rawUrl ?? '').trim()
  if (!/^(https?|rtmp|rtsp|file):/i.test(url)) {
    throw new Error('播放地址不是受支持的协议')
  }
  const command = await resolvePlayer()
  if (!command) {
    throw new Error('没有找到可用的外部播放器，请在「设置」里手动指定播放器路径')
  }

  const settings = await getSettings()
  const template = settings.externalPlayer.args?.length
    ? settings.externalPlayer.args
    : ['{url}']
  const args = template.map((arg) =>
    arg.replace(/\{url\}/gi, url).replace(/\{title\}/gi, title || '')
  )

  // .app 包要走 `open`：直接把地址当文档参数传进去，系统会用该应用打开；
  // 如果带自定义参数，则用 --args 透传（应用已在运行时 --args 会被忽略，
  // 这是 macOS 的既定行为，绝大多数场景下默认模板只有 {url}，不受影响）。
  if (command.endsWith('.app')) {
    const openArgs = args.length === 1 && args[0] === url ? ['-a', command, url] : ['-a', command, '--args', ...args]
    const child = spawn('open', openArgs, { detached: true, stdio: 'ignore' })
    child.unref()
    return { player: command, args: openArgs }
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
  return { player: command, args }
}
