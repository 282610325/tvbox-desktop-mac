import { readFile } from 'node:fs/promises'
import type { LiveGroupEntry, LiveResult, LiveSourceStat, ParsedConfig } from '@shared/types'
import { isHttpUrl } from '@shared/liveUrl'
import { getSettings } from './settings'
import { fetchText } from './http'
import { getParsed, listSources } from './sources'

/**
 * 电视直播源的解析。
 *
 * 配置里的 lives 只有元信息（name / type / url / epg），真正的内容要另外拉一次。
 * 两种格式都要吃：
 *   · m3u —— 标准的 #EXTM3U / #EXTINF:-1 tvg-name="..." group-title="...",显示名
 *   · txt —— 国内常见的「分组名,#genre#」开头，随后每行「频道名,地址」
 * type 字段只能当提示，实际以内容判断（配置写错了也能用）。
 */

interface RawChannel {
  name: string
  url: string
  group: string
  logo?: string
}

/** 能直接当播放地址的写法（huya:// 与 douyin:// 是房间号，播放前才换成真地址） */
const ADDRESS_RE = /^(https?|rtmp|rtsp|rtp|udp|file|huya|douyin):\/\//i

/**
 * 分组名归一。
 *
 * 公开源里的分组名带装修符，同一类内容在不同源里写法不一样：
 * 「•游戏「赛事」」去掉符号后是「游戏赛事」，跟本地内置的「游戏赛事」要落到同一组，
 * 否则用户会看到两个意思一样的分组。
 */
function stripDecorator(raw: string): string {
  return raw
    .replace(/^[\s•·・*\-—]+/, '')
    .replace(/[「」【】《》[\]（）()]/g, '')
    .trim()
}

const GROUP_ALIAS: Array<{ re: RegExp; name: string }> = [
  { re: /^游戏/, name: '游戏赛事' },
  { re: /^影视/, name: '影视轮播' },
  { re: /^咪咕/, name: '咪咕移动' }
]

function normalizeGroup(raw: string): string {
  const name = stripDecorator(raw)
  if (!name) return '其它'
  if (/^(未分组|其他|其它|默认|default|undefined|null)$/i.test(name)) return '其它'
  for (const alias of GROUP_ALIAS) if (alias.re.test(name)) return alias.name
  return name
}

export function parseM3u(text: string): RawChannel[] {
  const out: RawChannel[] = []
  let pending: { name: string; group: string; logo?: string } | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith('#EXTINF')) {
      // 属性段在冒号之后、第一个逗号之前；逗号之后的才是显示名
      const body = line.slice(line.indexOf(':') + 1)
      const comma = body.lastIndexOf(',')
      const attrs = comma >= 0 ? body.slice(0, comma) : body
      const label = comma >= 0 ? body.slice(comma + 1).trim() : ''
      const pick = (key: string): string => {
        const m = attrs.match(new RegExp(`${key}="([^"]*)"`, 'i'))
        return m ? m[1].trim() : ''
      }
      const name = pick('tvg-name') || label
      pending = {
        name,
        group: pick('group-title'),
        logo: pick('tvg-logo') || undefined
      }
      continue
    }

    if (line.startsWith('#')) continue

    if (pending) {
      out.push({
        name: pending.name || line,
        url: line,
        group: normalizeGroup(pending.group),
        logo: pending.logo
      })
      pending = null
    }
  }
  return out.filter((c) => c.url && c.name)
}

export function parseTxt(text: string): RawChannel[] {
  const out: RawChannel[] = []
  let group = '其它'

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue

    // 「央视频道,#genre#」——#genre# 也可能写成 #genre 或 #类型#
    if (/#genre#?/i.test(line)) {
      group = normalizeGroup(line.split(',')[0])
      continue
    }
    if (line.startsWith('#')) continue

    const idx = line.indexOf(',')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim()
    const url = line.slice(idx + 1).trim()
    // 有些 txt 会把一堆地址塞在同一行，用 # 分隔
    if (!url) continue
    if (ADDRESS_RE.test(url)) {
      out.push({ name, url, group })
      continue
    }
    for (const piece of url.split('#')) {
      const one = piece.trim()
      if (one) out.push({ name, url: one, group })
    }
  }
  return out
}

