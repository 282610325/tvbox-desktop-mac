import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ConfigSource, SourcePresetInfo } from '@shared/types'
import { addSource, listSources, syncSource } from './sources'
import { readStore, writeStore } from './store'

/** 记住「内置订阅已经送过了」，避免用户删光后重启又冒出来 */
const BUNDLED_FLAG = 'bundled-sources'

/**
 * 内置推荐订阅。
 *
 * 打包版走 `ensureBundledSources()`：装完直接就是「带源」状态，打开就能搜。
 * 设置页里仍然把它列出来，用户可以随时删掉，删干净了也不会自己长回来。
 *
 * 点「添加」时会把配置内容落到 <数据目录>/presets/<id>.json，
 * 而不是引用仓库里的 samples/，这样仓库删了、应用换台机器也能继续用。
 */
export interface SourcePreset {
  id: string
  name: string
  desc: string
  /** 给界面显示用：这个订阅里有几个站点 */
  siteCount: number
  /** 给界面显示用：这个订阅里有几个直播源 */
  liveCount: number
  /** 远程订阅：添加时直接登记这个地址，内容随站点更新 */
  url?: string
  /** 本地快照：添加时把内容写到数据目录，不依赖原站点 */
  config?: {
    format: string
    name: string
    note: string
    sites: Record<string, unknown>[]
    lives: Record<string, unknown>[]
    tvboxDesktop?: Record<string, unknown>
  }
}

const PUBLIC_CMS: SourcePreset = {
  id: 'public-cms',
  name: '公开可用源（苹果CMS 采集站）',
  desc: '实测存活的 12 个公开采集接口 + 1 个公开直播源（2026-11-20 复测）。这类源随时可能失效，失效后在「影视源」「电视直播」页一看便知。',
  siteCount: 12,
  liveCount: 1,
  config: {
    format: 'tvbox-desktop/1',
    name: '公开可用源（苹果CMS 采集站）',
    note: '实测存活的公开采集接口，全部是标准苹果CMS v10 的 /api.php/provide/vod。判断标准：列表接口有数据、带 wd 的搜索有结果、详情能解析出剧集地址、至少一条线路能拉到 m3u8。接口随时可能失效，失效后在「影视源」页点「测试」即可看出来。',
    sites: [
      {
        key: 'ffzy',
        name: '非凡资源',
        type: 'cms',
        api: 'https://api.ffzyapi.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'lzi',
        name: '量子资源',
        type: 'cms',
        api: 'https://cj.lziapi.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'dyttzy',
        name: '电影天堂资源',
        type: 'cms',
        api: 'https://caiji.dyttzyapi.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'guangsu',
        name: '光速资源',
        type: 'cms',
        api: 'https://api.guangsuapi.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'subo',
        name: '素博资源',
        type: 'cms',
        api: 'https://subocaiji.com/api.php/provide/vod',
        searchable: 1
      },
      // 下面 7 个来自 GitHub 公开 TVBox 配置的候选池，2026-11-20 逐个验证过：
      // 搜索「庆余年」有结果、详情有剧集、至少一条线路的 m3u8 能直接 200 拉取。
      {
        key: 'hongniu',
        name: '红牛资源',
        type: 'cms',
        api: 'https://www.hongniuzy2.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'hhzy',
        name: '豪华资源',
        type: 'cms',
        api: 'https://hhzyapi.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'wujin',
        name: '无尽资源',
        type: 'cms',
        api: 'https://api.wujinapi.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'modu',
        name: '魔都资源',
        type: 'cms',
        api: 'https://www.mdzyapi.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'zy360',
        name: '360资源',
        type: 'cms',
        api: 'https://360zy.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'dyttzyw',
        name: '电影天堂（新）',
        type: 'cms',
        api: 'http://dyttzyw.com/api.php/provide/vod',
        searchable: 1
      },
      {
        key: 'taohua',
        name: '桃花资源',
        type: 'cms',
        api: 'https://thzy1.me/api.php/provide/vod',
        searchable: 1
      }
    ],
    // 只留 IPv4 那一条。实测 Gather.m3u 的 123 条线路里 108 条（88%）拉不起来，
    // 而且它和 iptv4.txt 一个重名的频道都没有（补不上线路），留着只会让频道列表
    // 里多出一堆点开就失败的卡。
    lives: [
      {
        name: '公开直播源·IPv4（txt）',
        type: 0,
        url: 'https://live.zbds.top/tv/iptv4.txt'
      }
    ],
    // 首页内容位。写在这里的行优先于「每个源一条最近更新」的默认行为，
    // 让首启就有几行带分类的内容，而不是五条一模一样的「最近更新」。
    // typeId 用的是苹果CMS v10 的默认分类 id（6=动作片、13=国产剧、42=日本动漫），
    // 这五条都在真实源上逐条验证过 20 条有内容。
    tvboxDesktop: {
      home: {
        sections: [
          { title: '电影 · 最近更新', site: 'dyttzy' },
          { title: '电影 · 动作片', site: 'ffzy', typeId: 6 },
          { title: '电视剧 · 国产剧', site: 'lzi', typeId: 13 },
          { title: '动漫 · 日本', site: 'guangsu', typeId: 42 },
          { title: '综艺 · 最近更新', site: 'subo' }
        ]
      }
    }
  }
}

