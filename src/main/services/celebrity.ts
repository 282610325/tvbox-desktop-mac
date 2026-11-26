import type { Celebrity, CelebrityWork } from '@shared/types'
import { fetchJson } from './http'

/**
 * 演员名 → 作品列表。
 *
 * 采集站的搜索只匹配片名（实测 9 个苹果CMS 站用演员名都是 0 结果），所以
 * 「搜索框输演员名」必须先把名字翻译成作品名。这里用影人库做这一步，
 * 结果只出现在搜索页的作品墙里，界面上不出现数据源的身份信息。
 *
 * 两个接口都必须带移动端 UA + m.douban.com 的 Referer，否则拿不到 JSON。
 */

const SUGGEST = 'https://movie.douban.com/j/subject_suggest'
const REXXAR = 'https://m.douban.com/rexxar/api/v2/celebrity'
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

/** 一次带回的作品数。接口单次最多只给 50 条，total 可能更大 */
const WORK_COUNT = 50
/** 展开全部时最多拉这么多部，防止个别影人几百部时连发十几个请求 */
const WORK_MAX = 300

interface SuggestItem {
  id?: string
  title?: string
  sub_title?: string
  img?: string
  type?: string
}

interface WorksPayload {
  total?: number
  works?: Array<{
    roles?: string[]
    work?: {
      id?: string | number
      title?: string
      year?: string
      type?: string
      rating?: { value?: number }
      pic?: { normal?: string; large?: string }
    }
  }>
}

/** 名字 → 影人 id。优先精确同名的条目，否则取第一条影人结果 */
async function findCelebrity(name: string): Promise<{
  id: string
  name: string
  enName: string
  avatar: string
} | null> {
  const list = await fetchJson<SuggestItem[]>(`${SUGGEST}?q=${encodeURIComponent(name)}`, {
    header: { 'User-Agent': UA, Referer: 'https://movie.douban.com/' },
    timeout: 10
  })
  const rows = Array.isArray(list) ? list.filter((x) => x.type === 'celebrity' && x.id) : []
  if (!rows.length) return null

  const exact = rows.find((x) => String(x.title ?? '').trim() === name)
  const pick = exact ?? rows[0]
  return {
    id: String(pick.id),
    name: String(pick.title ?? name),
    enName: String(pick.sub_title ?? ''),
    // suggest 给的是小图，换成大图（同一张，路径里的 m 换成 l）
    avatar: String(pick.img ?? '').replace('/personage/m/', '/personage/l/')
  }
}

function toWork(item: NonNullable<WorksPayload['works']>[number]): CelebrityWork | null {
  const w = item.work
  const title = String(w?.title ?? '').trim()
  if (!title) return null
  const rating = Number(w?.rating?.value ?? 0)
  return {
    title,
    year: String(w?.year ?? ''),
    type: String(w?.type ?? ''),
    rating: rating > 0 ? rating.toFixed(1) : '',
    pic: String(w?.pic?.normal ?? w?.pic?.large ?? ''),
    roles: Array.isArray(item.roles) ? item.roles.map((r) => String(r)).filter(Boolean) : []
  }
}

/** 只是露脸当嘉宾/选手的综艺，不算「作品」 */
function isGuestShow(work: CelebrityWork): boolean {
  return work.roles.some((r) => /自己|嘉宾|选手|观察员/.test(r))
}

/**
 * 接口默认按热度排，综艺常挤在前面（「演员 - 自己」那种）。用户点演员想看的是
 * 他演的片子，所以：先排除只是露脸的综艺，再按年份倒序，新作先看到。
 *
 * 豆瓣用 2030 这类年份表示「未定档」，直接按数字倒序会把一堆还没拍的条目顶到
 * 最前面，所以超出明年的年份一律当未知，沉到最后。
 */
function sortWorks(works: CelebrityWork[]): void {
  const limit = new Date().getFullYear() + 1
  const yearOf = (w: CelebrityWork): number => {
    const year = Number(w.year) || 0
    return year > limit ? 0 : year
  }
  works.sort((a, b) => {
    const guest = Number(isGuestShow(a)) - Number(isGuestShow(b))
    if (guest !== 0) return guest
    const ya = yearOf(a)
    const yb = yearOf(b)
    if (ya !== yb) return yb - ya
    return Number(b.rating || 0) - Number(a.rating || 0)
  })
}

function worksUrl(id: string, start: number): string {
  return `${REXXAR}/${id}/works?start=${start}&count=${WORK_COUNT}`
}

async function fetchWorksPage(id: string, start: number): Promise<WorksPayload> {
  return fetchJson<WorksPayload>(worksUrl(id, start), {
    header: { 'User-Agent': UA, Referer: 'https://m.douban.com/' },
    timeout: 12
  })
}

/**
 * 查一个人的作品。查不到（不是人名、接口挂了、网络不通）一律返回 null，
 * 搜索页按「普通关键词」处理，不弹错误——用户输入片名时本来就走这条路。
 *
 * 首屏只拉一页（接口单次上限 50 条），点「展开全部」时再由 listCelebrityWorks 补齐。
 */
export async function lookupCelebrity(name: string): Promise<Celebrity | null> {
  const keyword = (name ?? '').trim()
  if (!keyword || keyword.length > 20) return null

  try {
    const hit = await findCelebrity(keyword)
    if (!hit) return null

    const payload = await fetchWorksPage(hit.id, 0)
    const works = (payload.works ?? [])
      .map(toWork)
      .filter((w): w is CelebrityWork => Boolean(w))

    if (!works.length) return null
    sortWorks(works)
    return {
      ...hit,
      total: Number(payload.total ?? works.length),
      works
    }
  } catch {
    return null
  }
}

/**
 * 补齐某人的全部作品。接口一页最多 50 条，所以按 start 翻页直到 total。
 * 点击「展开全部」时才会走到这里，首屏不付这个代价。
 *
 * WORK_MAX 是保险丝：个别影人有几百部，全拉等于连发十几个请求，
 * 超出部分宁可不显示，也不要让搜索页长时间转圈。
 */
export async function listCelebrityWorks(id: string): Promise<CelebrityWork[]> {
  const key = (id ?? '').trim()
  if (!key || !/^\d+$/.test(key)) return []

  const all: CelebrityWork[] = []
  const seen = new Set<string>()
  let start = 0

  try {
    for (;;) {
      const payload = await fetchWorksPage(key, start)
      const page = (payload.works ?? [])
        .map(toWork)
        .filter((w): w is CelebrityWork => Boolean(w))
      for (const work of page) {
        // 同名同年的重复条目（不同条目 id 指向同一部片）只留一条
        const dedupe = `${work.title}::${work.year}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        all.push(work)
      }
      const total = Number(payload.total ?? 0)
      start += WORK_COUNT
      if (!page.length || start >= total || all.length >= WORK_MAX) break
    }
  } catch {
    // 中途失败就把已经拿到的返回，前端至少能多显示一批
  }

  sortWorks(all)
  return all
}
