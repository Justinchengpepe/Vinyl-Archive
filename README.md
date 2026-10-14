# Vinyl Archive

**把唱片铺成一面墙，点开就能放。**

一个跑在浏览器里的 3D 黑胶唱片架音乐播放器。前端是手写的 Three.js 场景 + 原生 ES Module，**没有任何构建步骤**；后端是一个零框架的 Node 服务，只负责代理网易云 API、匹配高清封面。

同一套代码既能部署成网页，也能打包成 **macOS 桌面应用**（Electron）—— 桌面版把服务跑在本机 `127.0.0.1` 上，自带进程隔离、随机请求令牌和同源封面代理，见[桌面版](#桌面版)。

内置 **30 位说唱 / R&B 艺人**、**156 张正式录音室专辑**。

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Justinchengpepe/music-player)

> **在线展示页** → <https://justinchengpepe.github.io/music-player/>
> 这是项目的静态展示页，能看界面截图和用法说明；真正的播放器要跑 Node 服务，见下方[怎么跑起来](#怎么跑起来)。

![3D 唱片架](assets/shelf.png)

---

## 界面一览

<table>
<tr>
<td width="50%">
<img src="assets/artist-picker.png" alt="选人界面">
<p align="center"><sub>开场选人 · 艺人无限轮播，滚轮 / 滑动切换</sub></p>
</td>
<td width="50%">
<img src="assets/album-panel.png" alt="专辑面板">
<p align="center"><sub>曲目面板 · 播放中高亮 / 进度拖拽</sub></p>
</td>
</tr>
<tr>
<td width="50%">
<img src="assets/lyrics.png" alt="黑胶歌词页">
<p align="center"><sub>黑胶歌词页 · 唱针随进度由外圈移向内圈</sub></p>
</td>
<td width="50%">
<img src="assets/panel-dark.png" alt="暗色主题">
<p align="center"><sub>暗色主题 · 同一面板与歌单</sub></p>
</td>
</tr>
<tr>
<td width="50%">
<img src="assets/accent-drake.png" alt="Drake 主色">
<p align="center"><sub>Drake · 主色 <code>#4a90d9</code></sub></p>
</td>
<td width="50%">
<img src="assets/accent-travisscott.png" alt="Travis Scott 主色">
<p align="center"><sub>Travis Scott · 主色 <code>#a83232</code></sub></p>
</td>
</tr>
<tr>
<td width="50%">
<p align="center"><img src="assets/artist-picker-mobile.png" width="46%" alt="移动端开场选人"></p>
<p align="center"><sub>移动端 · 开场选人</sub></p>
</td>
<td width="50%">
<p align="center"><img src="assets/mobile.png" width="46%" alt="移动端专辑轮播"></p>
<p align="center"><sub>移动端 · 专辑轮播</sub></p>
</td>
</tr>
</table>

<p align="center"><sub>Drake / Travis Scott 两张是<strong>同一个界面</strong>切到不同艺人的效果 —— 3D 背景与控件配色都由艺人主色推导，选中专辑后改用专辑色。</sub></p>

<p align="center"><sub>移动端不是缩小版：顶栏压缩为图标按钮，曲目面板改为从底部滑出的抽屉（占 56% 视口高），唱片架支持触摸滑动。</sub></p>

---

## 怎么跑起来

这个项目**不是静态网页**，必须有一个 Node 服务在跑。三种用法，按省事程度排：

| 方式 | 适合谁 | 代价 |
|---|---|---|
| **桌面应用** | 不想开终端，想要个能双击的 App | 下载 [Releases](https://github.com/Justinchengpepe/music-player/releases/latest) 里的压缩包解压即用 |
| **Codespaces 云端运行** | 只想看看效果，或想改点代码试试 | 一个 GitHub 账号，零安装 |
| **本地运行** | 想长期自己用，想加自己的歌手 | 装 Node.js 18+（推荐 22） |
| **部署到公网** | 想让别人点个链接就能用 | 一台服务器，或一个 Railway 账号 |

### 方式一：Codespaces（零安装）

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Justinchengpepe/music-player)

点按钮 → 等容器初始化（首次约 1–2 分钟，会自动跑 `npm install`）→ 服务自动启动，
浏览器弹出 8088 端口预览，那就是完整可用的页面。

> 服务冷启动要加载网易云模块，**首次约 30–60 秒**。如果预览打开时是报错页，
> 等一分钟刷新一下就好。

如果预览没自动弹出，在下方终端手动跑一次：

```bash
npm start
```

日常维护：

```bash
tail -f /tmp/vinyl-archive.log            # 看运行日志
pkill -f 'node server.js' && npm start    # 重启
```

> 免费账号每月 120 核时额度，容器闲置 30 分钟自动休眠，重新打开会再拉起一次。
> Codespaces 的机器在海外，网易云接口偶尔会慢 —— 加载不出来时可以设 `NETEASE_PROXY` 走代理。

### 方式二：本地运行

```bash
git clone https://github.com/Justinchengpepe/music-player.git
cd music-player
npm install
npm start
```

浏览器打开 **http://localhost:8088** 即可。

### 方式三：部署到公网

见下方 [部署](#部署) 章节。

---

### 为什么不能部署到 GitHub Pages？

**因为 GitHub 在这里的角色是「代码托管」，不是「运行环境」。**

页面里那 11 个 `/api/*` 接口（艺人列表、专辑曲目、播放地址、歌词、扫码登录…）
都必须由 `server.js` 在服务端转发给网易云 —— 浏览器直连会被 CORS 挡死。
而 GitHub Pages 只会把 HTML / CSS / JS 原样发出去，**不执行任何 Node 代码**，
所以传上去之后所有接口都会 404，页面直接白屏。

同理，**直接双击 `index.html` 打开也会白屏**，它必须由 `server.js` 托管。

想让别人点开链接就能用，得走上面的方式三。

> 顺带一提：项目的[在线展示页](https://justinchengpepe.github.io/music-player/)确实挂在 GitHub Pages 上 ——
> 因为它是纯静态的。但它只能展示截图和说明，点不动、放不了歌。

> 首次启动要加载网易云模块（9MB / 400+ 文件），**冷启动约 30–60 秒属正常现象**。

---

## 桌面版

同一套前端 + 后端，外面套一层 Electron 外壳。不想开终端就直接去
[Releases](https://github.com/Justinchengpepe/music-player/releases/latest)
下载压缩包，解压后双击 `Vinyl Archive.app`。

从源码跑：

```bash
npm install
npm run desktop
```

`desktop/` 里只有两个文件，职责很窄：

| 文件 | 干什么 |
|---|---|
| `main.cjs` | Electron 主进程：生成随机令牌 → `utilityProcess.fork` 起后端 → 拿到端口后开窗口 |
| `backend.cjs` | 后端启动器：`require('../server')` 起服务，把端口回传给主进程 |

窗口的安全配置全部收紧：`nodeIntegration: false` + `contextIsolation: true` + `sandbox: true`，
拒绝一切权限请求，并拦截所有跳出本机 origin 的导航。后端跑在独立进程里，随主进程退出而回收。

桌面版比网页版只多三件事：

| | 网页版 | 桌面版 |
|---|---|---|
| 渲染进程 | 普通浏览器 | 沙箱窗口，拿不到 `require` |
| 封面图 | 浏览器直连 CDN | 走 `/api/cover` 同源代理，绕开跨域 |
| API 鉴权 | 无 | 每个请求带 `X-Vinyl-Desktop` 令牌 |

令牌由主进程启动时随机生成，只在 Electron 进程树里传递；`server.js` 只在检测到
`VINYL_DESKTOP_TOKEN` 环境变量时才校验，**所以网页版部署完全不受影响**。

> 只想跑网页版的话，`npm install --omit=dev` 可以跳过 Electron（约 100MB）。

---

## 功能

- **3D 唱片墙** —— Three.js 渲染的封面墙，悬停高亮、点击翻面、镜头推进
- **黑胶歌词页** —— 独立场景，唱针随播放进度从外圈移向内圈，歌词逐行高亮
- **艺人切换** —— 开场是无限循环的艺人轮播，滚轮 / 滑动 / 点击均可切换
- **曲目面板** —— 侧滑面板展示曲目，播放中高亮、进度条拖拽、播放 / 暂停
- **双主题** —— 亮色 / 暗色一键切换；背景与控件主色由当前艺人推导（选中专辑后改用专辑色）
- **移动端适配** —— 响应式布局，窄屏下曲目面板自动改为底部抽屉
- **全库搜索** —— `⌘K` / `Ctrl K` 唤出搜索面板，直接查网易云全库的艺人与专辑，支持分页加载
- **一行命令加歌手** —— `npm run add-artist "歌手名"` 自动补齐 ID、专辑、封面、头像、主题色
- **扫码登录** —— 二维码登录网易云账号，解锁 999kbps 高码率播放
- **封面自动匹配** —— iTunes Lookup API 按专辑名归一化匹配 600×600 高清封面，网易云封面兜底

---

## 目录结构

```
.
├── index.html             # ★ 唯一页面：3D 唱片架 + 曲目面板 + 歌词场景
├── server.js              # Node 服务：静态文件 + API 代理 + MusicKit 签名 + 封面代理
├── artists.json           # ★ 艺人数据，唯一来源。加歌手只改这个文件
├── desktop/               # Electron 桌面版外壳
│   ├── main.cjs           #   主进程：起后端、开沙箱窗口、注入请求令牌
│   ├── backend.cjs        #   后端启动器：复用根目录的 server.js
│   └── package.json       #   Electron 入口声明
├── lib/
│   ├── music.js           # 专辑名归一化、版本标记判断、录音室专辑筛选、主题色推导（纯函数）
│   └── sources.js         # 网易云 / iTunes 数据源封装
├── scripts/
│   └── add-artist.js      # 命令行加歌手工具
├── js/
│   ├── three.module.js    # Three.js r160 运行时（本地内置，不走 CDN）
│   ├── archive-search.js  # ⌘K 全库搜索面板（原生 ES Module）
│   └── carousel-layout.mjs# 唱片架环形排布算法（半径随张数自适应）
├── assets/                # README 配图 + 搜索面板样式
├── docs/                  # GitHub Pages 展示页（纯静态，与播放器无关）
├── .devcontainer/         # Codespaces 配置：devcontainer.json + start.sh
├── deploy.sh              # Ubuntu / Oracle Cloud 一键部署脚本
├── .railwayignore         # Railway 部署忽略规则
├── musickit.example.json  # MusicKit 配置模板
└── .gitignore
```

---

## 加一位歌手

### 方式一：命令行（推荐）

```bash
npm run add-artist "Kendrick Lamar"
```

工具会自动完成：

1. 搜网易云拿到艺人 ID
2. 拉取全部专辑，排除单曲、deluxe、现场、混音、重复版本，按发行时间排序
3. 查 iTunes 拿到 `itunesId`（用于高清封面）
4. 取网易云头像
5. 推导主题色

常用参数：

```bash
npm run add-artist "Kendrick Lamar" --dry-run          # 只看结果，不写文件
npm run add-artist "Kendrick Lamar" --id 37995         # 直接指定网易云艺人 ID
npm run add-artist "Kendrick Lamar" --force            # 已存在时覆盖
npm run add-artist "Kendrick Lamar" --include-singles  # 连单曲一起列出来
npm run add-artist --list                              # 列出当前所有艺人
```

### 方式二：直接编辑 `artists.json`

```json
{
  "artists": [
    {
      "id": "37995",
      "name": "Kendrick Lamar",
      "albums": ["Section.80", "good kid, m.A.A.d city", "To Pimp a Butterfly", "DAMN."],
      "color": "#2c3e50",
      "itunesId": 368183298,
      "avatar": "https://p3.music.126.net/....jpg?param=300y300"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 网易云艺人 ID，从 `music.163.com/#/artist?id=xxx` 的 URL 里拿 |
| `name` | ✅ | 显示名 |
| `albums` | ✅ | 专辑名列表，按发行顺序排列 |
| `color` | | 主题色。不写则按名字稳定推导 |
| `itunesId` | | iTunes 艺人 ID。不写则启动时按名字自动搜 |
| `avatar` | | 头像 URL。不写则从网易云艺人详情自动取 |

> 改完 `artists.json` 重启服务即可生效，**不需要动任何代码**。

### 关于 `albums` 的匹配规则

`albums` 里写的是**专辑名**，服务启动后会拿去和网易云实际返回的专辑列表做匹配：

- 归一化后完全相等才算命中（忽略大小写、括号内容、非字母数字字符）
- 带 `(Deluxe)` / `(Live)` / `(Remix)` 等标记的版本会优先匹配同样带标记的那张
- **匹配不上的专辑不会被静默丢弃** —— 服务端日志会打出 `⚠` 警告，同时通过接口的 `unmatched` 字段返回

所以专辑名打错时你能立刻发现，而不是过几天才注意到少了一张。

---

## 登录网易云（可选）

不登录也能播放 30 秒试听片段；登录后解锁完整音质（999kbps）。

点右上角「登录」，用网易云 App 扫码即可。已登录时点右上角胶囊可以退出。

### 登录态是按人隔离的

这是本项目一个重要的设计：**服务器上不保存任何账号凭证。**

- 扫码拿到的 Cookie 只写进**访客自己的浏览器**（localStorage）
- 每次请求通过 `X-Netease-Cookie` 请求头带给服务端，服务端用完即弃
- 服务端进程本身永远是「未登录」状态

所以就算部署到公网，也是**谁登录就是谁的账号**，彼此完全看不到对方。
换设备、换浏览器都要重新扫码 —— 这是预期行为。

> 早期版本会把 Cookie 存成服务端的 `.netease_cookie` 文件，一旦部署到公网就会导致
> 「谁先扫码、之后所有访客都变成那个账号」。该行为已移除。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8088` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 监听地址。桌面版由主进程设为 `127.0.0.1`，只对本机开放 |
| `NETEASE_PROXY` | 无 | 网易云 API 请求代理地址，海外服务器部署时建议设置 |
| `VINYL_DESKTOP_TOKEN` | 无 | 桌面版请求令牌。**只有设了它才启用鉴权**，网页版不用管 |

```bash
PORT=3000 NETEASE_PROXY=http://127.0.0.1:7890 npm start
```

---

## 配置 MusicKit（可选）

服务端预留了 Apple MusicKit Developer Token 签发接口（`/api/musickit/token`，ES256 JWT），
**当前前端并未调用**，属于为后续扩展保留的能力。

```bash
cp musickit.example.json musickit.json
```

填入自己的 `teamId` / `keyId` / `privateKey`。该文件已在 `.gitignore` 中，不会被提交。

---

## API 接口

所有接口以 `/api/` 开头，返回 JSON。

需要登录态的接口（`song/url`、`album`、`lyric`、`search`、`login/status`）会读取请求头
`X-Netease-Cookie`（URL 编码后的网易云 Cookie）。不带这个头就是匿名访问，服务端不会替你兜底。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/artists` | 艺人列表（开场轮播用），含自动补全的 `color` / `avatar` |
| GET | `/api/artist/albums?id=<艺人ID>` | 某位艺人的专辑：`hotAlbums`（含 iTunes 高清封面）+ 未匹配清单 `unmatched` |
| GET | `/api/album?id=<专辑ID>` | 专辑详情与曲目列表 |
| GET | `/api/song/url?id=<歌曲ID>` | 歌曲播放地址（带 Cookie 时返回 999kbps） |
| GET | `/api/lyric?id=<歌曲ID>` | 歌词 |
| GET | `/api/search?keywords=<关键词>&type=1&offset=0` | 搜索，支持分页。`type=100` 查艺人、`type=10` 查专辑 |
| GET | `/api/cover?url=<图片地址>` | 同源封面代理，只放行网易云与 `mzstatic.com` 的 https 图片，供桌面版沙箱窗口使用 |
| GET | `/api/login/qr/key` | 生成登录二维码 |
| GET | `/api/login/qr/check?key=<key>` | 轮询扫码状态。`code=803` 时**在响应里返回 `cookie` 与 `nickname`**，由前端自行保存 |
| GET | `/api/login/status` | 查询当前登录状态（读请求头，现查一次） |
| GET | `/api/musickit/token` | 签发 Apple MusicKit Developer Token（ES256 JWT） |

---

## 部署

### GitHub Pages（只放展示页）

`docs/` 是纯静态的项目展示页，已发布在 <https://justinchengpepe.github.io/music-player/>。

```bash
gh api -X POST repos/Justinchengpepe/music-player/pages \
  --input <(echo '{"source":{"branch":"main","path":"/docs"}}')
```

改完 `docs/` 推到 main，Pages 会自动重新构建。**它只能展示截图，不能播放音乐** —— 原因见上。

### 通用 Linux 服务器

仓库内提供了 `deploy.sh`，基于 Node 20 + PM2：

```bash
scp -r . user@your-server:/opt/vinyl-player
ssh user@your-server
cd /opt/vinyl-player && bash deploy.sh
```

### Railway

仓库内已包含 `.railwayignore`，直接连接 GitHub 仓库即可部署。记得配置 `NETEASE_PROXY`。

> **可以放心部署到公网。** 登录态按访客隔离，服务器不落盘任何账号凭证。
> 只需确认 `musickit.json`（你的 Apple 私钥）没有被一并上传 —— 它已在 `.gitignore` 中排除。
>
> 建议启用 HTTPS：Cookie 是通过请求头传给服务端的，明文 HTTP 下可能被中间人截获。

> **⚠️ 长期公开服务请先加限流。**
> 当前 `server.js` 对 `/api/*` 没有任何速率限制，也不校验来源 —— 一旦公开，
> 任何人都能拿你的服务器当网易云代理刷接口，流量和封 IP 的代价都算在你头上。
> 小范围分享给朋友问题不大；如果是长期对外的服务，建议先加一层按 IP 的限流。

---

## 说明与免责

- 本项目仅用于个人学习与技术研究，音乐内容版权归各唱片公司及平台所有。
- 网易云音乐接口通过开源库 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 调用，请遵守对应平台的服务条款。
- 界面文案分工：主界面为英文，登录流程与播放提示为中文（涉及网易云账号与版权信息）。

## License

ISC
