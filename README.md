# CrabUI for Typora

Crab 主题家族的独立排版工具：在自带的实时预览里调整 Typora 各类段落的字体、字号、字重、字形、字间距、词间距、行高、段前后距、首行缩进、对齐，以及列表项间距、表格框线与底色、单元格内边距、版心宽度、版心左右留白与全局缩放基准，再一键写回 `themes` 目录。

技术栈：**Tauri 2 + React 19 + TypeScript + Vite + Ant Design 6 + lucide-react**。

---

## 运行与构建

前置条件（Windows）：Node ≥ 18、Rust stable（MSVC 工具链）、Visual Studio 生成工具（C++ 桌面开发）、WebView2 运行时（Win11 自带）。

```bash
cd crabui
npm install

npm run tauri dev      # 开发调试（热更新）
npm run tauri build    # 产出 exe 与安装包（src-tauri/target/release/bundle）
npm run build          # 只构建前端（tsc + vite），用于 CI 检查
npm test               # 前端单测（vitest，盯住覆盖 CSS 的生成规则）
```

Rust 侧单测：

```bash
cd src-tauri && cargo test
```

---

## 界面

| 区域 | 内容 |
| :--- | :--- |
| 顶栏 | themes 目录（自动探测 `%APPDATA%\Typora\themes`，可手选）、主题下拉、明暗切换、覆盖总开关 |
| 左侧 | 13 个段落条目：全局版心、正文段落、标题 H1–H6、引用块、列表、代码块、行内代码、表格；徽标数字表示该条目改了几项 |
| 中间 | 当前条目的属性控件；未改过的属性显示「继承 …」即主题原值，改过的可单项复位 |
| 右侧 | 实时预览：真正加载所选主题 CSS（含 `@import` 与字体），文档结构与 Typora 的 `#write` 一致；可点击或按住"只看主题原样"与自定义排版对比 |
| 底栏 | 预设方案、全部重置、查看 CSS、保存 `crab-typography.css`、写入所选主题（已写入过的主题还会多出「移除写入」）、重启 Typora、打开目录 |

预设：主题默认 / 紧凑 / 舒适阅读 / 中文长文 / 论文打印 / 大字护眼。

### 重启 Typora

Typora 只在启动时读一遍主题 CSS，改完要重启才看得到。底栏的这个按钮按当前状态显示三种样子：

| 状态 | 按钮 | 行为 |
| :--- | :--- | :--- |
| Typora 正在运行 | 重启 Typora | 二次确认后请它正常退出，退出后自动重新打开 |
| Typora 没运行 | 启动 Typora | 直接打开，不再确认（没什么可丢的） |
| 没探到 Typora.exe | 指定 Typora | 手选安装目录，路径存进配置，下次直接可用 |

**默认走优雅关闭，不强杀。** 发的是 WM_CLOSE，等同于点窗口的关闭按钮：你有未保存的文档时 Typora 会照常弹窗问你，这时它不会退出，应用也不会硬来——而是回过头提示「Typora 没有退出」，让你选「我去保存」还是「强制重启」。强制那条路才带 `taskkill /F`，按钮是红的，因为它会丢掉未保存的内容。

安装目录的探测顺序：配置里手动指定的路径 → `%PROGRAMFILES%` / `%PROGRAMFILES(X86)%` / `%LOCALAPPDATA%\Programs\Typora` / `C:`–`F:` 盘的 `Program Files[ (x86)]\Typora` → 注册表卸载项里的 `InstallLocation`。每一步都要求目录里真有 `Typora.exe` 才算命中，所以装在别处也能靠「指定 Typora」兜住。

### 表格框线与底色

「表格」条目最上面是两个独立的下拉框，一个只管线、一个只管填充，可以任意搭配：

| 框线 | 效果 |
| :--- | :--- |
| 无框线 | 一条线都不画，只靠留白分隔 |
| 仅表头线 | 表头下一条线，正文完全无线 |
| 三线 | 论文常用：顶线、表头线、底线 |
| 横线 | 行与行之间都有横线，没有竖线 |
| 全框线 | 每格四边都有线，最接近表格软件 |
| 仅外框 | 整表一圈直角边框，内部无线 |
| 圆角卡片 | 圆角外框加浅阴影，行间淡线分隔 |

| 底色 | 效果 |
| :--- | :--- |
| 无底色 | 表头与正文都透明，只留线条 |
| 表头底色 | 只给表头一层淡底，正文透明 |
| 斑马纹 | 隔行底色，宽表格里不容易看错行 |
| 表头底色 + 斑马纹 | 表头淡底，正文隔行底色 |

两轴严格互不越界：只设「框线」时主题原有的表头底色和斑马纹照旧保留，只设「底色」时主题原有的线条一根不动。想整表重做就两个都设。

