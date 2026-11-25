import { useCallback, useEffect, useRef, useState } from 'react'
import type { LivePlayTarget } from '@shared/types'
import { isRoomUrl, roomPlatform } from '@shared/liveUrl'
import { ExternalPlayerButton } from '@/components/ExternalPlayerButton'
import { NetworkModeToggle } from '@/components/NetworkModeToggle'
import { Icon } from '@/components/icons'
import { useApp } from '@/store/useApp'
import { createArt } from '@/utils/artplayer'
import { isHls } from '@/utils/media'

interface Props {
  live: LivePlayTarget
}

/**
 * 独立播放器窗口里的直播播放器。
 *
 * 主窗口只负责选频道 / 选线路，实际的拉流、房间号解析和失败换线都在这里做；
 * 和点播一样共用一个播放器窗口，换频道只换内容。
 */
export function LiveWindow({ live }: Props): JSX.Element {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const notify = useApp((s) => s.notify)

  const [lineIndex, setLineIndex] = useState(live.lineIndex)
  const [resolved, setResolved] = useState<{ url: string; referer: string; line?: string } | null>(
    null
  )
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const [retrySeq, setRetrySeq] = useState(0)
  /** 非 .m3u8 地址（短链 / php 接口）探测出来其实是 HLS */
  const [forcedHls, setForcedHls] = useState(false)
  const [formatChecking, setFormatChecking] = useState(false)
  /** 已经替这个频道切过一次代理，避免用户手动切回直连时又被自动切走 */
  const autoProxyRef = useRef('')

  const stageRef = useRef<HTMLDivElement | null>(null)

  const needsProxy = live.group?.includes('需代理') ?? false
  const direct = settings?.directConnection ?? true

  // 主窗口换了频道 / 线路时重置
  useEffect(() => {
    setLineIndex(live.lineIndex)
    setError('')

    // 每个频道只自动切一次代理：用户之后手动切回直连，就尊重他的选择
    const key = `${live.title}|${live.urls[0]?.url ?? ''}`
    const firstTime = autoProxyRef.current !== key
    autoProxyRef.current = key
    if (!needsProxy || !direct || !firstTime) return
    void updateSettings({ directConnection: false })
      .then(() => {
        notify('这个分组需要系统代理，已自动切换；看完可以点右上角「代理」切回直连', 'info')
        setRetrySeq((n) => n + 1)
      })
      .catch((err: Error) => notify(err.message, 'danger'))
  }, [live, needsProxy, direct, updateSettings, notify])

  const rawUrl = live.urls[lineIndex]?.url ?? ''

  /** 换到下一条线路；没有下一条时返回 false */
  const nextLine = useCallback((): boolean => {
    if (lineIndex + 1 < live.urls.length) {
      setLineIndex(lineIndex + 1)
      return true
    }
    return false
  }, [lineIndex, live.urls.length])

  // 房间号线路（huya:// / douyin://）点开时才向平台换地址
  useEffect(() => {
    if (!rawUrl) {
      setResolved(null)
      setResolving(false)
      return
    }
    if (!isRoomUrl(rawUrl)) {
      setResolved({ url: rawUrl, referer: '' })
      setError('')
      setResolving(false)
      return
    }
    let cancelled = false
    setResolving(true)
    setResolved(null)
    setError('')
    void window.api.live
      .resolve(rawUrl)
      .then((r) => {
        if (!cancelled) setResolved(r)
      })
      .catch((err: Error) => {
        if (cancelled) return
        if (nextLine()) {
          notify(`${live.title}：这条线路换不到地址，已试下一条`, 'warn')
        } else {
          setError(err.message)
        }
      })
      .finally(() => {
        if (!cancelled) setResolving(false)
      })
    return () => {
      cancelled = true
    }
  }, [rawUrl, retrySeq, nextLine, notify, live.title])

  // 短链 / .php 接口不一定以 .m3u8 结尾：先读一小段，确认是 HLS 再交给 hls.js
  useEffect(() => {
    const url = resolved?.url
    if (!url || isHls(url)) {
      setForcedHls(false)
      setFormatChecking(false)
      return
    }
    let cancelled = false
    setFormatChecking(true)
    setForcedHls(false)
    void (async () => {
      try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-4095' } })
        const reader = res.body?.getReader()
        if (!reader) return
        const dec = new TextDecoder()
        let text = ''
        let got = 0
        while (got < 2048) {
          const { done, value } = await reader.read()
          if (done) break
          text += dec.decode(value, { stream: true })
          got += value.length
        }
        await reader.cancel().catch(() => undefined)
        if (!cancelled) setForcedHls(text.includes('#EXTM3U'))
      } catch {
        if (!cancelled) setForcedHls(false)
      } finally {
        if (!cancelled) setFormatChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resolved?.url])

  // 换线路 / 换频道时重建播放器：Artplayer 不支持热切换 hls 流
  useEffect(() => {
    const el = stageRef.current
    const url = resolved?.url
    if (!el || !url) return
    // 不是 .m3u8 的地址要等格式探测完，否则会先按普通视频挂一次
    if (!isHls(url) && formatChecking) return
    el.innerHTML = ''
    setError('')
    const art = createArt(el, {
      url,
      referer: resolved?.referer || undefined,
      accent: settings?.accent,
      live: true,
      forceHls: forcedHls
    })
    art.on('video:error', () => {
      if (nextLine()) {
        notify(`${live.title}：这条线路拉不起来，已自动换下一条`, 'warn')
      } else {
        setError('这个频道拉流失败，可能已经下线，回主窗口换一个频道试试。')
      }
    })
    return () => art.destroy(false)
  }, [
    resolved?.url,
    resolved?.referer,
    settings?.accent,
    forcedHls,
    formatChecking,
    nextLine,
    notify,
    live.title
  ])

  const copyUrl = useCallback(async (): Promise<void> => {
    const url = resolved?.url || rawUrl
    if (!url) return
    await navigator.clipboard.writeText(url)
    notify('播放地址已复制', 'success')
  }, [resolved?.url, rawUrl, notify])

  const switchProxy = useCallback(async (): Promise<void> => {
    try {
      await updateSettings({ directConnection: false })
      setRetrySeq((n) => n + 1)
    } catch (err) {
      notify((err as Error).message, 'danger')
    }
  }, [updateSettings, notify])

  const externalUrl = resolved?.url || rawUrl

  return (
    <div className="page page-player">
      <div className="detail-head">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void window.api.player.closeWindow()}
        >
          <Icon name="chevron-left" size={14} /> 关闭
        </button>
        <span className="detail-title-inline" title={live.title}>
          {live.title}
        </span>
        {live.group ? <span className="tag tag-outline">{live.group}</span> : null}
        <span className="grow" />
        <NetworkModeToggle />
        <ExternalPlayerButton url={externalUrl} title={live.title} />
        <button type="button" className="btn btn-sm" disabled={!externalUrl} onClick={() => void copyUrl()}>
          <Icon name="link" size={13} /> 复制地址
        </button>
      </div>

      {needsProxy && direct ? (
        <div className="banner banner-warn">
          这个分组需要走系统代理才能播放。
          <button type="button" className="btn btn-sm" onClick={() => void switchProxy()}>
            切换到代理并重试
          </button>
        </div>
      ) : null}

      <div className="player-stage">
        <div ref={stageRef} className="player-stage-inner" />
        {resolving ? (
          <div className="player-stage-note">
            <span className="spin" />
            正在向{roomPlatform(rawUrl) ?? '平台'}换播放地址…
          </div>
        ) : formatChecking ? (
          <div className="player-stage-note">
            <span className="spin" />
            正在检查线路格式…
          </div>
        ) : null}
      </div>

      {live.urls.length > 1 ? (
        <div className="player-bar">
          <span className="text-3 fs-12">线路</span>
          {live.urls.map((u, i) => (
            <button
              type="button"
              key={u.url}
              className={`chip chip-source${i === lineIndex ? ' active' : ''}`}
              title={u.url}
              onClick={() => {
                setLineIndex(i)
                setError('')
              }}
            >
              {i === lineIndex ? <Icon name="check" size={12} /> : null}
              {u.source}
            </button>
          ))}
          {error ? <span className="text-3 fs-12">当前这条放不了，可以换一条</span> : null}
        </div>
      ) : null}

      {error ? <div className="banner banner-danger">{error}</div> : null}
      {resolved?.line ? (
        <div className="player-note">
          <Icon name="info" size={13} />
          {resolved.line}
        </div>
      ) : null}
    </div>
  )
}
