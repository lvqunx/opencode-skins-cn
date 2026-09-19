# opencode-skins · 增强版

基于 [sikehuang88/opencode-skins](https://github.com/sikehuang88/opencode-skins)（MIT）的社区增强版。
在原有的运行时皮肤引擎之上，新增了 **背景图片按钮**、**音乐播放器**，并用一整套自制主题替换了原版皮肤。

Runtime skin engine for **OpenCode Desktop** (Electron) with a background-image button,
a music player, and a set of original animated themes.

---

## 新增内容

- 🖼 **背景图片按钮**：右下角图片按钮 → 选择本地图片 → 立即设为 App 背景（首次自动创建 `imagebg` 皮肤，可反复替换）
- 🎵 **音乐播放器**：右下角唱片按钮 → 网易云歌单（Meting API）或本地音乐，支持随机 / 单曲循环 / 坏曲自动跳过 / 系统媒体控制（MediaSession）/ 状态持久化
- 🎨 **自制主题集**（替换了原版 5 套默认皮肤）：
  - `particles` — Three.js 粒子网络（含鼠标推离/高亮/视差，移植自 MiniMax H3 Studio 示例界面）
  - `sakura` 樱花飘落 · `matrix` 数字雨 · `synth` 霓虹网格 · `snow` 落雪星夜 · `ember` 篝火余烬
  - `daylight` 浅色毛玻璃主题（light color-scheme）
- 🧹 **无蒙版方案**：面板全透明（`surfaceAlpha: 0`）+ 透明标题栏，背景动效完整可见
- 📤 **新增 `/__skins_upload__/` 上传路由**（asar 补丁的一部分，仅允许写入 `userData/skins` 目录内），背景按钮与音乐导入均使用它

## 皮肤列表（Ctrl+Alt+S 循环切换）

| id | 说明 |
| ---- | ---- |
| `imagebg` | 背景图片（由右下角按钮自动创建） |
| `sakura` | 樱花飘落（粉色花瓣 + 黄昏渐变） |
| `matrix` | 数字雨（绿色字符雨） |
| `synth` | Synthwave 落日 + 透视网格 |
| `snow` | 落雪星夜（星星 / 雪花 / 流星） |
| `ember` | 篝火余烬（火星上升） |
| `particles` | Three.js 粒子网络（鼠标交互） |
| `daylight` | 浅色主题（毛玻璃面板） |

## 安装

```bash
# 0. 完全退出 OpenCode Desktop（含托盘图标）
node install.mjs            # 打补丁 + 部署引擎与皮肤
```

启动 OpenCode 后即生效。**App 更新后会覆盖补丁，重新执行一次 `node install.mjs` 即可**（皮肤与配置会保留）。

其命令：

```bash
node install.mjs status     # 查看状态
node install.mjs uninstall  # 移除补丁（保留皮肤目录）
```

## 热键

| 热键 | 作用 |
| ---- | ---- |
| `Ctrl`+`Alt`+`S` | 下一套皮肤（加 `Shift` 为上一套） |
| `Ctrl`+`Alt`+`R` | 重新应用当前皮肤（改完文件快速查看） |
| `Ctrl`+`Alt`+`0` | 关闭皮肤 |

## 音乐播放器

- 默认歌单：网易云歌单 `466636631`，经公共 [Meting](https://github.com/metowolf/Meting) API 加载（接口或歌单 ID 可在播放器 ⚙ 内更换）
- 也可点「添加本地音乐」导入本地音频文件（保存到 `userData/skins/music/assets`，离线可用）
- 播放器样式与交互移植自 MiniMax H3 Studio 示例界面

## 目录说明

```
install.mjs          # 安装器：对 app.asar 做仅 2 个文件的"外科手术"补丁
manager.mjs          # 可视化皮肤管理器（node manager.mjs → http://127.0.0.1:7788）
skins/engine/        # 运行时引擎 + 背景按钮 + 音乐播放器（部署到 userData/skins/engine）
skins/skins/         # 皮肤本体（可热编辑，改完约 1.5s 生效）
skins/pet/           # 桌面宠物（上游功能，可选）
```

## 致谢

- 上游项目：[sikehuang88/opencode-skins](https://github.com/sikehuang88/opencode-skins)（MIT）
- [three.js](https://threejs.org/) r128（MIT）— `particles` 皮肤内置
- 播放器与粒子效果参考：MiniMax H3 Studio 示例界面

## License

MIT — 见 [LICENSE](LICENSE)
