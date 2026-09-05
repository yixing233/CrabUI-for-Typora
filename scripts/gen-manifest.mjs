/**
 * 生成 themes/manifest.json——应用里的「主题在线更新」靠它比对本地文件。
 *
 * 每个条目只有 path / sha256 / size / kind，故意没有 baseUrl：下载地址一律相对
 * manifest 自己的 URL 解析，源头只有一处，也堵掉了「manifest 把下载指向别的主机」。
 *
 * 这里的路径规则必须与 Rust 侧 fsops::resolve_asset_in_dir 一致——那边是安全边界，
 * 这边先拦一道，免得生成了一份注定被拒的清单：
 *   · 每段只允许 [A-Za-z0-9._- ] 和空格，不允许 . 或 .. 段
 *   · 最多两层（crab/x.woff2 可以，a/b/c.css 不行）
 *   · 扩展名必须与 kind 对得上
 *
 * 用法：
 *   node scripts/gen-manifest.mjs                      # 沿用现有版本号，重算哈希
 *   node scripts/gen-manifest.mjs --version 1.1.0 --notes "修正表格行线"
 *   node scripts/gen-manifest.mjs --check              # 只校验，内容有出入就非零退出（CI 用）
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = join(ROOT, 'themes');
const MANIFEST = join(THEMES, 'manifest.json');

/** 扩展名 → kind。不在表里的一律不进 manifest（两个 Crab Theme Studio 页面就是这么被挡下的）。 */
const KIND_OF_EXT = {
  '.css': 'theme',
  '.woff2': 'font',
  '.woff': 'font',
  '.ttf': 'font',
  '.otf': 'font',
  '.md': 'doc',
  '.js': 'script',
  '.ps1': 'script',
};

/** manifest 自身与应用写在 themes 目录里的运行时文件，都不该出现在清单里。 */
const SKIP_NAMES = new Set(['manifest.json', 'crab-typography.json', 'crab-typography.css']);
const SKIP_SUFFIX = ['.crab-bak', '.crab-dl'];

const MAX_DEPTH = 2;
const SEGMENT_OK = /^[A-Za-z0-9._\- ]+$/;

function parseArgs(argv) {
  const out = { check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') out.check = true;
    else if (arg === '--version') out.version = argv[++i];
    else if (arg === '--notes') out.notes = argv[++i];
    else if (arg === '--released') out.released = argv[++i];
    else {
      console.error(`未知参数：${arg}`);
      process.exit(2);
    }
  }
  return out;
}

/** 取最后一个扩展名并转小写；MapleMonoNormalNL-Bold.ttf.woff2 要判成 .woff2 而不是 .ttf。 */
function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function shouldSkip(name) {
  return SKIP_NAMES.has(name) || SKIP_SUFFIX.some((s) => name.endsWith(s));
}

/** 递归收集相对 themes/ 的路径（正斜杠），顺手把不合规的路径挑出来。 */
function walk(dir, prefix, depth, found, skipped, bad) {
  if (depth > MAX_DEPTH) {
    bad.push(`${prefix} 超过 ${MAX_DEPTH} 层，应用会拒绝这一层里的文件`);
    return;
  }
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (!SEGMENT_OK.test(name)) {
      bad.push(`${rel} 里有应用不接受的字符（只允许字母、数字、点、下划线、连字符、空格）`);
      continue;
    }
    if (statSync(abs).isDirectory()) {
      walk(abs, rel, depth + 1, found, skipped, bad);
      continue;
    }
    if (shouldSkip(name)) continue;
    const kind = KIND_OF_EXT[extOf(name)];
    if (!kind) {
      skipped.push(rel);
      continue;
    }
    const body = readFileSync(abs);
    found.push({
      path: rel,
      sha256: createHash('sha256').update(body).digest('hex'),
      size: body.length,
      kind,
    });
  }
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readExisting() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return {};
  }
}

const args = parseArgs(process.argv.slice(2));
const previous = readExisting();

const files = [];
const skipped = [];
const bad = [];
walk(THEMES, '', 1, files, skipped, bad);

if (bad.length) {
  console.error('themes/ 里有应用无法接受的路径，先改名再生成：');
  for (const line of bad) console.error(`  · ${line}`);
  process.exit(1);
}
if (!files.length) {
  console.error(`themes/ 里没有可发布的文件：${THEMES}`);
  process.exit(1);
}

files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const manifest = {
  schema: 1,
  version: args.version ?? previous.version ?? '1.0.0',
  released: args.released ?? today(),
  notes: args.notes ?? previous.notes ?? '',
  files,
};

/**
 * 逐路径比对，给出人能看懂的差异（--check 用）。
 * 只看 files——version / released / notes 是人写的，不该因为它们变了就让 CI 红。
 */
function diffFiles(prev, next) {
  const lines = [];
  const before = new Map((prev ?? []).map((f) => [f.path, f]));
  for (const f of next) {
    const old = before.get(f.path);
    if (!old) lines.push(`+ ${f.path}（themes/ 里新增，manifest 里还没有）`);
    else if (old.sha256 !== f.sha256) lines.push(`~ ${f.path}（内容变了，manifest 里的哈希是旧的）`);
    else if (old.size !== f.size) lines.push(`~ ${f.path}（体积对不上）`);
    before.delete(f.path);
  }
  for (const path of before.keys()) lines.push(`- ${path}（manifest 里有，themes/ 里已经没了）`);
  return lines;
}

if (args.check) {
  const lines = diffFiles(previous.files, files);
  if (lines.length) {
    console.error('themes/manifest.json 与 themes/ 的实际内容不一致，请重跑 npm run manifest：');
    for (const line of lines) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`manifest 与 themes/ 一致：${files.length} 个文件，版本 ${previous.version ?? '未标注'}`);
  process.exit(0);
}

const KIND_LABEL = { theme: '主题', font: '字体', doc: '文档', script: '脚本' };

function human(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const changed = diffFiles(previous.files, files);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

const byKind = new Map();
for (const f of files) {
  const acc = byKind.get(f.kind) ?? { count: 0, size: 0 };
  acc.count += 1;
  acc.size += f.size;
  byKind.set(f.kind, acc);
}

console.log(`已写入 themes/manifest.json —— 版本 ${manifest.version}，发布日期 ${manifest.released}`);
for (const [kind, acc] of [...byKind].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  console.log(`  ${KIND_LABEL[kind] ?? kind}：${acc.count} 个，${human(acc.size)}`);
}
console.log(`  合计：${files.length} 个，${human(files.reduce((n, f) => n + f.size, 0))}`);

if (changed.length) {
  console.log(`与上一份 manifest 相比有 ${changed.length} 处变化：`);
  for (const line of changed) console.log(`  ${line}`);
} else if (previous.files) {
  console.log('文件内容与上一份 manifest 完全相同。');
}
if (skipped.length) {
  console.log(`跳过 ${skipped.length} 个不在白名单里的文件（不随更新分发）：`);
  for (const path of skipped) console.log(`  · ${path}`);
}
