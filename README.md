# TVBox Desktop for macOS

纯白极简的 macOS 影视聚合客户端。沿用安卓 TVBox 的配置订阅格式，用桌面端更好用的交互方式呈现。

> **来源**：本项目基于 [hgtuj5688/tvbox-desktop](https://github.com/hgtuj5688/tvbox-desktop) **v0.1.0**（MIT）改造。
> 上游是 Windows 桌面端；本仓库保留它的功能范围、配置格式和界面，在此基础上做 macOS 适配，
> 并增加了下面列出的内容。

## 这个项目和原项目是什么关系

### 原项目已有的（本仓库基本原样保留）

- Electron + React 19 + TypeScript + Vite + zustand 的工程骨架与三层进程隔离
- 配置源 / 影视源管理，A / B 两种 TVBox 配置方言解析
- 聚合搜索、分类浏览、详情选集、收藏与观看历史
- ArtPlayer + hls.js 播放、网页线路解析、电视直播、AI 剧情总结
- 端到端自检脚本（177 项断言）

### 本仓库新增的

| 改动 | 说明 |
|---|---|
| 饭太硬导航内置源 | 从 `xn--sss604efuw.net` 拆出 2 路直播源（首启自动添加），另提供「王二小」在线订阅预设 |
| 网络连接设置 | 渲染进程默认直连，绕过会把视频 CDN 拦成 403 的系统代理；设置页和播放页 / 直播页工具栏都能切换 |
| 播放自动换线 | 网页分享线路解析失败时，自动切到**同一集**有直链的线路（如 `feifan` → `ffm3u8`） |
| 影视源页提示 | 直播源不混在点播站点里，明确提示去「电视直播」页查看 |
| Spider 识别 | `csp_*` 站点正确标记为「桌面端不支持」，不再当成 CMS 去请求 |
| 打包脚本 | 零依赖生成 `icon.icns`；`make-dmg.mjs` 用 hdiutil 生成 dmg |

### 为 macOS 适配的

- **数据目录**：改为 `~/Library/Application Support/TVBox Desktop/`（原版写在 exe 同级 `data\`）
- **原生菜单**：补上 appMenu / editMenu / windowMenu，Cmd+C / Cmd+V / Cmd+Q 可用
- **外部播放器**：注册表 + `.exe` 扫描改为 `.app` / Homebrew 探测，优先 IINA / VLC / mpv，`.app` 走 `open -a`
- **字体与文案**：SF Pro / 苹方字体栈，界面文案改为 macOS
- **Electron 版本**：锁定 43.x（Electron 44 起要求 macOS 13+，Monterey 跑不起来）
- **打包**：electron-builder 产出 zip + dmg（x64 / arm64）；无签名，首次打开需手动放行
- **自检脚本**：修正 macOS 下的路径处理（`fileURLToPath`）与播放器路径断言

### 没有做的事

- 没有实现 Android TVBox 的 Spider（jar/dex）运行时，所以 `csp_*` 点播源在桌面端仍然不可用
- 没有修改上游的配置格式、数据结构与大部分业务逻辑

## 概览

| | |
|---|---|
| **技术栈** | Electron 43 + React 19 + TypeScript 7 + Vite 7 + zustand，ArtPlayer + hls.js |
| **系统要求** | macOS 12 (Monterey) 及以上，Intel / Apple Silicon 均可 |
| **形态** | 数据放 `~/Library/Application Support/TVBox Desktop/`，不写应用包内部 |
| **验证** | `npm run selftest` 端到端 **177 项断言**全绿；`npm run typecheck` / `npm run build` 干净 |

## 功能

- **配置源管理**：支持 A / B 两种 JSON 方言，订阅地址与本地文件都能加，可单条或全部同步。
- **影视源管理**：多配置源按顺序去重，筛选、排序、启用/禁用、逐条或批量测连通性。
- **聚合搜索**：并发池 + 流式进度，同名影片跨站合并，默认过滤「XX解说 / 一口气看完」。
- **分类浏览**：拉各站分类树，沿祖先链归并出大类 / 子分类，滚动到底自动加载下一页。
- **详情与选集**：CMS 与网页规则两条解析路径，多线路切换。
- **内嵌播放**：ArtPlayer + hls.js，支持 m3u8 直播 / 点播与网页线路自动换出真实地址。
- **独立播放器窗口**：播放放在单独的唯一窗口里，主窗口可以继续搜索 / 浏览；点新视频只切换播放器内容，不会开第二个窗口。
- **外部播放器**：自动探测 IINA / VLC / mpv / sPlayer / nPlayer / Infuse / VidHub / QuickTime 等，点按钮弹出列表由用户自己选，不再默认 QuickTime。
- **电视直播**：m3u / txt 两套语法，跨源同名频道合并成一卡多线路，带线路体检。
- **收藏与观看历史**：本地落盘，历史按归一化片名跨源合并。
- **首页内容位**：读配置里的 `tvboxDesktop.home.sections`，没配时按可用源给「最近更新」。
- **AI 剧情总结**：可选，Key 只存在本机；支持抽帧看画面后总结。

## 内置源（首启自动添加）

| 订阅 | 内容 |
|---|---|
| 公开可用源（苹果CMS 采集站） | 12 个实测存活的采集接口 + 1 条公开直播源 |
| 饭太硬导航 · 直播源 | 2 条直播源（实测约 19 个分组 / 450+ 频道） |

12 个采集站：非凡、量子、电影天堂、光速、素博、红牛、豪华、无尽、魔都、360、
电影天堂（新）、桃花。2026-11-20 复测：搜索「庆余年」有 8 个站响应，合计 55 条结果。

> 覆盖安装旧版本后，本地预设文件不会自动刷新：需要在「设置 → 配置源」里删掉旧的
> 「公开可用源」，再点一次「添加」，才会拿到这 12 个站点。

### 关于按演员搜索

公开苹果 CMS 接口的 `wd` 只匹配片名。实测 12 个内置源 + 16 个候选源，
`?ac=detail&wd=张译` 全部返回 0 条；`actor` / `vod_actor` 等参数会被服务端忽略。
客户端兜底需要扫描各站全量列表，实测 60 页/站仍需数分钟且找不到较早作品，因此没有内置。

## 快速开始

需要 Node.js 20+（推荐 22）。

```bash
npm install      # 首次安装会自动补下载 Electron 二进制（走 npmmirror）
npm run dev      # 启动开发窗口
```

国内网络下如果 Electron 二进制下载失败，手动执行：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

## 打包

```bash
npm run build:mac
```

产物在 `release/`：

- `TVBox Desktop-0.1.0-x64.dmg` / `TVBox Desktop-0.1.0-arm64.dmg`：安装镜像
- `TVBox Desktop-0.1.0-x64.zip` / `TVBox Desktop-0.1.0-arm64.zip`：免安装包

只想打当前架构（例如本机是 Intel）：

```bash
npx electron-vite build && npx electron-builder --mac --x64
```

### 首次打开被 Gatekeeper 拦下

安装包**没有 Apple 开发者签名**，首次打开会提示「无法验证开发者」。任选一种方式放行：

1. 在「访达」里右键应用 → **打开** → 再点「打开」；
2. 或执行：

```bash
xattr -dr com.apple.quarantine "/Applications/TVBox Desktop.app"
```

## 数据目录

```
~/Library/Application Support/TVBox Desktop/
  settings.json          设置（含外部播放器、AI Key）
  sources.json           配置源
  sites.json             影视源覆盖（启用状态、排序等）
  favorites.json         收藏
  history.json           观看历史
  session/               Chromium 缓存与登录态
```

卸载应用不会删除这个目录；彻底清理时手动删掉即可。

## 外部播放器

设置页的「外部播放器」留空时会自动探测，优先级：

**IINA → VLC → mpv → Infuse → Movist Pro → Elmedia Player → QuickTime Player**

扫描 `/Applications`、`~/Applications`、`/System/Applications` 与 Homebrew 的
`/opt/homebrew/bin`、`/usr/local/bin`。也可以直接填 `.app` 包路径或命令行播放器：

```text
/Applications/IINA.app
/opt/homebrew/bin/mpv
```

参数模板里 `{url}` 代表播放地址，例如 `--fullscreen {url}`（仅命令行播放器生效）。

## npm 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发窗口（渲染进程热更新） |
| `npm run dev:debug` | 同上，另开 CDP 调试端口 9222 |
| `npm run typecheck` | 主进程 / 渲染进程双工程类型检查 |
| `npm run build` | 产出 `out/`（主进程 / preload / 渲染进程） |
| `npm run build:mac` | 打包 macOS dmg + zip（x64 / arm64） |
| `npm run selftest` | 端到端自检，需要先跑着 `npm run dev:debug` |
| `node scripts/make-icon.mjs` | 重新生成 `build/icon.png`、`icon.ico`、`icon.icns` |

## 目录结构

```
src/
  shared/            主进程与渲染进程共用（类型、IPC 通道、站点类型标签）
  main/
    index.ts          窗口、生命周期、菜单、IPC 注册
    services/         配置源 / 影视源 / 搜索 / 分类 / 详情 / 播放 / 直播 / 解析 / 收藏…
  preload/           contextBridge 暴露的 window.api
  renderer/          React 界面（Home / Search / Detail / Player / Live / Library / Sites / Settings）
scripts/
  make-icon.mjs      零依赖生成 png / ico / icns
  make-dmg.mjs       用 hdiutil 从 .app 生成 dmg（绕过 electron-builder 的 Finder 自动化）
  selftest.mjs       CDP 驱动的端到端自检
  shot.mjs           按路由截图
samples/             自检与示例配置
```

## 上游关系

- 上游：[hgtuj5688/tvbox-desktop](https://github.com/hgtuj5688/tvbox-desktop)（v0.1.0，MIT）
- 本仓库：在其基础上做 macOS 移植，并加上内置直播源与播放链路的小改动
- 每一轮改动的原因与验证记录见 [CHANGELOG.md](CHANGELOG.md)

## 已知限制

- 没有代码签名与公证，首次打开需要手动放行。
- 解析接口只做 HTTP 解析（type=1/2），`type=0` 的浏览器嗅探未实现。
- 公开采集站随时可能失效，失效后在「影视源」页点「测试」即可看出来。
- 播放进度取决于源：只给分享页地址的源拿不到真实进度。
- AI 总结没有音轨，只根据抽帧画面与资料推断。

## 声明

软件本身不提供任何影视内容，只负责解析用户自行添加的配置订阅。
请仅用于学习与个人用途，内容版权归各站点与版权方所有。

## License

MIT，见 [LICENSE](LICENSE)。原项目版权归 [hgtuj5688/tvbox-desktop](https://github.com/hgtuj5688/tvbox-desktop) 作者所有。
