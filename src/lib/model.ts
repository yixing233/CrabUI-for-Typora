/**
 * CrabUI for Typora · 排版数据模型
 *
 * 段落条目（TARGETS）与可调属性（FIELDS）的单一来源；
 * 选择器按 Typora 的 #write DOM 结构与 Crab 主题的实际特异性给定。
 */

export type FieldKind = 'font' | 'length' | 'number' | 'weight' | 'segment' | 'preset';

export type FieldId =
  | 'fontFamily'
  | 'rootFontSize'
  | 'fontSize'
  | 'fontWeight'
  | 'fontStyle'
  | 'lineHeight'
  | 'letterSpacing'
  | 'wordSpacing'
  | 'textIndent'
  | 'textAlign'
  | 'marginTop'
  | 'marginBottom'
  | 'itemGap'
  | 'cellPadY'
  | 'cellPadX'
  | 'tableBorder'
  | 'tableFill'
  | 'maxWidth'
  | 'pagePadding';

export interface FieldDef {
  label: string;
  kind: FieldKind;
  /** 生成的 CSS 属性名 */
  css: string;
  /** 读计算值时替代 css 的属性名（逻辑简写属性在 getComputedStyle 里取不到值） */
  read?: string;
  units?: string[];
  /** 非首选单位的 [min, max, step]，量级随单位切换 */
  ranges?: Record<string, [number, number, number]>;
  min: number;
  max: number;
  step: number;
  /** 计算值不是数值（normal / none）时滑块的落点 */
  neutral?: number;
  options?: Array<[value: string, label: string, desc?: string]>;
  tip?: string;
}

/** 段落格式条目 */
export interface TargetDef {
  id: string;
  name: string;
  /** lucide-react 的导出名 */
  icon: string;
  tip?: string;
  /** 默认选择器组 */
  sel: string[];
  /** 预览里读"当前生效值"用的兜底选择器 */
  probe?: string;
  fields: FieldId[];
  /** 某个属性单独使用的选择器组 */
  selFor?: Partial<Record<FieldId, string[]>>;
  /** 某个属性单独允许的单位（嵌套结构禁用 em，避免层层相乘） */
  unitsFor?: Partial<Record<FieldId, string[]>>;
  /** 某个属性单独的说明文案，优先于 FIELDS 里的通用说明 */
  tipFor?: Partial<Record<FieldId, string>>;
  /**
   * 改对齐时连左右外边距一起写。
   * Crab 把标题设成 width:fit-content（外加 margin:auto），盒子只有文字那么宽，
   * 单改 text-align 位置分毫不动，必须靠 margin-left/right 的 auto 来挪整块。
   * 标题本来就撑满一行的主题里，auto 外边距会算成 0，加了也没有副作用。
   */
  alignByMargin?: boolean;
  /**
   * 居中 / 右对齐时额外写 width: fit-content，把盒子收到文字那么宽，auto 外边距才挪得动整块。
   * 为的是让装饰跟着标题走：crab.dark 的 h3 是整行宽盒子 + 绝对定位在 left:0 的左侧竖条，
   * h4 / h5 是 display:flex（圆点是 flex 项，text-align 根本管不到），单改 text-align 只会让文字跑掉、装饰留在原地。
   * 只给 h3~h6 用：crab-classic / crab-simple 给 h1 / h2 画了横贯整行的 border-bottom，收缩盒子会把那条线一起缩短。
   */
  alignByShrink?: boolean;
  /** 顺带覆盖的主题变量 */
  vars?: Partial<Record<FieldId, string[]>>;
}

/** targetId -> fieldId -> CSS 值 */
export type Values = Record<string, Partial<Record<FieldId, string>>>;

export interface Config {
  version: string;
  enabled: boolean;
  values: Values;
}

export const WEIGHT_NAMES: Record<string, string> = {
  100: '极细', 200: '特细', 300: '细', 400: '常规', 500: '中等',
  600: '半粗', 700: '粗', 800: '特粗', 900: '黑',
};

/* ---------------- 表格框线与底色配方 ---------------- */

