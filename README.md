# DSH 插件分享包

给 **DeepSeek Harness（DSH）桌面版** 用的 7 个小插件。不用懂代码，下载、解压、点几下就能装。

## 下载

| 方式 | 地址 |
|---|---|
| 下载整包（推荐） | 本页右侧 **克隆/下载 → 下载 ZIP** |
| 只要某个插件 | 进 `plugins/` 找对应文件夹 |

解压后应该看到 `plugins`、`setup`、`安装说明.md`。

## 安装（3 分钟）

1. 解压到固定位置，比如 `D:\DSH-插件`
2. 打开 DSH → **设置 → 插件 → 添加插件 → 本地目录**
3. 逐个选 `plugins\` 里的文件夹
4. 只有 `preview-popout` 要额外一步：右键 `setup\build-native.ps1` → 使用 PowerShell 运行，然后再装它
5. 重启 DSH

详细说明见 [安装说明.md](安装说明.md)。

## 插件列表

| 插件 | 作用 | Windows | macOS |
|---|---|---|---|
| `screenshot-insert` | 输入框截图标注，确认后插入 | ✅ | ✅（需屏幕录制权限） |
| `prompt-enhance` | 提示词增强 | ✅ | ✅ |
| `deliverable-hover-menu` | 交付物悬浮菜单 | ✅ | ✅ |
| `deliverable-link-route` | 交付物链接路由 | ✅ | ✅ |
| `session-delete-v3` | 删除会话 | ✅ | ✅ |
| `deepseek-usage` | 用量面板 | ✅ | ✅ |
| `preview-popout` | 预览标签拖出独立窗口 | ✅ | ❌ 原生壳是 Windows exe |

## 兼容性

- 适配 DSH **0.2.2-rc.3**；版本差太多可能不显示
- 插件源码不含任何个人数据、凭据或业务内容
- 自用分享，不保证长期维护

## 更新

- 普通人：重新下载 ZIP，覆盖 `plugins` 目录，重启 DSH
- 用 Git 的：`git pull`