/** 按内容判断格式：有 #EXTM3U / #EXTINF 就是 m3u，其余当 txt */
export function parseLiveContent(text: string): RawChannel[] {
  return /#EXTM3U|#EXTINF/i.test(text) ? parseM3u(text) : parseTxt(text)
}

async function readSource(source: { url: string }, timeout: number): Promise<string> {
  if (isHttpUrl(source.url)) return fetchText(source.url, { timeout })
  // 本地文件：支持 file:/// 与 Windows 盘符路径
  const path = source.url.replace(/^file:\/\/\/?/i, '')
  return readFile(decodeURIComponent(path), 'utf8')
}

/** 合并同一频道的多条线路：同名频道收成一张卡，卡上列出来自哪些源 */
function mergeChannels(raw: Array<RawChannel & { source: string }>): LiveGroupEntry[] {
  const byName = new Map<string, LiveGroupEntry['channels'][number]>()

  for (const ch of raw) {
    const key = ch.name
    const hit = byName.get(key)
    if (hit) {
      if (!hit.urls.some((u) => u.url === ch.url)) hit.urls.push({ url: ch.url, source: ch.source })
      if (!hit.logo && ch.logo) hit.logo = ch.logo
      continue
    }
    byName.set(key, {
      name: ch.name,
      group: ch.group,
      logo: ch.logo,
      urls: [{ url: ch.url, source: ch.source }]
    })
  }

  const groups = new Map<string, LiveGroupEntry>()
  for (const ch of byName.values()) {
    let g = groups.get(ch.group)
    if (!g) {
      g = { name: ch.group, channels: [] }
      groups.set(ch.group, g)
    }
    g.channels.push(ch)
  }
  for (const g of groups.values()) g.channels.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  // 「其它」永远排最后，其余按频道数从多到少
  return [...groups.values()].sort((a, b) => {
    if (a.name === '其它') return 1
    if (b.name === '其它') return -1
    return b.channels.length - a.channels.length || a.name.localeCompare(b.name, 'zh-CN')
  })
}

/** 从所有启用配置源里收集 lives，并去重 */
export function collectLiveSources(parsed: ParsedConfig[]): Array<{ name: string; url: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string; url: string }> = []
  for (const config of parsed) {
    for (const live of config.lives) {
      const url = (live.url ?? '').trim()
      if (!url || seen.has(url)) continue
      seen.add(url)
      out.push({ name: live.name || url, url })
    }
  }
  return out
}

/**
 * 内置频道：主播房间 + 实测可用的香港 / 澳门 / 台湾 / 海外频道。
 *
 * 房间号（huya://）要现解析（见 streamResolve.ts）。
 * 其余频道是 2026-11-25/26 从 iptv-org、atsushi444、imDazui、kimwang1978 等公开源里
 * 逐条实测过的。**能解码不算有效**：不少源会返回一段 NO SIGNAL 占位视频或循环播旧录像，
 * readyState 一样能到 4。所以判定标准是三层：
 *   1. master → media 清单能拉到，取最后一片确认首字节是 TS/fMP4；
 *   2. 分片在持续推进（隔 20 秒再看 MEDIA-SEQUENCE 有没有涨）；
 *   3. 抓一帧画面确认是真实播出的节目（有台标、跑马灯或当前时间）。
 * 按地区分 4 组：
 * - 香港 / 澳门 / 台湾 / 海外：直连可播；
 * - 带「· 需代理」的组：必须走系统代理（本机 127.0.0.1:7892 实测通过），
 *   播放器窗口会自动切到代理并重试。
 * 台湾组已剔除：epg.pw 那批（全部指向 nosignal_h264）、37.27.111.214 的两路
 * （循环播放 2026-01/02 的旧录像）、111.0.115.129 中天（分片不再推进）、
 * 大立电视（连不上）、38.64.72.148 的 TVBS-Asia（拉不出数据）。
 *
 * 写死在代码里跟着应用走：换订阅、清空配置源都不会丢。
 * 分组名「游戏赛事」会被 normalizeGroup 的别名规则并到公开源的「•游戏「赛事」」里。
 */