/**
 * 线条与底色一律用 color-mix + currentColor 兑出来：
 * currentColor 取的是表格继承到的正文色，浅色主题得到深线、深色主题得到浅线，
 * 不必按 crab / classic / simple 各自的变量名分别写一套（那些变量名互不相同）。
 */
const LINE = 'color-mix(in srgb, currentColor, transparent 80%)';
const LINE_SOFT = 'color-mix(in srgb, currentColor, transparent 90%)';
const LINE_STRONG = 'color-mix(in srgb, currentColor, transparent 35%)';
const HEAD_BG = 'color-mix(in srgb, currentColor, transparent 94%)';
const ZEBRA_BG = 'color-mix(in srgb, currentColor, transparent 95%)';
const HOVER_BG = 'color-mix(in srgb, currentColor, transparent 90%)';
const CARD_SHADOW = 'box-shadow: 0 1px 3px color-mix(in srgb, currentColor, transparent 92%)';

const TABLE = '#write table';
/** 与 table 条目里 cellPadY / cellPadX 的选择器逐字相同，好让声明并进同一条规则 */
const CELLS = [`${TABLE} td`, `${TABLE} th`];
const HEAD_CELLS = [`${TABLE} th`];
const THEAD_ROW = [`${TABLE} thead tr`];
const BODY_ROWS = [`${TABLE} tbody tr`, `${TABLE} tbody tr > td`];
const EVEN_ROWS = [`${TABLE} tbody tr:nth-child(2n) > td`, `${TABLE} tbody tr:nth-child(2n) > th`];
const HOVER_CELLS = [`${TABLE} tbody tr:hover > td`, `${TABLE} tbody tr:hover > th`];
const LAST_ROW = [`${TABLE} tbody tr:last-child > td`, `${TABLE} tbody tr:last-child > th`];
/**
 * border-collapse: collapse 下，tr / thead / tbody 上的边框和单元格的边框在同一条网格线上比宽度，
 * !important 管不到别的元素，所以单元格写 border: none 时 simple 的 `table tr{border-top:1px}`、
 * classic / simple 的 `thead tr{border-bottom:2px}` 反而会赢，必须连行与行组一起清。
 * 用 none（宽度算 0、又不像 hidden 那样压制邻居）清，单元格自己的线不受影响。
 */
const ROW_GROUPS = [`${TABLE} tr`, `${TABLE} thead`, `${TABLE} tbody`, `${TABLE} tfoot`];

export interface TableStyle {
  id: string;
  label: string;
  desc: string;
  /** [选择器组, 声明（不带结尾分号与 !important）] */
  rules: Array<[string[], string[]]>;
}

/** 框线配方的共同起点：把主题原有的外框、圆角、阴影、竖线、行线统统归零 */
const LINE_RESET: Array<[string[], string[]]> = [
  [[TABLE], [
    'border-collapse: collapse', 'border-spacing: 0', 'border: none',
    'border-radius: 0', 'box-shadow: none', 'overflow: visible',
  ]],
  [CELLS, ['border: none']],
  [ROW_GROUPS, ['border: none']],
];

/**
 * 框线：只管线，不碰任何底色。
 * 每份配方都从 LINE_RESET 起步——三个分支的底子差别很大（crab 是圆角外框加竖线，
 * classic 是横线，simple 是圆角加行线），不归零的话换出来的效果会因主题而异。
 * 同一选择器里后写的声明胜，所以各配方只需在 reset 之后补自己要的那几条。
 */
