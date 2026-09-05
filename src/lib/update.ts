/**
 * 在线更新界面用得到的纯逻辑：体积格式化、按分类分组、算出这次真正要下的文件。
 * 这里不碰 invoke，也不认识 React，好让单测直接跑。
 */

import type { AssetKind, UpdateItem, UpdateStatus } from './api';

/** 界面上的分类顺序：主题最常更新，脚本最需要犹豫，所以一头一尾 */
export const KIND_ORDER: AssetKind[] = ['theme', 'font', 'doc', 'script'];

export const KIND_LABEL: Record<AssetKind, string> = {
  theme: '主题',
  font: '字体',
  doc: '文档',
  script: '脚本',
};

/**
 * 默认勾上的分类。script 不在里面——crab-enhance.js 会被注入进 Typora 执行、
 * crab-inject.ps1 是 PowerShell 脚本，从网上更新它们等于让一次换主题变成一次代码执行。
 */
export const DEFAULT_KINDS: AssetKind[] = ['theme', 'font', 'doc'];

/**
 * 把配置文件里的 kinds 洗成合法值：这份 JSON 用户会手改、也会在用户之间拷贝，
 * 里面的字符串不该直接决定要下载哪一类文件。不是数组就回到默认，是数组就只留认识的、去重、按界面顺序排。
 * 空数组是用户的真实选择（一个都不下），照原样保留，不当成"没配置"。
 */
export function sanitizeKinds(raw: unknown): AssetKind[] {
  if (!Array.isArray(raw)) return [...DEFAULT_KINDS];
  const on = new Set(raw.filter((k): k is AssetKind => KIND_ORDER.includes(k as AssetKind)));
  return KIND_ORDER.filter((kind) => on.has(kind));
}

export const STATUS_LABEL: Record<UpdateStatus, string> = {
  new: '新增',
  changed: '有更新',
  same: '已是最新',
  rejected: '已拒绝',
};

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** 这次要下的文件：状态是 new 或 changed，且它的分类被勾上了 */
export function pickDownloads(items: UpdateItem[], kinds: AssetKind[]): UpdateItem[] {
  const on = new Set(kinds);
  return items.filter(
    (item) => on.has(item.kind) && (item.status === 'new' || item.status === 'changed'),
  );
}

export function totalSize(items: UpdateItem[]): number {
  return items.reduce((sum, item) => sum + item.size, 0);
}

export interface KindGroup {
  kind: AssetKind;
  items: UpdateItem[];
  counts: Record<UpdateStatus, number>;
  /** 该分类里 new + changed 合计多少字节 */
  pending: number;
}

const emptyCounts = (): Record<UpdateStatus, number> => ({
  new: 0,
  changed: 0,
  same: 0,
  rejected: 0,
});

/** 按分类分组，空分类不出现。组内保持清单里的顺序（生成器已经排过序）。 */
export function groupByKind(items: UpdateItem[]): KindGroup[] {
  const groups = new Map<AssetKind, KindGroup>();
  for (const item of items) {
    let group = groups.get(item.kind);
    if (!group) {
      group = { kind: item.kind, items: [], counts: emptyCounts(), pending: 0 };
      groups.set(item.kind, group);
    }
    group.items.push(item);
    group.counts[item.status] += 1;
    if (item.status === 'new' || item.status === 'changed') group.pending += item.size;
  }
  return KIND_ORDER.filter((kind) => groups.has(kind)).map((kind) => groups.get(kind)!);
}