/**
 * 饭太硬导航（https://www.xn--sss604efuw.net/）里「王二小 / 牛二」接口的直播部分。
 *
 * 该站点给的订阅全部是 Spider 配置（站点 api 为 csp_*，依赖 jar），桌面端跑不了；
 * 但配置里的直播源是普通 m3u / php 接口，桌面端可以直接用。
 * 2026-11-20 实测两条都能拉到 m3u（央视频道 + 地方台）。
 */
const FANTAIYING_LIVE: SourcePreset = {
  id: 'fantaiying-live',
  name: '饭太硬导航 · 直播源（2 路）',
  desc: '从饭太硬导航的「王二小」接口里拆出的 2 条直播源，实测可拉取。该站点的点播站点依赖 Spider，桌面端无法播放，所以这里只保留能用的直播部分。',
  siteCount: 0,
  liveCount: 2,
  config: {
    format: 'tvbox-desktop/1',
    name: '饭太硬导航 · 直播源',
    note: '来源：https://www.xn--sss604efuw.net/「王二小」接口里的 lives 字段。点播站点是 csp_* Spider，桌面端不支持，故只拆出直播。',
    sites: [],
    lives: [
      {
        name: 'Kimentanm（m3u）',
        type: 0,
        url: 'https://down.nigx.cn/raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u'
      },
      {
        name: '综合直播（iptv.php）',
        type: 0,
        url: 'http://193.123.86.190:14888/TV/iptv.php'
      }
    ]
  }
}

/**
 * 饭太硬导航的原始在线订阅。加上之后能拿到 100 个站点、2 个直播源、4 个解析接口，
 * 但站点 api 全是 csp_*（Spider），桌面端会统一标成「不支持」——保留它是为了
 * 让用户能看到这个源的完整内容，以及随时享受直播 / 解析部分的更新。
 */
const FANTAIYING_WANGERXIAO: SourcePreset = {
  id: 'fantaiying-wangerxiao',
  name: '饭太硬导航 · 王二小（在线订阅）',
  desc: '饭太硬导航页里的王二小/牛二接口，实测能拉取。注意：其中 100 个站点都依赖 Spider（csp_*），macOS 桌面端无法播放；只有直播源与解析接口可用。',
  siteCount: 100,
  liveCount: 2,
  url: 'https://9280.kstore.vip/aiwex.json'
}

export const SOURCE_PRESETS: SourcePreset[] = [PUBLIC_CMS, FANTAIYING_LIVE, FANTAIYING_WANGERXIAO]

export function listPresets(): SourcePresetInfo[] {
  return SOURCE_PRESETS.map(({ id, name, desc, siteCount, liveCount }) => ({
    id,
    name,
    desc,
    siteCount,
    liveCount
  }))
}

/** 把预设注册成配置源：远程订阅直接登记地址，本地快照先落到数据目录 */
export async function addPreset(id: string): Promise<ConfigSource> {
  const preset = SOURCE_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error('没有这个内置订阅')

  const existing = await listSources()

  if (preset.url) {
    if (existing.some((s) => s.url === preset.url)) throw new Error('这个内置订阅已经添加过了')
    return addSource({ name: preset.name, url: preset.url, kind: 'url' })
  }

  if (!preset.config) throw new Error('这个内置订阅没有可用的配置内容')

  const dir = join(app.getPath('userData'), 'presets')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${preset.id}.json`)
  writeFileSync(file, JSON.stringify(preset.config, null, 2), 'utf8')

  const already = existing.find((s) => s.url === file)
  if (already) throw new Error('这个内置订阅已经添加过了')
  return addSource({ name: preset.name, url: file, kind: 'file' })
}

/** 首启自动装的订阅：公开 CMS 站 + 饭太硬导航拆出的直播源 */
const BUNDLED_PRESET_IDS = ['public-cms', 'fantaiying-live']

/**
 * 首启把内置订阅装好，让打包版「装完即用」。
 *
 * 只在一个配置源都没有的时候执行 —— 用户自己删光了就不该再冒出来。
 * 装上之后立刻同步一次，这样首屏的「影视源」和「电视直播」就有数据，
 * 不用等用户手动点「同步配置」。
 *
 * 只带**订阅源**，不带设置：API Key、外部播放器路径、收藏与观看历史
 * 都属于使用者的个人数据，绝不能跟着安装包发出去。
 *
 * 用一个标志位记住「已经送过了」：用户之后自己把源删光、重启，不会又长回来。
 */
export async function ensureBundledSources(): Promise<boolean> {
  if (SOURCE_PRESETS.length === 0) return false
  if (await readStore<boolean>(BUNDLED_FLAG, false)) return false
  const existing = await listSources()
  if (existing.length) {
    await writeStore(BUNDLED_FLAG, true)
    return false
  }
  let added = false
  for (const id of BUNDLED_PRESET_IDS) {
    try {
      const source = await addPreset(id)
      await syncSource(source.id)
      added = true
    } catch (err) {
      // 单个订阅失败不影响另一个，也不拦住应用启动
      console.error(`[presets] 首启写入内置订阅 ${id} 失败：`, err)
    }
  }
  await writeStore(BUNDLED_FLAG, true)
  return added
}