export const TABLE_BORDERS: TableStyle[] = [
  {
    id: 'none', label: '无框线', desc: '一条线都不画，只靠留白分隔',
    rules: [...LINE_RESET],
  },
  {
    id: 'head', label: '仅表头线', desc: '表头下一条线，正文完全无线',
    rules: [...LINE_RESET, [HEAD_CELLS, [`border-bottom: 1px solid ${LINE}`]]],
  },
  {
    id: 'three', label: '三线', desc: '论文常用：顶线、表头线、底线',
    rules: [
      ...LINE_RESET,
      [[TABLE], [`border-top: 2px solid ${LINE_STRONG}`, `border-bottom: 2px solid ${LINE_STRONG}`]],
      [HEAD_CELLS, [`border-bottom: 1px solid ${LINE_STRONG}`]],
    ],
  },
  {
    id: 'rows', label: '横线', desc: '行与行之间都有横线，没有竖线',
    rules: [
      ...LINE_RESET,
      [CELLS, [`border-bottom: 1px solid ${LINE_SOFT}`]],
      [HEAD_CELLS, [`border-bottom: 2px solid ${LINE}`]],
    ],
  },
  {
    id: 'grid', label: '全框线', desc: '每格四边都有线，最接近表格软件',
    rules: [
      ...LINE_RESET,
      [[TABLE], [`border: 1px solid ${LINE}`]],
      [CELLS, [`border: 1px solid ${LINE}`]],
      [HEAD_CELLS, [`border-bottom: 2px solid ${LINE}`]],
    ],
  },
  {
    id: 'outer', label: '仅外框', desc: '整表一圈直角边框，内部无线',
    rules: [
      ...LINE_RESET,
      [[TABLE], [`border: 1px solid ${LINE}`]],
      [HEAD_CELLS, [`border-bottom: 1px solid ${LINE}`]],
    ],
  },
  {
    id: 'card', label: '圆角卡片', desc: '圆角外框加浅阴影，行间淡线分隔',
    rules: [
      ...LINE_RESET,
      [[TABLE], [
        'border-collapse: separate', `border: 1px solid ${LINE}`,
        'border-radius: 10px', 'overflow: hidden', CARD_SHADOW,
      ]],
      [CELLS, [`border-bottom: 1px solid ${LINE_SOFT}`]],
      [LAST_ROW, ['border-bottom: none']],
      [HEAD_CELLS, [`border-bottom: 1px solid ${LINE}`]],
    ],
  },
];

/** 底色配方的共同起点：清掉表格面板底、表头底、以及 classic 画在 td、simple 画在 tr 上的隔行底色 */
const FILL_RESET: Array<[string[], string[]]> = [
  // crab.dark 给表格铺了 2% 白底 + 磨砂，"无底色"必须连它一起清
  [[TABLE], ['background: transparent', 'backdrop-filter: none']],
  [CELLS, ['background: transparent']],
  [ROW_GROUPS, ['background: transparent']],
  [THEAD_ROW, ['background: transparent']],
  [BODY_ROWS, ['background: transparent']],
];
/** 悬停高亮：权重高于上面的清零与斑马纹，也高于三个分支各自的 hover 规则 */
const HOVER_ROW: [string[], string[]] = [HOVER_CELLS, [`background: ${HOVER_BG}`, 'box-shadow: none']];

/** 底色：只管填充，不碰任何线条 */
export const TABLE_FILLS: TableStyle[] = [
  {
    id: 'none', label: '无底色', desc: '表头与正文都透明，只留线条',
    rules: [...FILL_RESET, HOVER_ROW],
  },
  {
    id: 'head', label: '表头底色', desc: '只给表头一层淡底，正文透明',
    rules: [...FILL_RESET, [HEAD_CELLS, [`background: ${HEAD_BG}`]], HOVER_ROW],
  },
  {
    id: 'zebra', label: '斑马纹', desc: '隔行底色，宽表格里不容易看错行',
    rules: [...FILL_RESET, [EVEN_ROWS, [`background: ${ZEBRA_BG}`]], HOVER_ROW],
  },
  {
    id: 'headZebra', label: '表头底色 + 斑马纹', desc: '表头淡底，正文隔行底色',
    rules: [
      ...FILL_RESET,
      [HEAD_CELLS, [`background: ${HEAD_BG}`]],
      [EVEN_ROWS, [`background: ${ZEBRA_BG}`]],
      HOVER_ROW,
    ],
  },
];