线条与底色都用 `color-mix(in srgb, currentColor, …)` 由当前文字色兑出来，所以同一份配方在浅色和深色主题里都成立，不必按 `crab` / `crab-classic` / `crab-simple` 各自的变量名分别写一套（它们的变量名互不相同）。表头底色取的是 `th` 自己的文字色，于是会自动带上主题的强调色。

每份配方在自己那一轴上都是完整的：框线会先把主题的外框、圆角、阴影、竖线、行线全部归零再画自己的，底色会先清掉表格面板底（深色分支那层半透明磨砂）、表头底、隔行底色再铺自己的。三个分支的底子差别很大（`crab` 是圆角外框加竖线，`crab-classic` 是横线加斑马纹，`crab-simple` 是圆角加斑马纹），不归零的话换出来的效果会因主题而异。

`border-collapse: collapse` 下还要额外清掉画在 `tr` / `thead` / `tbody` 上的边框：折叠模型里行的边框和单元格的边框在同一条网格线上比宽度，`!important` 管不到别的元素，所以单元格写 `border: none` 时 `crab-simple` 的 `table tr{border-top:1px}` 与 `crab-classic` / `crab-simple` 的 `thead tr{border-bottom:2px}` 反而会赢。

单元格内边距不在配方里，仍由下面两个滑块单独控制，两者的声明会并进同一条规则。生成 CSS 时按固定的字段顺序输出，配方永远排在前面，你后设的单项能稳定压住它，不会因为"先改哪个"而结果不同。

---

## 三种生效方式

1. **保存 `themes/crab-typography.css` + 在 `base.user.css` 里 `@import`**（推荐）：对所有主题生效，Typora 重启后应用；应用可以帮你幂等地加/删这行 `@import`。
2. **写入所选主题 CSS**：把覆盖追加到该主题文件末尾的标记区块里（首次写入前自动生成 `.crab-bak` 备份，可一键移除区块）。导出 HTML / PDF 会带上主题 CSS，所以这种方式导出也生效。
3. **复制 CSS 自己贴**：「查看 CSS」里复制生成结果，贴到任何你想要的地方。

生成的规则只包含你显式改过的属性，统一带 `!important`（Crab 三个分支的特异性与 `!important` 用法不一致，这样最稳），未改动的属性完全沿用主题原值。

标题的「对齐」不只写 `text-align`，还会写一对 `margin-left` / `margin-right`：`crab` / `crab-plus` 分支把 H1 / H2 设成 `width: fit-content`，盒子只有文字那么宽，单改 `text-align` 标题一动不动，得靠 `auto` 外边距把整块标题挪到左 / 中 / 右。标题本来就撑满一行的分支（`crab-classic` / `crab-simple`）里 `auto` 会算成 0，不会有副作用。

H3~H6 选「居中」或「右」时还会补一句 `width: fit-content`，为的是让装饰跟着标题走：`crab.dark` 的 H3 是整行宽盒子加一条绝对定位在 `left: 0` 的左侧竖条，H4 / H5 是 `display: flex`（圆点是 flex 项，`text-align` 根本管不到），不收缩盒子的话只有文字跑掉、竖条和圆点留在原地。H1 / H2 不收缩：`crab-classic` / `crab-simple` 给它们画了横贯整行的 `border-bottom`，收缩会把那条线一起缩短。

---

## 配置文件

配置写在 `themes/crab-typography.json`：

```json
{ "version": "1.0.0", "enabled": true, "values": { "p": { "fontSize": "17px", "lineHeight": "1.9" } } }
```

`values` 只记录你显式改过的属性，未被识别的段落 / 属性键在读取时会被丢弃；除 `version` / `enabled` / `values` / `studio`（界面自己的记忆项）之外的顶层字段会原样保留。若这个文件被手改坏了（JSON 解析失败），应用会提示并**停止自动回写**，避免覆盖掉你的原文件。

---

## 目录结构

```
crabui/
├── src/
│   ├── lib/            # 领域层：model（段落与属性定义）· css（生成覆盖）· preview（预览文档）· api（命令封装）
│   └── components/     # 界面：PreviewPane · FieldRow · CssDrawer 等
└── src-tauri/
    ├── src/fsops.rs    # 目录探测、@import 内联、标记区块读写、路径越界校验（含单测）
    ├── src/typora.rs   # Typora 安装位置探测与进程重启（含单测）
    └── src/lib.rs      # Tauri 命令注册
```

所有文件读写都在 Rust 侧完成，并限制在选定的 `themes` 目录内；前端不直接接触文件系统。

---

## 开源许可

本项目采用 [GNU General Public License v3.0 or later](LICENSE)。这意味着你可以自由使用、修改和分发它，但分发修改版时必须同样以 GPL 开源并提供源码。

`themes/` 下随主题分发的字体文件不属于本项目代码，各自沿用上游许可：**HarmonyOS Sans SC**（华为 HarmonyOS Sans 字体许可）、**Maple Mono** / **JetBrains Mono** / **Pretendard**（SIL Open Font License 1.1）。再分发或商用时按各字体自己的条款办。
