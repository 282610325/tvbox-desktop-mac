import { useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { TopBar } from '@/components/TopBar'
import { Toasts } from '@/components/Toasts'
import { EmptyState } from '@/components/EmptyState'
import { Icon } from '@/components/icons'
import { useApp } from '@/store/useApp'
import { isPlayerWindow } from '@/utils/playerWindow'
import { Home } from '@/pages/Home'
import { Search } from '@/pages/Search'
import { Detail } from '@/pages/Detail'
import { Player } from '@/pages/Player'
import { Live } from '@/pages/Live'
import { Library } from '@/pages/Library'
import { Sites } from '@/pages/Sites'
import { Settings } from '@/pages/Settings'
import '@/styles/pages.css'

export default function App(): JSX.Element {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const sources = useApp((s) => s.sources)

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-logo">T</div>
        <div className="boot-text">正在加载本地配置…</div>
      </div>
    )
  }

  // 独立的播放器窗口：只渲染播放页，没有侧栏和顶栏，主窗口可以继续浏览
  if (isPlayerWindow) {
    return (
      <>
        <div className="player-window">
          <PlayerWindowRoutes />
        </div>
        <Toasts />
      </>
    )
  }

  const noSources = sources.length === 0

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <main className="app-content">
          <Routes>
            <Route path="/" element={noSources ? <FirstRun /> : <Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/detail/:siteKey/:vodId" element={<Detail />} />
            <Route path="/play/:siteKey/:vodId/:lineIndex/:epIndex" element={<PlayRedirect />} />
            <Route path="/live" element={<Live />} />
            <Route path="/library" element={<Library />} />
            <Route path="/sites" element={<Sites />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={noSources ? <FirstRun /> : <Home />} />
          </Routes>
        </main>
      </div>
      <Toasts />
    </div>
  )
}

/** 播放器窗口里的路由：主窗口发来新目标时，直接在当前窗口换片 */
function PlayerWindowRoutes(): JSX.Element {
  const navigate = useNavigate()

  useEffect(() => {
    return window.api.player.onNavigate((t) => {
      navigate(
        `/play/${encodeURIComponent(t.siteKey)}/${encodeURIComponent(t.vodId)}/${t.lineIndex}/${t.epIndex}`
      )
    })
  }, [navigate])

  return (
    <Routes>
      <Route path="/play/:siteKey/:vodId/:lineIndex/:epIndex" element={<Player />} />
      <Route
        path="*"
        element={
          <div className="page">
            <EmptyState
              icon={<Icon name="screen-off" size={26} />}
              title="没有正在播放的视频"
              desc="回到主窗口点一个视频，就会在这里开始播放。"
            />
          </div>
        }
      />
    </Routes>
  )
}

/**
 * 主窗口里的 /play 不再自己播：打开（或复用）播放器窗口，
 * 然后退回进入播放页之前的那一页，用户可以继续找别的视频。
 */
function PlayRedirect(): JSX.Element {
  const params = useParams()
  const navigate = useNavigate()
  const notify = useApp((s) => s.notify)
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    const siteKey = params.siteKey ?? ''
    const vodId = params.vodId ?? ''
    if (!siteKey || !vodId) {
      navigate('/', { replace: true })
      return
    }
    void window.api.player
      .openWindow({
        siteKey,
        vodId,
        lineIndex: Number(params.lineIndex ?? 0) || 0,
        epIndex: Number(params.epIndex ?? 0) || 0
      })
      .catch((err: Error) => notify(`打开播放器失败：${err.message}`, 'danger'))
    if (window.history.length > 1) navigate(-1)
    else navigate('/', { replace: true })
  }, [navigate, notify, params.siteKey, params.vodId, params.lineIndex, params.epIndex])

  return (
    <div className="boot">
      <div className="boot-text">正在打开播放器窗口…</div>
    </div>
  )
}

/** 首次启动：还没有任何配置源，直接引导到配置页而不是给一个空壳 */
function FirstRun(): JSX.Element {
  const presets = useApp((s) => s.presets)
  const addPreset = useApp((s) => s.addPreset)
  const [busy, setBusy] = useState('')

  return (
    <div className="page">
      <div className="first-run">
        <div className="first-run-logo">T</div>
        <h1 className="first-run-title">欢迎使用 TVBox Desktop</h1>
        <p className="first-run-desc">
          这是一个纯白极简的 macOS 影视聚合客户端。软件本身不提供任何内容，
          请先添加一个 JSON 配置源（订阅地址或本地配置文件），之后即可聚合搜索、多线路选集播放。
        </p>
        <div className="first-run-actions">
          <NavLink to="/settings" className="btn btn-primary">
            前往添加配置源
          </NavLink>
          <NavLink to="/sites" className="btn">
            查看影视源
          </NavLink>
        </div>

        {presets.length ? (
          <div className="first-run-presets">
            <div className="first-run-presets-title">或者一键添加内置推荐订阅</div>
            {presets.map((preset) => (
              <div className="preset-row" key={preset.id}>
                <div className="grow">
                  <div className="list-row-title">{preset.name}</div>
                  <div className="list-row-sub">{preset.desc}</div>
                </div>
                <span className="tag tag-outline">
                  {preset.siteCount} 个站点
                  {preset.liveCount ? ` · ${preset.liveCount} 个直播源` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy === preset.id}
                  onClick={async () => {
                    setBusy(preset.id)
                    await addPreset(preset.id)
                    setBusy('')
                  }}
                >
                  {busy === preset.id ? <span className="spin" /> : <Icon name="plus" size={13} />}
                  添加
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="first-run-steps">
          <div className="first-run-step">
            <span className="first-run-num">1</span>
            <div>
              <b>添加配置源</b>
              <div className="text-3 fs-12">填入订阅 URL，或选择一个本地 .json 配置文件</div>
            </div>
          </div>
          <div className="first-run-step">
            <span className="first-run-num">2</span>
            <div>
              <b>启用影视源</b>
              <div className="text-3 fs-12">在「影视源」页测试连通性，关掉速度慢或失效的站点</div>
            </div>
          </div>
          <div className="first-run-step">
            <span className="first-run-num">3</span>
            <div>
              <b>搜索并播放</b>
              <div className="text-3 fs-12">顶部搜索框回车即可同时查询全部站点</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
