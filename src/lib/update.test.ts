import { describe, expect, it } from 'vitest';
import type { UpdateItem } from './api';
import {
  DEFAULT_KINDS,
  formatSize,
  groupByKind,
  pickDownloads,
  sanitizeKinds,
  totalSize,
} from './update';

const item = (
  path: string,
  kind: UpdateItem['kind'],
  status: UpdateItem['status'],
  size = 1024,
): UpdateItem => ({ path, kind, status, size });

describe('体积格式化', () => {
  it('按量级换单位', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(20480)).toBe('20.0 KB');
    expect(formatSize(2_621_440)).toBe('2.5 MB');
  });

  it('拿不准的输入不显示成 NaN', () => {
    expect(formatSize(Number.NaN)).toBe('—');
    expect(formatSize(-1)).toBe('—');
  });
});

describe('这次要下哪些文件', () => {
  const items = [
    item('crab-plus-blue.css', 'theme', 'changed', 20480),
    item('crab-plus-teal.css', 'theme', 'new', 20480),
    item('crab-classic-light.css', 'theme', 'same', 17280),
    item('crab/HarmonyOS_Sans_SC_Regular.woff2', 'font', 'changed', 1_258_291),
    item('README.md', 'doc', 'same', 10608),
    item('crab-enhance.js', 'script', 'changed', 34933),
    item('Crab Theme Studio.html', 'doc', 'rejected', 4096),
  ];

  it('只挑 new 和 changed，same 与 rejected 都不下', () => {
    const picked = pickDownloads(items, ['theme', 'font', 'doc', 'script']);
    expect(picked.map((i) => i.path)).toEqual([
      'crab-plus-blue.css',
      'crab-plus-teal.css',
      'crab/HarmonyOS_Sans_SC_Regular.woff2',
      'crab-enhance.js',
    ]);
  });

  it('默认不含脚本——那要用户自己开', () => {
    expect(DEFAULT_KINDS).not.toContain('script');
    const picked = pickDownloads(items, DEFAULT_KINDS);
    expect(picked.some((i) => i.kind === 'script')).toBe(false);
    expect(totalSize(picked)).toBe(20480 + 20480 + 1_258_291);
  });

  it('分类全关就是一个都不下', () => {
    expect(pickDownloads(items, [])).toEqual([]);
    expect(totalSize([])).toBe(0);
  });

  it('分组按固定顺序，空分类不出现，pending 只算要下的那些', () => {
    const groups = groupByKind(items);
    expect(groups.map((g) => g.kind)).toEqual(['theme', 'font', 'doc', 'script']);

    const themes = groups[0];
    expect(themes.counts).toEqual({ new: 1, changed: 1, same: 1, rejected: 0 });
    expect(themes.pending).toBe(40960);

    const docs = groups[2];
    expect(docs.counts).toEqual({ new: 0, changed: 0, same: 1, rejected: 1 });
    expect(docs.pending).toBe(0);

    expect(groupByKind([]).length).toBe(0);
    expect(groupByKind([item('a.css', 'theme', 'same')]).map((g) => g.kind)).toEqual(['theme']);
  });
});

describe('配置里读回来的 kinds', () => {
  it('不是数组就回到默认', () => {
    expect(sanitizeKinds(undefined)).toEqual(DEFAULT_KINDS);
    expect(sanitizeKinds(null)).toEqual(DEFAULT_KINDS);
    expect(sanitizeKinds('theme')).toEqual(DEFAULT_KINDS);
    expect(sanitizeKinds({ theme: true })).toEqual(DEFAULT_KINDS);
  });

  it('只留认识的、去重、按界面顺序排', () => {
    expect(sanitizeKinds(['doc', 'theme', 'theme'])).toEqual(['theme', 'doc']);
    expect(sanitizeKinds(['font', 42, 'nope', null, 'script'])).toEqual(['font', 'script']);
  });

  it('空数组是用户的真实选择，不当成没配置', () => {
    expect(sanitizeKinds([])).toEqual([]);
    expect(sanitizeKinds(['nope'])).toEqual([]);
  });

  it('返回的是新数组，改不到默认值本身', () => {
    const got = sanitizeKinds(undefined);
    got.push('script');
    expect(DEFAULT_KINDS).not.toContain('script');
  });
});
