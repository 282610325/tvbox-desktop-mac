import { useEffect, useRef, useState } from 'react'
import type { PlayerInfo } from '@shared/types'
import { useApp } from '@/store/useApp'
import { Icon } from './icons'

/**
 * 外部播放器按钮：点开先列出本机检测到的播放器，由用户挑一个。
 * 不再默认直接交给 QuickTime（或偏好列表里的第一个）。
 */
export function ExternalPlayerButton({
  url,
  title,
  className = 'btn btn-sm'
}: {
  url: string
  title: string
  className?: string
}): JSX.Element {
  const notify = useApp((s) => s.notify)
  const [open, setOpen] = useState(false)
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function toggle(): Promise<void> {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setLoading(true)
    try {
      setPlayers(await window.api.player.detect())
    } catch (err) {
      setPlayers([])
      notify(`检测播放器失败：${(err as Error).message}`, 'warn')
    } finally {
      setLoading(false)
    }
  }

  async function openWith(path: string, name: string): Promise<void> {
    setOpen(false)
    try {
      await window.api.player.open(url, title, path)
      notify(`已用「${name}」打开`, 'success')
    } catch (err) {
      notify((err as Error).message, 'danger')
    }
  }

  return (
    <div className="player-picker" ref={boxRef}>
      <button type="button" className={className} disabled={!url} onClick={() => void toggle()}>
        <Icon name="external" size={13} /> 外部播放器
      </button>
      {open ? (
        <div className="player-picker-menu">
          <div className="player-picker-title">选择本机播放器</div>
          {loading ? (
            <div className="player-picker-empty">
              <span className="spin" /> 正在检测…
            </div>
          ) : null}
          {!loading && players?.length
            ? players.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  className="player-picker-item"
                  title={p.path}
                  onClick={() => void openWith(p.path, p.name)}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="player-picker-path">{p.path.split('/').pop()}</span>
                </button>
              ))
            : null}
          {!loading && players && players.length === 0 ? (
            <div className="player-picker-empty">
              没有检测到播放器。装一个 IINA / VLC / mpv，或在「设置」里手填路径。
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
