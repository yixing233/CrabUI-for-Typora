/**
 * 与 Rust 侧命令的唯一接口层。所有文件读写都走这里，前端不直接碰文件系统。
 */

import { invoke } from '@tauri-apps/api/core';

export type ThemeFlavor = 'plus' | 'classic' | 'simple' | 'other';

export interface ThemeEntry {
  /** 文件名，例如 crab-plus-blue.css */
  file: string;
  /** 展示名，例如 crab-plus-blue */
  name: string;
  flavor: ThemeFlavor;
  dark: boolean;
  /** 该主题文件里是否已经写入过我们的标记区块 */
  patched: boolean;
}

export interface ThemesInfo {
  /** themes 目录绝对路径（正斜杠） */
  dir: string;
  themes: ThemeEntry[];
  /** themes/base.user.css 是否存在 */
  hasBaseUserCss: boolean;
  /** base.user.css 里是否已 @import crab-typography.css */
  baseUserImports: boolean;
  /** themes/crab-typography.css 是否存在 */
  hasOverrideCss: boolean;
}

export interface PreviewCss {
  /** 已把 @import 递归内联、可直接塞进 <style> 的主题 CSS */
  css: string;
  /** 该主题文件所在目录，用于把相对 url() 换成可加载的绝对地址 */
  baseDir: string;
  dark: boolean;
}

/** 探测（或校验）themes 目录并列出 Crab 主题 */
export const detectThemes = (custom?: string | null) =>
  invoke<ThemesInfo>('detect_themes', { custom: custom ?? null });

/** 读主题 CSS 并内联其 @import */
export const readPreviewCss = (dir: string, file: string) =>
  invoke<PreviewCss>('read_preview_css', { dir, file });

/** 读 themes/crab-typography.json 原文（不存在返回 null） */
export const loadConfig = (dir: string) => invoke<string | null>('load_config', { dir });

export const saveConfig = (dir: string, json: string) => invoke<void>('save_config', { dir, json });

/** 写 themes/crab-typography.css，返回写入的绝对路径 */
export const writeOverrideCss = (dir: string, css: string) =>
  invoke<string>('write_override_css', { dir, css });

/** 幂等地在 themes/base.user.css 里加入 / 移除 @import "crab-typography.css" */
export const patchBaseUserCss = (dir: string, enable: boolean) =>
  invoke<string>('patch_base_user_css', { dir, enable });

/** 往主题 CSS 末尾的标记区块写入覆盖（css=null 表示移除区块）；首次写入前会生成 .crab-bak 备份 */
export const patchThemeCss = (dir: string, file: string, css: string | null) =>
  invoke<string>('patch_theme_css', { dir, file, css: css ?? null });

export interface TyporaInfo {
  /** Typora.exe 绝对路径（正斜杠）；没探到就是 null */
  exe: string | null;
  running: boolean;
}

export interface RestartResult {
  /** started=原本没开直接启动 · restarted=关掉又拉起 · blocked=没退出，没敢拉起 */
  outcome: 'started' | 'restarted' | 'blocked';
  exe: string;
  /** blocked 时 taskkill 说了什么，用来区分「有未保存文档」和「权限不足」 */
  detail: string;
}

/** 探 Typora 的安装位置与运行状态；typoraDir 为空时自动找 */
export const typoraInfo = (typoraDir?: string | null) =>
  invoke<TyporaInfo>('typora_info', { typoraDir: typoraDir ?? null });

/** 重启 Typora；force=false 时它有未保存文档会拦住自己，此时 outcome 为 blocked */
export const restartTypora = (typoraDir: string | null, force: boolean) =>
  invoke<RestartResult>('restart_typora', { typoraDir, force });

/** 在系统文件管理器里打开目录或文件所在目录 */
export const revealPath = (path: string) => invoke<void>('reveal_path', { path });
