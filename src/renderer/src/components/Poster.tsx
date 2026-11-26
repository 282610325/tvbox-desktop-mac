import { useEffect, useState } from 'react'

interface PosterProps {
  src?: string
  name: string
  className?: string
  /**
   * 立即加载。默认 lazy：海报墙一屏几十张，不懒加载会同时打几十个请求。
   * 演员作品墙这类「首屏就要看到、且数量有限」的地方传 true。
   */
  eager?: boolean
}

/**
 * 海报图。第三方站点的图床经常挂，必须给失败兜底，
 * 否则海报墙会出现一片破图。
 */
export function Poster({ src, name, className = '', eager = false }: PosterProps): JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const usable = Boolean(src) && !failed

  return (
    <div className={`poster ${className}`}>
      {usable ? (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="poster-fallback">{(name || '?').trim().slice(0, 1)}</span>
      )}
    </div>
  )
}