export const FIELDS: Record<FieldId, FieldDef> = {
  fontFamily: { label: '字体', kind: 'font', css: 'font-family', min: 0, max: 0, step: 0 },
  rootFontSize: {
    label: '全局缩放基准', kind: 'length', css: 'font-size', units: ['px'],
    min: 10, max: 26, step: 0.5, tip: 'html 根字号；标题等用 rem 的尺寸会随之整体缩放',
  },
  fontSize: {
    label: '字号', kind: 'length', css: 'font-size', units: ['px', 'rem', 'em'],
    min: 8, max: 64, step: 0.5, ranges: { rem: [0.5, 4, 0.05], em: [0.5, 4, 0.05] },
    tip: 'px / rem 最稳；em 相对父级，多层结构里会层层相乘',
  },
  fontWeight: { label: '字重', kind: 'weight', css: 'font-weight', min: 200, max: 900, step: 100 },
  fontStyle: {
    label: '字形', kind: 'segment', css: 'font-style', min: 0, max: 0, step: 0,
    options: [['normal', '正常'], ['italic', '斜体']],
  },
  lineHeight: {
    label: '行间距', kind: 'number', css: 'line-height',
    min: 0.8, max: 4, step: 0.05, neutral: 1.5, tip: '行高倍数，1.8 ≈ 中文舒适阅读',
  },
  letterSpacing: {
    label: '字间距', kind: 'length', css: 'letter-spacing', units: ['px', 'em'],
    min: -2, max: 10, step: 0.05, ranges: { em: [-0.15, 0.6, 0.005] },
  },
  wordSpacing: {
    label: '词间距', kind: 'length', css: 'word-spacing', units: ['px', 'em'],
    min: -4, max: 20, step: 0.5, ranges: { em: [-0.3, 1.2, 0.02] },
  },
  textIndent: {
    label: '首行缩进', kind: 'length', css: 'text-indent', units: ['em', 'px'],
    min: 0, max: 8, step: 0.5, ranges: { px: [0, 120, 1] },
  },
  textAlign: {
    label: '对齐', kind: 'segment', css: 'text-align', min: 0, max: 0, step: 0,
    options: [['left', '左'], ['center', '中'], ['right', '右'], ['justify', '两端']],
  },
  marginTop: {
    label: '段前距', kind: 'length', css: 'margin-top', units: ['px', 'em', 'rem'],
    min: 0, max: 96, step: 1, ranges: { em: [0, 6, 0.05], rem: [0, 6, 0.05] },
  },
  marginBottom: {
    label: '段后距', kind: 'length', css: 'margin-bottom', units: ['px', 'em', 'rem'],
    min: 0, max: 96, step: 1, ranges: { em: [0, 6, 0.05], rem: [0, 6, 0.05] },
  },
  itemGap: {
    label: '列表项间距', kind: 'length', css: 'margin-block', read: 'margin-block-start',
    units: ['px', 'em'], min: 0, max: 40, step: 1, ranges: { em: [0, 2.5, 0.05] },
  },
  cellPadY: {
    label: '单元格上下内边距', kind: 'length', css: 'padding-block', read: 'padding-block-start',
    units: ['px', 'em'], min: 0, max: 40, step: 1, ranges: { em: [0, 2.5, 0.05] },
  },
  cellPadX: {
    label: '单元格左右内边距', kind: 'length', css: 'padding-inline', read: 'padding-inline-start',
    units: ['px', 'em'], min: 0, max: 60, step: 1, ranges: { em: [0, 4, 0.05] },
  },
  tableBorder: {
    label: '框线', kind: 'preset', css: '', min: 0, max: 0, step: 0,
    options: TABLE_BORDERS.map((s) => [s.id, s.label, s.desc]),
    tip: '只换线条，不动底色；线色由正文色兑出，浅色 / 深色主题都合用',
  },
  tableFill: {
    label: '底色', kind: 'preset', css: '', min: 0, max: 0, step: 0,
    options: TABLE_FILLS.map((s) => [s.id, s.label, s.desc]),
    tip: '只换填充，不动线条；表头底色取自表头文字色，会跟着主题的强调色走',
  },
  maxWidth: { label: '版心宽度', kind: 'length', css: 'max-width', units: ['px'], min: 400, max: 1800, step: 10 },
  pagePadding: {
    label: '版心左右留白', kind: 'length', css: 'padding-inline', read: 'padding-inline-start',
    units: ['px', 'em'], min: 0, max: 200, step: 2, ranges: { em: [0, 12, 0.1] },
  },
};

