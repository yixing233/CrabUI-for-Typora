<div align="center">

# Crab Theme for Typora

![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg?style=flat-square) ![Typora](https://img.shields.io/badge/Typora-Theme-ff6b9d.svg?style=flat-square)

**好看的样式可以提升写作体验 · A beautiful style improves the writing experience.**

[主题系列](#-主题系列--theme-family) • [设计特性](#-设计特性--features) • [快速安装](#-安装使用--installation) • [主题工坊](#-主题工坊--crab-theme-studio) • [CrabUI 排版管理器](#-crabui-for-typora) • [常见问题与配置](#-常见问题与配置--faq)

</div>

---

## 📖 简介 / Introduction

**Crab** 是一套专为 Typora 打造的高颜值 Markdown 写作主题家族。设计理念围绕 **清晰、分明、简约、美观、灵动**，兼具排版结构感与视觉愉悦感。

包含三大分支体系：
- 🖤 **Classic（经典系列）**：纯粹克制的黑白灰极简美学，纯净高对比度，搭载 Pretendard 与 JetBrains Mono 字体。
- 🌿 **Simple（简约系列）**：清爽卡片质感，内敛的圆弧四角包角边框与悬停高亮，舒适护眼。
- 🎨 **Plus（增强系列）**：丰富生动的色彩体系、平滑的光晕呼吸边框、气泡与毛玻璃光影质感，配备亮色与暗色全套方案。

---

## 🎨 主题系列 / Theme Family

| 系列 / Series | 主题名称 / 文件名 | 风格特点 / Style & Fonts |
| :--- | :--- | :--- |
| **Classic 经典** | • `crab-classic-light.css`<br>• `crab-classic-dark.css` | 极简原厂质感 · Pretendard & JetBrains Mono |
| **Simple 简约** | • `crab-simple-pink.css`<br>• `crab-simple-green.css` | 清爽护眼 · 四角圆弧包角 · HarmonyOS Sans & Maple Mono |
| **Plus 亮色系** | • `crab-plus-red.css`（红）<br>• `crab-plus-orange.css`（橙）<br>• `crab-plus-forest-green.css`（森绿）<br>• `crab-plus-teal.css`（青）<br>• `crab-plus-blue.css`（蓝）<br>• `crab-plus-deep-blue.css`（深蓝）<br>• `crab-plus-rose.css`（玫瑰粉）<br>• `crab-plus-purple.css`（紫） | 气泡质感 · 光晕边框 · 呼吸感版心留白 · HarmonyOS Sans & Maple Mono |
| **Plus 暗色系** | • `crab-plus-dark-red.css`（暗红）<br>• `crab-plus-dark-green.css`（暗绿）<br>• `crab-plus-dark-cyan.css`（暗青） | 暗夜光影 · 霓虹线条 · 毛玻璃质感 |

---

## ✨ 设计特性 / Features

1. **精心调校的排版版心（Optimal Layout）**
   - 黄金阅读宽度与宽适的上下留白（`max-width: 820px`，`padding: 40px 30px 100px`），大屏阅读体验宽敞舒适不贴底。
2. **优雅层级（Clear Hierarchy）**
   - 标题、列表、多级大纲深度优化，层级一眼分明，专注内容结构。
3. **灵动且克制的交互（Smooth Interactions）**
   - 移除晃眼的位移、缩放（Zoom）与弥散光晕，悬停仅呈现**清晰锐利的高亮描边**（引用块、代码块、表格、图片、行内代码、公式块等）。
4. **精美引用块与卡片（Blockquote & Cards）**
   - 引用块摒弃粗重左边条，采用开阔的柔和圆角卡片与精美引语标识。
5. **开箱即用的本地中西文字体（Typography）**
   - 内置并优选 **HarmonyOS Sans SC**（华为鸿蒙黑体）与 **Maple Mono**（枫叶等宽编程字体），中西文混排舒适自然。
6. **HTML / PDF 导出深度优化（Export Optimization）**
   - 完美适配 Typora 导出为带侧边栏大纲的 HTML 网页及 PDF 打印排版。

---

## 🛠️ 主题工坊 / Crab Theme Studio

除了内置的 15 款预设配色外，你还可以使用可视化的主题工坊工具，一键实时微调并生成专属于你的 Crab 配色 CSS：

- ☀️ **[亮色主题工坊 / Crab Theme Studio Light](Crab%20Theme%20Studio.html)**
- 🌙 **[暗色主题工坊 / Crab Theme Studio Dark](Crab%20Theme%20Studio%20Dark.html)**

---

## 📦 安装使用 / Installation

### 1. 下载主题包
从仓库下载或克隆整个仓库文件夹。

### 2. 复制到 Typora 主题目录
打开 Typora，进入 **「文件」➔「偏好设置」➔「外观」➔「打开主题文件夹」**。

> **Windows 快捷直达**：按 `Win + R` 键，输入以下路径并回车：
> ```cmd
> %appdata%\Typora\themes
> ```

将本仓库中的以下内容直接复制到 `themes` 文件夹中：
- 核心文件夹：`crab/`（包含基础样式与通用字体资源）
- 经典字体文件夹：`crab-dark/`（Classic 系列字体依赖）
- 所有 `crab-*.css` 预设主题文件
- 可选增强：`crab-enhance.js` 与 `crab-inject.ps1`（见下文「高级增强脚本」）

### 3. 重启与启用
完全退出并重新启动 Typora，在菜单栏 **「主题」** 列表中即可看到并选择任意 Crab 主题！

---

## ⚡ 高级增强脚本（可选） / Optional UI Enhancement Script

由于 Windows 平台 Chromium 对原生 `<select>` 下拉菜单采用系统级窗口绘制限制，默认纯 CSS 仅能美化输入框与基础选项。

如果你追求 **100% 极致一体化视觉体验**（如毛玻璃下拉面板、平滑淡入展开、自定义阴影与高亮光标），可以使用附带的 **`crab-enhance.js`** 脚本：

### 注入方式（任选其一）：
1. **用附带的 `crab-inject.ps1` 脚本（推荐）**：在 `themes` 目录下打开 PowerShell 执行
   ```powershell
   .\crab-inject.ps1            # 只查看当前注入状态，不做修改
   .\crab-inject.ps1 -Inject    # 注入（改的是安装目录，必要时自动请求管理员权限）
   .\crab-inject.ps1 -Restore   # 用备份还原
   ```
   脚本会自动定位 Typora 安装目录（注册表 + 常见路径，也可用 `-TyporaDir` 指定），为 `resources/window.html` 与 `resources/page-dist/*.html` 生成 `*.crab-bak` 备份，再在 `</body>` 前插入引用并把 `crab-enhance.js` 复制到对应目录。完全退出并重启 Typora 后生效。
   > Typora 升级会覆盖这些页面模板，升级后重新执行一次 `-Inject` 即可。
2. **配合 Typora 插件管理器**：
   - 使用社区主流插件管理器（如 `typora-plugins-manager` / `typora-community-plugin`），直接将 `crab-enhance.js` 放入插件脚本目录加载。
3. **手动注入**：
   - 打开 Typora 安装目录下的 `resources/window.html`（或 `resources/app/src/window/index.html`），在 `</body>` 之前添加一行：
     ```html
     <script src="./crab-enhance.js"></script>
     ```
4. **开发者工具临时体验**：
   - 在 Typora 中按 `Shift + F12` 打开 DevTools 控制台，将 `crab-enhance.js` 的内容直接粘贴到 Console 并回车运行。

---

## 🖥️ CrabUI for Typora

**排版管理器**：Tauri + Ant Design 桌面程序，自带真实主题的实时预览，把排版调顺眼了直接写回 `themes` 目录，不需要动 Typora 安装目录。

```bash
cd crabui
npm install
npm run tauri dev      # 调试运行
npm run tauri build    # 打包出 exe / 安装包
```

可调节的属性：**字体、字号、字重、字形、字间距、词间距、行高、段前距 / 段后距、首行缩进、对齐方式**，以及**列表项间距、表格单元格内边距、版心宽度、版心左右留白、全局缩放基准（`html` 字号）**。

覆盖的段落类型：全局版心、正文段落、标题 H1–H6、引用块、列表、代码块、行内代码、表格。

左侧选段落类型、中间调属性、右侧是加载了真实主题 CSS（含 `@import` 与内置字体）的实时预览，文档结构与 Typora 的 `#write` 一致；预览区右上角的按钮可点击锁定或按住临时切到"只看主题原样"，与自己调的排版做对比。

细节见 [crabui/README.md](crabui/README.md)。

### 内置预设方案
| 预设 / Preset | 说明 / Description |
| :--- | :--- |
| **主题默认** | 完全沿用当前 Crab 主题的原始排版 |
| **紧凑** | 收紧行高与段距，一屏容纳更多内容 |
| **舒适阅读** | 放宽行高与段距，长时间阅读更轻松 |
| **中文长文** | 首行缩进 2em + 两端对齐，贴合中文写作习惯 |
| **论文打印** | 宋体 / Times 正文 + 黑体标题，首行缩进两端对齐，适合打印稿 |
| **大字护眼** | 整体放大字号，减轻视觉负担 |

### 配置与重置
- 配置自动保存在 `themes/crab-typography.json`，换主题也不会丢。
- **只覆盖你显式改过的属性**，没动过的属性完全沿用主题原值。
- 可「**重置本项**」或「**全部重置**」回到主题默认；顶栏总开关能一键对比启用前后的效果。

### 三种落盘方式
1. 保存 `themes/crab-typography.css`，并让应用在 `base.user.css` 里加一行 `@import`（对所有主题生效）；
2. 直接写入所选主题 `.css` 末尾的标记区块（首次写入自动生成 `.crab-bak` 备份，可一键移除）；
3. 从「查看 CSS」里复制生成结果，自己贴到想要的地方。

> 生成的是带 `!important` 的纯 CSS 覆盖，**不会改动 Markdown 源文件**。写进主题 CSS 之后，导出的 HTML / PDF 也会带上这套排版（主题 CSS 会被一并打包进导出结果）；Typora 需要重启或重新切换一次主题才会加载新的 CSS。

---

## 💡 常见问题与配置 / FAQ

### Q: 导出的 HTML 如何保留侧边栏大纲？
在 Typora 的 **「文件」➔「偏好设置」➔「导出」➔「HTML」** 中，勾选 **「保留侧边栏大纲」**。

### Q: 如何自定义内容最大宽度？
所有 Plus 系列的宽度变量均定义在对应的 `crab-plus-*.css` 文件头部，修改 `--max-width` 即可：
```css
:root {
  --max-width: 820px; /* 自定义你喜欢的内容宽度 */
}
```

### Q: 如何开启标题自动编号？
打开任意 `crab-plus-*.css` 文件，找到 `--autonum-*` 配置块，取消相应级别的注释即可启用标题自动编号：
```css
/* --autonum-h1: "§ " counter(h1) " "; */
/* --autonum-h2: counter(h1) "." counter(h2) " "; */
```

### Q: 如何开启或更换背景底纹？
在 `crab-plus-*.css` 文件头部，调整 `--bg-style` 变量对应的内容即可切换内置纹理背景。

---

## 📄 开源许可 / License

本项目基于 [GNU General Public License v3.0 or later](../LICENSE) 协议开源。

内置字体不在本协议覆盖范围内，各自沿用其上游许可，仅随主题一起分发：
**HarmonyOS Sans SC**（华为 HarmonyOS Sans 字体许可）、**Maple Mono**、**JetBrains Mono**、**Pretendard**（SIL Open Font License 1.1）。
若你要再分发或商用，请按各字体自己的条款办。
