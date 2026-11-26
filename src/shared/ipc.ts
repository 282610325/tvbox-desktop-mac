/** IPC 通道名常量，主进程与渲染进程共用，避免字符串写错 */
export const IPC = {
  appInfo: 'app:info',
  openExternal: 'app:open-external',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  /** 主进程 → 所有窗口：设置变了，前端 store 同步一份（多窗口时避免状态各说各话） */
  settingsChanged: 'settings:changed',

  sourcesList: 'sources:list',
  sourcesAdd: 'sources:add',
  sourcesUpdate: 'sources:update',
  sourcesRemove: 'sources:remove',
  sourcesSync: 'sources:sync',
  sourcesSyncAll: 'sources:sync-all',
  sourcesPickFile: 'sources:pick-file',
  sourcesPresets: 'sources:presets',
  sourcesAddPreset: 'sources:add-preset',

  sitesList: 'sites:list',
  sitesSetEnabled: 'sites:set-enabled',
  sitesSetAllEnabled: 'sites:set-all-enabled',
  sitesTest: 'sites:test',

  searchRun: 'search:run',
  searchCancel: 'search:cancel',
  /** 主进程 → 渲染进程：每完成一个站点推一次 */
  searchProgress: 'search:progress',
  /** 演员名 → 作品列表（搜索框输入演员名时用） */
  celebrityLookup: 'celebrity:lookup',
  /** 点「展开全部」时把该影人的作品补齐（接口一页 50 条，要翻页） */
  celebrityWorks: 'celebrity:works',

  detailGet: 'detail:get',

  categoryList: 'category:list',
  categoryBrowse: 'category:browse',

  liveLoad: 'live:load',
  liveResolve: 'live:resolve',
  /** 读线路体检缓存 */
  liveHealth: 'live:health',
  /** 体检一批线路（点开频道时懒体检 / 切分组时预热） */
  liveProbe: 'live:probe',
  liveClearHealth: 'live:clear-health',

  libraryGet: 'library:get',
  libraryToggleFavorite: 'library:toggle-favorite',
  libraryRemoveFavorite: 'library:remove-favorite',
  libraryClearFavorites: 'library:clear-favorites',
  libraryRecord: 'library:record',
  libraryRemoveHistory: 'library:remove-history-group',
  libraryClearHistory: 'library:clear-history',

  playerDetect: 'player:detect',
  playerOpen: 'player:open',
  /** 打开 / 复用唯一的播放器窗口 */
  playerOpenWindow: 'player:open-window',
  /** 打开 / 复用唯一的播放器窗口播放直播 */
  playerOpenLive: 'player:open-live',
  /** 播放器窗口启动后拉一次当前的直播目标（防止事件早于监听注册） */
  playerGetLive: 'player:get-live',
  playerCloseWindow: 'player:close-window',
  /** 主进程 → 播放器窗口：切换正在播放的视频 */
  playerNavigate: 'player:navigate',
  /** 主进程 → 播放器窗口：切换正在播放的直播频道 */
  playerLive: 'player:live',

  parseList: 'parse:list',
  parseResolve: 'parse:resolve',
  parseTest: 'parse:test',
  parseAdd: 'parse:add',
  parseRemove: 'parse:remove',
  parseResetStats: 'parse:reset-stats',

  /** 首页内容位。force=true 时忽略缓存重新拉一遍 */
  homeSections: 'home:sections',

  aiSummary: 'ai:summary',
  /** 带上从播放器里抽出来的画面，让模型真的看一遍 */
  aiSummaryVisual: 'ai:summary-visual'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
