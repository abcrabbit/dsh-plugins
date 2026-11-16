# 预览独立窗口（Preview pop-out window）

把右侧「文档预览」面板顶部的**文件标签页拖出面板**（或右键标签页选择「在独立窗口中打开」），
该文件会在一个**真正的原生独立窗口**中重新打开；不经过系统浏览器，不产生浏览器标签/历史，
也不影响你已有的浏览器会话。原来的预览面板与标签页保持可用。

- 面板内标签页的普通行为（点击切换、面板内拖拽排序 / 分栏）不受影响。
- 只对**文件资源标签**生效（`dsh-resource://file/…`）；「开始」等页面型标签仍走 DSH 自己的浮动面板。
- 源标签保留在侧栏，避免独立窗口打开失败时丢失预览。

## 独立窗口是怎么来的（不经过浏览器）

DSH Desktop 的 Electron 壳拒绝页面内 `window.open`，插件无法从页面直接创建原生窗口。
本插件自带一个**极简的专用 Electron 壳** `native/electron/`：

- 它通过**硬链接**复用已安装 DSH 的 Electron/Chromium 运行时（exe、dll、pak、locales、icu 等），
  不额外复制安装包、不安装第二个浏览器；磁盘占用接近 0。
- `native/electron/resources/app/main.js` 只做一件事：读取 Host 通过环境变量传入的
  **已认证预览 URL**，创建一个 1180×820、无菜单、无标签栏/地址栏/历史记录的原生窗口加载它；
  限制导航只能停留在同一 origin，`window.open` 一律拒绝。
- Host 的 `/dsh-preview-popout/native` 路由负责生成该 URL（`connection.authenticatedUrl()`
  启动令牌 + fragment 负载）并 `spawn` 这个壳；插件卸载时自动结束它拉起的窗口进程。
- 新窗口加载同一个 DSH Web 应用；本插件的 Client 半把 fragment 里的 Base64URL 负载按 **UTF-8 字节**解码
  （不能直接用 `atob` 的 Latin-1 结果，否则中文文件名会乱码），然后：选中同一会话、
  重新打开同一文件、把右侧预览面板铺满整个窗口，并上报 `/ready` 供诊断。
- 纯 Web 部署（浏览器里运行 `dsh web`）没有原生壳，回退为普通新窗口；
  若连弹窗都被拦截，则保留 dockkit 的应用内浮动面板作为兜底。

## 预热与速度

冷启动要把整个 DSH Web 应用加载完才能显示预览，体感约 1.5–2.5 秒。插件为此做了一级**预热窗口**：

- 鼠标移到右侧预览的文件标签上（或按下标签）时，Client 请求 Host 预先拉起一个**完全透明、忽略鼠标**的
  原生窗口，并把该标签的 `{sessionId, address, title}` 作为提示带进窗口；
- 预热窗口在后台完成应用启动，并**提前把该文件的预览铺好**（仍在透明状态、不显形）；
- 用户真正拖出并松手时，Host 只需把 payload 交给预热窗口；若预览已准备好，窗口**约 0.1 秒内**直接显形；
  若用户动作很快、预览还没铺完，则等预热完成后再显形（实测约 0.7 秒），仍明显快于冷启动；
- 未被使用的预热窗口在 25 秒后自动关闭，不会长期占用资源；插件卸载时也会清理。

实测（应用已启动、后端已就绪）：

| 路径 | 从触发到窗口呈现文件内容 |
|---|---|
| 预热完成后再松手 | **约 0.07 秒** |
| 刚开始预热就松手 | 约 0.72 秒 |
| 无预热冷启动（对照） | 约 1.5 秒（此前整窗可见约 2.6 秒） |

## 安装状态

已通过 `plugin_manager install_bundle` 安装到 `desktop` profile，行 id 为 `preview-popout`，
包名 `@local/dsh-plugin-preview-popout`。

