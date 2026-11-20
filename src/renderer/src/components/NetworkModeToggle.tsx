import { useCallback, useState } from 'react'
import { Icon } from '@/components/icons'
import { useApp } from '@/store/useApp'

interface Props {
  className?: string
}

/**
 * 播放页 / 直播页里的「直连 ↔ 系统代理」快速切换。
 *
 * Chromium 的代理是按 session 生效的，整个应用只有一个，所以这里改的其实是
 * 全局设置；放在播放页只是为了在「播不了」的时候少跳一次设置页。
 */
export function NetworkModeToggle({ className = 'btn btn-sm' }: Props): JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const notify = useApp((s) => s.notify)
  const [busy, setBusy] = useState(false)

  const direct = settings?.directConnection ?? true

  const toggle = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await updateSettings({ directConnection: !direct })
      notify(
        direct
          ? '已改为跟随系统代理；画面没恢复就重新点一次这个视频，或换条线路'
          : '已改为直连（绕过系统代理）；画面没恢复就重新点一次这个视频，或换条线路',
        'success'
      )
    } catch (err) {
      notify((err as Error).message, 'danger')
    } finally {
      setBusy(false)
    }
  }, [direct, updateSettings, notify])

  if (!settings) return null

  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => void toggle()}
      title={`当前${direct ? '直连，绕过系统代理' : '跟随 macOS 系统代理'}。点击切换（全局生效）`}
    >
      <Icon name="globe" size={13} />
      {direct ? '直连' : '代理'}
    </button>
  )
}