export const BUILTIN_LIVE = `游戏赛事,#genre#
danking直播,huya://10188
香港,#genre#
有线新闻,http://cm61-10-2-143.hkcable.com.hk/live_freedirect/freehd209_h.live/playlist.m3u8
环球电视,http://utv1.hqtvzb.com:9999/hls/world.m3u8
Pet Club TV,https://petclub-samsungaus.amagi.tv/playlist.m3u8
香港 · 需代理,#genre#
翡翠台,https://cdn6.cc.cd/163189/fct
翡翠台,http://r.jdshipin.com/qClQf
翡翠台,http://php.jdshipin.com:8880/TVOD/iptv.php?id=j1
明珠台,https://cdn6.cc.cd/163189/mzt
明珠台,http://r.jdshipin.com/GeWKr?id=mzt720
TVB 无线新闻,https://h5cdn3.kylintv.tv/live/tvbnews_iphone.m3u8
TVB 无线新闻,http://r.jdshipin.com/CkuBd
TVB Plus,http://r.jdshipin.com/Nr5jq
TVB星河,http://r.jdshipin.com/sXuuD
华丽翡翠台,http://r.jdshipin.com/thuYX
凤凰中文,https://cdn6.cc.cd/163189/fhzw
凤凰中文,http://r.jdshipin.com/cCCzW
凤凰资讯,https://cdn6.cc.cd/163189/fhzx
凤凰资讯,http://r.jdshipin.com/0Rp07
凤凰香港,https://cdn6.cc.cd/163189/fhhk
凤凰香港,http://r.jdshipin.com/yDoTN
HOY TV,http://r.jdshipin.com/sFw4S
RTHK TV 31,http://php.jdshipin.com:8880/TVOD/iptv.php?id=rthk31
RTHK TV 32,http://php.jdshipin.com:8880/TVOD/iptv.php?id=rthk32
香港国际财经台,http://uc6.i-cable.com/live_freedirect/opentvhd002_h.live/playlist.m3u8
TVB 娱乐新闻,http://php.jdshipin.com/TVOD/iptv.php?id=tvbylxw
美亚 C+,http://ottproxy2.ist.ooo/livehls/MOB-U1-NO/03.m3u8
澳门 · 需代理,#genre#
澳门莲花,https://cdn6.cc.cd/163189/amlh
澳门莲花,https://cdn.qd.je/163189/amlh
澳视澳门,http://r.jdshipin.com/n2YZI
澳视卫星,http://r.jdshipin.com/QFhCq
澳门卫视,http://php.jdshipin.com:8880/TVOD/iptv.php?id=as
台湾,#genre#
TVBS 新闻台,https://d2jc41c1shgcol.cloudfront.net/live/tvbsnewsqt/playlist.m3u8
TVBS 新闻台,http://38.64.72.148/hls/modn/list/4027/playlist.m3u8
台视新闻,http://38.64.72.148/hls/modn/list/4013/playlist.m3u8
民视新闻,http://38.64.72.148/hls/modn/list/4012/playlist.m3u8
中视,http://38.64.72.148/hls/modn/list/2003/playlist.m3u8
中视新闻,http://50.7.233.114:8278/zhongshinews_twn/playlist.m3u8
华视新闻,http://38.64.72.148/hls/modn/list/4025/playlist.m3u8
东森超视,http://38.64.72.148/hls/modn/list/2013/chunklist1.m3u8
东森美洲新闻,http://38.64.72.148/hls/modn/list/2016/playlist.m3u8
非凡新闻,http://50.7.233.114:8278/feifannews_twn/playlist.m3u8
世新综合,http://61.58.60.230:9319/live/49.m3u8
国会频道1,http://61.58.60.230:9319/live/123.m3u8
国会频道2,http://61.58.60.230:9319/live/124.m3u8
人间卫视,http://61.216.67.119:1935/bltvhd/bltv1/chunklist_w1266569526.m3u8
美丽人生卫视,https://5ddce30eb4b55.streamlock.net/bltvhd/bltv1/playlist.m3u8
唯心电视,https://mobile.ccdntech.com/transcoder/_definst_/vod164_Live/live/chunklist_w1177047531.m3u8
TTV News,https://live.wcetv.com/hls/master-ttvnews.m3u8
DAAI TV,https://pull.daaiplus.com/live-DAAIPLUS/live-DAAIPLUS_HD.m3u8
Hakka TV,https://h5cul1yar48um3t.wcetv.com/hls/hakkatv.m3u8
Good TV,https://live.streamingfast.net/osmflivech1.m3u8
Good 2,https://live.streamingfast.net/osmflivech2.m3u8
海外,#genre#
CNN,https://tvsen6.aynaott.com/cnn/index.m3u8
CNN en Espanol,https://amg00803-cnnfast-amg00803c3-lg-es-5477.playouts.now.amagi.tv/playlist.m3u8
BBC Earth US,https://amg00793-amg00793c6-vizio-us-2670.playouts.now.amagi.tv/playlist/amg00793-bbcstudios-bbcearthaall-vizious/playlist.m3u8
BBC Drama US,https://linear-938.frequency.stream/mt/vizio/938/hls/master/playlist.m3u8
BBC One,https://r.eu.cdn-redge.media/livehls/oeu/mt/live/bbc_one/live.livx/playlist.m3u8
MBC America,https://cdn-us-east-prod-ingest-infra-dacast-com.akamaized.net/624ff8f9-db18-da92-4d42-896fa2ff3eb3/source/index.m3u8
MBC Drama USA,https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-drama-usa/ea2f5db904aff224b7066e59c7f585a2/index.m3u8
MBC 3 USA,https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-3-usa/5d58265a862a476dc7f97694addb5ded/index.m3u8
MBC Masr USA,https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-masr-usa/cd8d40acdab28aac0582faa3bd3983f1/index.m3u8
KBSV 23.1,http://66.242.170.53/hls/live/temp/index.m3u8
Fox KBSI,https://live.field59.com/kbsi/kbsi1/playlist.m3u8
Mega TV,https://mdstrm.com/live-stream-playlist/67ed74e8af482ba71d47fd7b.m3u8
Arirang TV,http://amdlive-ch01.ctnd.com.edgesuite.net/arirang_1ch/smil:arirang_1ch.smil/playlist.m3u8
Weathernews,https://rch01e-alive-hls.akamaized.net/38fb45b25cdb05a1/out/v1/4e907bfabc684a1dae10df8431a84d21/index.m3u8
CJ OnStyle,https://live-ch1.cjonstyle.net/cjmalllive/stream2/playlist.m3u8
CNA,https://live1.mediadesk.al/cnatvlive.m3u8
CGNTV 日本,https://d2p4mrcwl6ly4.cloudfront.net/out/v1/8d50f69fdbbf411a8d302743e4263716/CGNWebLiveJP.m3u8
CJ OnStyle+,https://live-ch2.cjonstyle.net/cjosplus/live2/playlist.m3u8
GCN 韩国,http://liveko24-manminglobal3.ktcdn.co.kr/liveko24/gcnko_1300k.stream/playlist.m3u8
BBS TV,http://bbstv.clouducs.com:1935/bbstv-live/livestream/playlist.m3u8
BTN TV,https://btn.nowcdn.co.kr/btn/btnlive2m/playlist.m3u8
Gugak TV,https://mgugaklive.nowcdn.co.kr/gugakvideo/gugakvideo.stream/playlist.m3u8
Arirang TV HD,https://freem3u.xyz/api/live/play.m3u8?vid=111
CGNTV 中文,https://d3e05csss9c272.cloudfront.net/out/v1/f0bf71c57581470fb9379f603e8f5d83/CGNWebLiveCN.m3u8
海外 · 需代理,#genre#
MTV Japan,http://103.255.250.188:5002/cs18.m3u8?channel=zhongying&gid=cs18&token=guoziyun
Cartoon Network Japan,http://103.255.250.188:5002/cs25.m3u8?channel=zhongying&gid=cs25&token=guoziyun
Disney Channel Japan,http://103.255.250.188:5002/bs24.m3u8?channel=zhongying&gid=bs24&token=guoziyun
EBS 1TV,https://ebsonair.ebs.co.kr/ebs1familypc/familypc1m/playlist.m3u8
EBS Kids,https://ebsonair.ebs.co.kr/ebsufamilypc/familypc1m/playlist.m3u8
Sakuranbo TV,https://tv-stream-test.daydreamer-json.cc/stream/bd2dd29080c36c9b01338d329156febe/master.m3u8
TV-U Yamagata,https://tv-stream-test.daydreamer-json.cc/stream/1668b5a43560598b385ccf33fd2d5f43/master.m3u8
YTS 山形电视台,https://tv-stream-test.daydreamer-json.cc/stream/407fd00ebd2a059c9cd1ea3fa7156097/master.m3u8
Autentic History,https://9e754fa707344ccca6d84955c8fcaf36.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AutenticHistory/playlist.m3u8
Autentic Travel,https://cb0c87cc605942ff9766a4e6744bbadc.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AutenticTravel/playlist.m3u8
Adventure Earth,https://a57e9c69976649b582a8d7604c00e69a.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AdventureEarth/playlist.m3u8
DW 英语,https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8
EBS 2TV,https://ebsonair.ebs.co.kr/ebs2familypc/familypc1m/playlist.m3u8
EBS English,https://ebsonair.ebs.co.kr/plus3familypc/familypc1m/playlist.m3u8
EBS Plus 1,https://ebsonair.ebs.co.kr/plus1familypc/familypc1m/playlist.m3u8
NTD TV,https://live.ntdtv.com/aplive200/playlist.m3u8
Supreme Master TV,https://lbs-us1.suprememastertv.com/720p.m3u8
`