## 涉及文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单、`dsh.client` 声明（加载顺序） |
| `cordis.patch.yml` | 向 profile 插入 `preview-popout` 行 |
| `index.js` | Host 半：`/open`（Web 回退）、`/native`（拉起原生窗口）、`/ready`（恢复结果）；启动与清理原生窗口进程 |
| `client.js` | Client 半：标签拖拽手势、标签右键菜单、独立窗口内的会话/文件恢复与整窗预览样式 |
| `native/electron/resources/app/main.js` | 极简 Electron 壳：创建一个只承载预览的原生窗口 |
| `native/electron/*` | 通过硬链接复用的 Electron/Chromium 运行时（不占额外磁盘） |
| `locale/*.json`、`icon.svg` | 插件市场展示元数据与原创图标 |

## 实现思路

### 1. 右侧预览的既有实现（不修改）

右侧预览由 DSH 自带的几个 Client 插件组成，本插件只在其外面加交互层：

- `@deepseek-ai/dsh-client-ui-sidebar-right`：右侧栏的**停靠面板**。它用 docking kit 管理
  「停靠面板 / 浮动面板」布局、标签条、分栏，并通过插槽把标签正文分发出去；对外提供
  `ctx.sidebarRight` 服务（`openResource/openTab/tabsIn/float/dock`）。
- `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`：注册 `text` 类型标签，在
  `sidebar.right.pane.tab` 插槽里渲染文档预览，按后缀分派文本/代码、Markdown、HTML、
  图片、PDF、Excel、Office→PDF 渲染器，数据来自 `ctx.remote.workspaceFiles`。
- 本插件通过公开服务读取标签记录（含 `contentId` 资源地址），不读取也不改写预览渲染器。

### 2. 拖拽手势

- 在 `window` 捕获阶段监听 `pointerdown/move/up`；只识别右侧栏内 `[data-dockkit-tab]` 且
  `contentId` 是 `dsh-resource://file/` 的标签。
- 指针离开面板边界 24px 后视为「拖出」，显示跟随指针的「松开以在独立窗口中打开」提示。
- 松手时会**接管 dockkit 的 pointerup**（阻止它把标签浮成应用内面板），再向 dockkit 回放一次
  原位 pointerup 让它干净地结束拖拽状态：标签原地不动，不会出现「先浮出再收回」的闪动。
- 随后调用 Host 的原生窗口路由；拉起失败时保留应用内浮动面板作为兜底。

### 3. 原生窗口

- Host 校验 `sessionId` 与文件资源地址，用 `ctx.connection.authenticatedUrl()` 生成与启动时
  相同的已认证 URL，把 `{sessionId, address, title}` 的 Base64URL 负载放进 fragment；
  以环境变量（`DSH_PREVIEW_URL` / `DSH_PREVIEW_TITLE`）传给原生壳并 spawn。
- 原生壳创建窗口时**先完全透明地显示**（`opacity: 0`，保证渲染器正常绘制），
  在页面把标题设为就绪标记前，窗口对用户不可见；本插件在应用整窗预览样式并绘制两帧后
  才发出该标记——原生壳随即把窗口变为不透明并聚焦。因此**用户看到的第一帧就是文件内容**，
  不会先闪一下 DSH 应用界面。
- 原生壳创建窗口后加载该 URL；本插件在窗口内恢复会话与文件，并给 `<html>` 加
  `data-dsh-preview-popout`，用注入样式把右侧面板固定铺满窗口、隐藏标签条/浮动面板/应用外壳。
- 恢复失败时保留应用界面并提示（同样会显形，不会白屏）。

## 已知边界

- 原生壳复用当前安装的 Electron 运行时；如果 DSH 卸载或该目录被移动，硬链接失效，
  插件会回退到应用内浮动面板（不会去调用浏览器）。
- 每次拖出会启动一个轻量 Electron 窗口进程；关闭窗口即退出，插件卸载时会清理未关闭的窗口。
- 主窗口标签保留，避免丢预览；如需严格「移动」语义可自行关闭源标签。