export interface FontStack {
  label: string;
  value: string;
  /** 用于检测本机是否装了该字体 */
  probe?: string;
}

export const FONT_STACKS: FontStack[] = [
  { label: 'HarmonyOS Sans SC · 鸿蒙黑体', value: '"HarmonyOS Sans SC", sans-serif', probe: 'HarmonyOS Sans SC' },
  { label: 'MapleMonoNormalNL · 枫叶等宽', value: '"MapleMonoNormalNL", monospace', probe: 'MapleMonoNormalNL' },
  { label: 'Pretendard', value: '"Pretendard", sans-serif', probe: 'Pretendard' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace', probe: 'JetBrains Mono' },
  { label: 'LXGW WenKai · 霞鹜文楷', value: '"LXGW WenKai", "LXGW WenKai GB", serif', probe: 'LXGW WenKai' },
  { label: 'Microsoft YaHei · 微软雅黑', value: '"Microsoft YaHei", sans-serif', probe: 'Microsoft YaHei' },
  { label: 'PingFang SC · 苹方', value: '"PingFang SC", sans-serif', probe: 'PingFang SC' },
  { label: 'Source Han Sans SC · 思源黑体', value: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif', probe: 'Source Han Sans SC' },
  { label: 'Source Han Serif SC · 思源宋体', value: '"Source Han Serif SC", "Noto Serif CJK SC", serif', probe: 'Source Han Serif SC' },
  { label: 'SimSun · 宋体', value: 'SimSun, "Songti SC", serif', probe: 'SimSun' },
  { label: 'SimHei · 黑体', value: 'SimHei, "Heiti SC", sans-serif', probe: 'SimHei' },
  { label: 'KaiTi · 楷体', value: 'KaiTi, STKaiti, serif', probe: 'KaiTi' },
  { label: 'FangSong · 仿宋', value: 'FangSong, STFangsong, serif', probe: 'FangSong' },
  { label: 'DengXian · 等线', value: 'DengXian, sans-serif', probe: 'DengXian' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif', probe: 'Times New Roman' },
  { label: 'Georgia', value: 'Georgia, serif', probe: 'Georgia' },
  { label: 'Segoe UI', value: '"Segoe UI", sans-serif', probe: 'Segoe UI' },
  { label: 'Inter', value: 'Inter, sans-serif', probe: 'Inter' },
  { label: 'Consolas', value: 'Consolas, monospace', probe: 'Consolas' },
  { label: 'Cascadia Code', value: '"Cascadia Code", monospace', probe: 'Cascadia Code' },
  { label: 'Fira Code', value: '"Fira Code", monospace', probe: 'Fira Code' },
  { label: '系统无衬线 sans-serif', value: 'sans-serif' },
  { label: '系统衬线 serif', value: 'serif' },
  { label: '系统等宽 monospace', value: 'monospace' },
];

const TEXT_FIELDS: FieldId[] = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing'];
const HEADING_FIELDS: FieldId[] = [...TEXT_FIELDS, 'textAlign', 'marginTop', 'marginBottom'];
const BODY_FIELDS: FieldId[] = [...TEXT_FIELDS, 'wordSpacing', 'textIndent', 'textAlign', 'marginTop', 'marginBottom'];
const HEADING_ICONS = ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6'];

export const TARGETS: TargetDef[] = [
  {
    id: 'base', name: '全局版心', icon: 'LayoutPanelLeft',
    tip: '#write 容器本身，是所有块级内容的继承源',
    sel: ['#write'], probe: '#write',
    fields: ['fontFamily', 'rootFontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'maxWidth', 'pagePadding'],
    selFor: { rootFontSize: ['html'] },
    vars: { fontFamily: ['--font-sans-serif'] },
  },
  {
    id: 'p', name: '正文段落', icon: 'Pilcrow',
    tip: '#write p；引用块与列表里的段落由各自条目单独控制',
    sel: ['#write p'], fields: BODY_FIELDS,
  },
  ...HEADING_ICONS.map((icon, i) => ({
    id: `h${i + 1}`, name: `标题 H${i + 1}`, icon,
    tip: `#write h${i + 1}`, sel: [`#write h${i + 1}`], fields: HEADING_FIELDS,
    alignByMargin: true,
    alignByShrink: i >= 2,
    tipFor: {
      textAlign: i >= 2
        ? '对齐会连左侧竖条 / 圆点一起挪走：居中与右对齐时先把盒子收到文字宽度，再用自动外边距搬整块'
        : 'crab / crab-plus 的 H1 / H2 盒子只有文字那么宽，靠自动外边距整块挪动；classic / simple 里标题占满整行，只有文字换位置',
    },
  })),
  {
    id: 'blockquote', name: '引用块', icon: 'Quote', tip: '引用块容器与其中的段落',
    sel: ['#write blockquote', '#write blockquote p'], probe: '#write blockquote',
    fields: BODY_FIELDS,
    unitsFor: { fontSize: ['px', 'rem'] },
    selFor: {
      marginTop: ['#write blockquote'], marginBottom: ['#write blockquote'],
      textIndent: ['#write blockquote p'],
    },
  },
  {
    id: 'list', name: '列表', icon: 'List',
    tip: '有序 / 无序列表；Typora 会把列表项正文包在 section 里',
    sel: ['#write li', '#write li section', '#write li p'], probe: '#write li',
    fields: [...TEXT_FIELDS, 'textAlign', 'itemGap', 'marginTop', 'marginBottom'],
    unitsFor: { fontSize: ['px', 'rem'] },
    selFor: {
      marginTop: ['#write ul', '#write ol'], marginBottom: ['#write ul', '#write ol'],
      itemGap: ['#write li section', '#write li p'],
    },
  },
  {
    id: 'fences', name: '代码块', icon: 'Code', tip: '围栏代码块（含 CodeMirror 编辑态）',
    sel: [
      '#write .md-fences', '#write pre.md-fences', '#write .md-fences code',
      '#write .md-fences .CodeMirror', '#write .cm-s-inner.CodeMirror', '#write .md-fences .CodeMirror pre',
    ],
    probe: '#write .md-fences',
    fields: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'marginTop', 'marginBottom'],
    unitsFor: { fontSize: ['px', 'rem'] },
    selFor: {
      marginTop: ['#write .md-fences', '#write pre.md-fences'],
      marginBottom: ['#write .md-fences', '#write pre.md-fences'],
    },
    vars: { fontFamily: ['--font-monospace'] },
  },
  {
    id: 'code', name: '行内代码', icon: 'Braces', tip: '段落中的 `code`（不含代码块内部）',
    sel: ['#write code:not(.md-fencescode)', '#write tt'], probe: '#write code:not(.md-fencescode)',
    fields: ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing'],
  },
  {
    id: 'table', name: '表格', icon: 'Table', tip: '表格整体与单元格',
    sel: ['#write table', '#write table td', '#write table th'], probe: '#write table',
    fields: ['tableBorder', 'tableFill', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'marginTop', 'marginBottom', 'cellPadY', 'cellPadX'],
    selFor: {
      marginTop: ['#write table'], marginBottom: ['#write table'],
      cellPadY: ['#write table td', '#write table th'],
      cellPadX: ['#write table td', '#write table th'],
    },
  },
];

export const TARGET_MAP: Record<string, TargetDef> = Object.fromEntries(TARGETS.map((t) => [t.id, t]));

export function selectorsFor(target: TargetDef, field: FieldId): string[] {
  return target.selFor?.[field] ?? target.sel;
}

export function unitsFor(target: TargetDef, field: FieldId): string[] {
  return target.unitsFor?.[field] ?? FIELDS[field].units ?? [];
}

export interface Preset {
  id: string;
  name: string;
  desc: string;
  values: Values;
}

export const PRESETS: Preset[] = [
  { id: 'theme', name: '主题默认', desc: '清空全部覆盖，完全沿用当前主题', values: {} },
  {
    id: 'compact', name: '紧凑', desc: '收紧行高与段距，一屏容纳更多内容',
    values: {
      base: { lineHeight: '1.55', letterSpacing: '0px', wordSpacing: '0px' },
      p: { lineHeight: '1.6', marginTop: '6px', marginBottom: '6px', wordSpacing: '0px' },
      h1: { lineHeight: '1.3', marginTop: '0.7em', marginBottom: '0.45em' },
      h2: { marginTop: '14px', marginBottom: '10px' },
      h3: { marginTop: '12px', marginBottom: '8px' },
      h4: { marginTop: '12px', marginBottom: '8px' },
      h5: { marginTop: '12px', marginBottom: '8px' },
      h6: { marginTop: '12px', marginBottom: '8px' },
      blockquote: { lineHeight: '1.5', marginTop: '10px', marginBottom: '10px' },
      list: { lineHeight: '1.6', itemGap: '2px' },
      fences: { lineHeight: '1.5', marginTop: '12px', marginBottom: '12px' },
      table: { lineHeight: '1.45', cellPadY: '5px', cellPadX: '9px' },
    },
  },
  {
    id: 'relaxed', name: '舒适阅读', desc: '放宽行高与段距，长时间阅读更轻松',
    values: {
      base: { lineHeight: '2.1', letterSpacing: '0.02em' },
      p: { fontSize: '16.5px', lineHeight: '2', marginTop: '12px', marginBottom: '12px' },
      blockquote: { lineHeight: '1.9' },
      list: { lineHeight: '1.95', itemGap: '6px' },
      table: { lineHeight: '1.7' },
    },
  },
  {
    id: 'cn-long', name: '中文长文', desc: '首行缩进 2em + 两端对齐',
    values: {
      base: { lineHeight: '1.95', letterSpacing: '0.03em', wordSpacing: '0px' },
      p: { lineHeight: '1.95', textIndent: '2em', textAlign: 'justify', marginTop: '8px', marginBottom: '8px' },
      blockquote: { textIndent: '2em', textAlign: 'justify' },
      list: { textAlign: 'justify' },
    },
  },
  {
    id: 'paper', name: '论文打印', desc: '宋体 / Times 正文 + 黑体标题',
    values: {
      base: { fontFamily: '"Times New Roman", SimSun, serif', lineHeight: '1.75', letterSpacing: '0px', maxWidth: '780px' },
      p: {
        fontFamily: '"Times New Roman", SimSun, serif', fontSize: '16px', lineHeight: '1.75',
        wordSpacing: '0px', textIndent: '2em', textAlign: 'justify', marginTop: '6px', marginBottom: '6px',
      },
      h1: { fontFamily: 'SimHei, "Microsoft YaHei", sans-serif', fontSize: '1.6rem' },
      h2: { fontFamily: 'SimHei, "Microsoft YaHei", sans-serif', fontSize: '1.3rem' },
      h3: { fontFamily: 'SimHei, "Microsoft YaHei", sans-serif', fontSize: '1.15rem' },
      table: { fontSize: '14px', lineHeight: '1.6' },
    },
  },
  {
    id: 'large', name: '大字护眼', desc: '整体放大字号，减轻视觉负担',
    values: {
      base: { rootFontSize: '17px', lineHeight: '2.15' },
      p: { fontSize: '18px', lineHeight: '2.05', letterSpacing: '0.02em' },
      blockquote: { fontSize: '17px', lineHeight: '1.9' },
      list: { fontSize: '18px', lineHeight: '2' },
      fences: { fontSize: '15px' },
      code: { fontSize: '0.95em' },
      table: { fontSize: '15.5px' },
    },
  },
];