/** 内置频道始终算一个直播源 */
const BUILTIN_SOURCE = { name: '内置自定义频道', url: 'builtin://custom' }

let cache: { at: number; result: LiveResult } | null = null
const TTL = 10 * 60 * 1000
/** 换一次配置源就 +1，用来认出「还在飞的那次加载」属于上一套源 */
let generation = 0

export function clearLiveCache(): void {
  cache = null
  // 光清 cache 不够：很可能正好有一次 loadLive 还在飞，它跑完会把**上一个源**
  // 的结果写回 cache。表现成「同步完新订阅再进电视直播，看到的还是旧分组」，
  // 而且只在换源和首次加载撞上时才复现（自检第一次跑必挂就是这么来的）。
  generation++
}

export async function loadLive(force = false): Promise<LiveResult> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.result

  const gen = generation

  const list = await listSources()
  const parsed = list
    .filter((s) => s.enabled)
    .map((s) => getParsed(s.id))
    .filter((p): p is ParsedConfig => Boolean(p))
  const sources = collectLiveSources(parsed)

  const settings = await getSettings()
  const stats: LiveSourceStat[] = []
  const all: Array<RawChannel & { source: string }> = []

  // 内置频道先塞进去，这样即使一个配置源都没有，电视直播页也不是空的
  const builtin = parseLiveContent(BUILTIN_LIVE)
  for (const ch of builtin) all.push({ ...ch, source: BUILTIN_SOURCE.name })
  stats.push({ ...BUILTIN_SOURCE, channels: builtin.length })

  await Promise.all(
    sources.map(async (source) => {
      try {
        const text = await readSource(source, settings.timeout)
        const channels = parseLiveContent(text)
        if (!channels.length) {
          stats.push({ ...source, channels: 0, error: '没有解析出任何频道，格式可能不兼容' })
          return
        }
        for (const ch of channels) all.push({ ...ch, source: source.name })
        stats.push({ ...source, channels: channels.length })
      } catch (err) {
        stats.push({ ...source, channels: 0, error: (err as Error).message })
      }
    })
  )

  const groups = mergeChannels(all)
  const result: LiveResult = { groups, total: all.length, sources: stats }
  // 期间换过配置源就说明这份结果已经过期了，别写回缓存 —— 照旧把本次结果
  // 返回给调用方（它要的就是当下这一次），但不让它污染下一次。
  if (gen === generation) cache = { at: Date.now(), result }
  return result
}
