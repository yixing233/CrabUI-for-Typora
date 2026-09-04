/**
 * 覆盖 CSS 的生成与数值工具：只输出用户显式改过的属性，统一带 !important。
 */

import { FIELDS, TABLE_BORDERS, TABLE_FILLS, TARGETS, TARGET_MAP, selectorsFor } from './model';
import type { FieldDef, FieldId, TableStyle, Values } from './model';

export const MARKER_BEGIN = '/* ==== crab-typography:begin · 由 CrabUI for Typora 生成，请勿手改此区块 ==== */';
export const MARKER_END = '/* ==== crab-typography:end ==== */';

/** 挡掉能撑破 CSS 规则的字符；只保留白名单里的段落 / 属性 */
export function sanitizeValues(input: unknown): Values {
  const out: Values = {};
  if (!input || typeof input !== 'object') return out;
  for (const [tid, bag] of Object.entries(input as Record<string, unknown>)) {
    // 手改的 crab-typography.json 里可能出现 __proto__ / constructor 这种键，
    // 直接下标会顺着原型链摸到 Object.prototype，必须先确认是自有属性
    if (!Object.prototype.hasOwnProperty.call(TARGET_MAP, tid)) continue;
    const target = TARGET_MAP[tid];
    if (!target || !bag || typeof bag !== 'object') continue;
    const clean: Partial<Record<FieldId, string>> = {};
    for (const field of target.fields) {
      const raw = (bag as Record<string, unknown>)[field];
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value || value.length > 160) continue;
      if (/[{}<>;\\]|\/\*|\*\/|[\r\n]|@import|url\s*\(|expression\s*\(/i.test(value)) continue;
      clean[field] = value;
    }
    if (Object.keys(clean).length) out[tid] = clean;
  }
  return out;
}

export function countOverrides(values: Values): number {
  return Object.values(values).reduce((n, bag) => n + Object.keys(bag).length, 0);
}

export function targetCount(values: Values, targetId: string): number {
  return Object.keys(values[targetId] ?? {}).length;
}

/**
 * 对齐值 → [margin-left, margin-right]。
 * 盒子是 width:fit-content 时，只有自动外边距能把整块标题挪到左 / 中 / 右；
 * 盒子撑满一行时 auto 会算成 0，等于什么都没做。
 */
const ALIGN_MARGINS = new Map<string, [string, string]>([
  ['left', ['0', 'auto']],
  ['start', ['0', 'auto']],
  ['justify', ['0', 'auto']],
  ['center', ['auto', 'auto']],
  ['right', ['auto', '0']],
  ['end', ['auto', '0']],
]);

/**
 * 需要把盒子收到文字宽度的对齐值（配合 alignByShrink）。
 * 左对齐 / 两端对齐保持整行宽度就够了：盒子本来就靠左，收缩它只会让整行宽的装饰白挨一刀。
 */
const SHRINK_ALIGNS = new Set(['center', 'right', 'end']);

/** 字段 → 配方目录；两层都用 Map，手改配置里的 __proto__ 之类查不到东西 */
const RECIPES = new Map<string, Map<string, TableStyle>>([
  ['tableBorder', new Map(TABLE_BORDERS.map((s) => [s.id, s]))],
  ['tableFill', new Map(TABLE_FILLS.map((s) => [s.id, s]))],
]);

/** 只输出用户显式改过的属性，其余沿用主题原值 */
export function buildCss(values: Values): string {
  const blocks: string[] = [];
  const vars: string[] = [];

  for (const target of TARGETS) {
    const bag = values[target.id];
    if (!bag) continue;
    const groups = new Map<string, string[]>();
    // 按 target.fields 的固定顺序遍历，而不是 bag 的键序：
    // 键序取决于用户先改了哪一项，会让"配方的 th 字重"和"用户设的字重"这类同权重冲突
    // 随编辑顺序翻转，重启前后还不一致。固定顺序下配方总在前，用户的单项设置总能压住它。
    for (const field of target.fields) {
      const value = bag[field];
      if (typeof value !== 'string') continue;
      const def = Object.prototype.hasOwnProperty.call(FIELDS, field) ? FIELDS[field] : undefined;
      if (!def || !value) continue;
      const push = (sels: string[], decls2: string[]) => {
        const k = sels.join(',\n');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(...decls2.map((d) => `    ${d} !important;`));
      };
      // 框线 / 底色是一整套规则（含伪类），不是单个属性，走自己的分支
      const catalog = RECIPES.get(field);
      if (catalog) {
        const recipe = catalog.get(value);
        if (recipe) for (const [sels, decls2] of recipe.rules) push(sels, decls2);
        continue;
      }
      const key = selectorsFor(target, field).join(',\n');
      if (!groups.has(key)) groups.set(key, []);
      const decls = groups.get(key)!;
      decls.push(`    ${def.css}: ${value} !important;`);
      if (field === 'textAlign' && target.alignByMargin) {
        const pair = ALIGN_MARGINS.get(value);
        if (pair) {
          decls.push(`    margin-left: ${pair[0]} !important;`, `    margin-right: ${pair[1]} !important;`);
          if (target.alignByShrink && SHRINK_ALIGNS.has(value)) {
            decls.push('    width: fit-content !important;');
          }
        }
      }
      for (const name of target.vars?.[field] ?? []) vars.push(`    ${name}: ${value} !important;`);
    }
    if (!groups.size) continue;
    blocks.push(`/* ${target.name} */`);
    for (const [key, decls] of groups) blocks.push(`${key} {\n${decls.join('\n')}\n}`);
  }

  if (vars.length) {
    blocks.unshift(`/* 主题字体族变量（crab-simple 系列用得到） */\n:root {\n${vars.join('\n')}\n}`);
  }
  return blocks.join('\n\n');
}

/** 带说明头的完整 CSS 文件内容 */
export function exportCss(values: Values, themeName: string): string {
  const body = buildCss(values);
  const header = [
    `/* CrabUI for Typora · 导出于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    ` * 主题：${themeName || '未知'}`,
    ' *',
    ' * 用法一：放在 themes/crab-typography.css，并在 themes/base.user.css 里 @import 本文件。',
    ' * 用法二：整段追加到所用主题 .css 末尾——导出 HTML / PDF 时也会带上这套排版。',
    ' */',
    '',
  ].join('\n');
  return `${header}${body || '/* 当前没有任何自定义项，全部沿用主题默认排版。 */'}\n`;
}

export interface Limits {
  min: number;
  max: number;
  step: number;
}

/** 同一属性在不同单位下量级不同，滑块范围要跟着单位切换 */
export function limitsFor(field: FieldDef, unit: string): Limits {
  const r = field.ranges?.[unit];
  return r ? { min: r[0], max: r[1], step: r[2] } : { min: field.min, max: field.max, step: field.step };
}

export function splitLength(value: string | undefined, fallbackUnit = ''): { num: number; unit: string } | null {
  const m = /^(-?\d*\.?\d+)\s*([a-z%]*)$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  return { num: parseFloat(m[1]), unit: m[2] || fallbackUnit };
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 统一"先折成 px 再出目标单位"；baseOf 给出 em / rem 的换算基准 */
export function convertUnit(n: number, from: string, to: string, baseOf: (unit: string) => number): number {
  const scalable = ['px', 'em', 'rem'];
  if (from === to || !scalable.includes(from) || !scalable.includes(to)) return n;
  const px = from === 'px' ? n : n * baseOf(from);
  return round(to === 'px' ? px : px / baseOf(to));
}

export function clampTo(n: number, limits: Limits): number {
  return Math.min(limits.max, Math.max(limits.min, round(n, 3)));
}
