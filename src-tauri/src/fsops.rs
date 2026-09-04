//! themes 目录的读写与路径校验。命令层只做参数转发，逻辑全部集中在这里以便单测。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 标记区块常量，逐字对应前端 src/lib/css.ts 的 MARKER_BEGIN / MARKER_END。
pub const MARKER_BEGIN: &str =
    "/* ==== crab-typography:begin · 由 CrabUI for Typora 生成，请勿手改此区块 ==== */";
pub const MARKER_END: &str = "/* ==== crab-typography:end ==== */";
/// patched 只认这个关键字，注释文案以后改了也不会误判。
const MARKER_TAG: &str = "crab-typography:begin";

pub const OVERRIDE_CSS: &str = "crab-typography.css";
pub const CONFIG_JSON: &str = "crab-typography.json";
pub const BASE_USER_CSS: &str = "base.user.css";
/// 主题文件的备份后缀，形如 crab-plus-blue.css.crab-bak。
pub const BAK_SUFFIX: &str = ".crab-bak";
/// 写进 base.user.css 的那一行。
pub const IMPORT_LINE: &str = "@import \"crab-typography.css\";";
const BASE_USER_HEADER: &str = "/* base.user.css · 由 CrabUI for Typora 维护 */";
/// @import 递归内联的最大层数（入口文件算第 0 层）。
const MAX_IMPORT_DEPTH: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEntry {
    pub file: String,
    pub name: String,
    pub flavor: String,
    pub dark: bool,
    pub patched: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemesInfo {
    pub dir: String,
    pub themes: Vec<ThemeEntry>,
    pub has_base_user_css: bool,
    pub base_user_imports: bool,
    pub has_override_css: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCss {
    pub css: String,
    pub base_dir: String,
    pub dark: bool,
}

// ---------------------------------------------------------------- 路径与校验

/// 统一成正斜杠，并去掉 Windows canonicalize 加的 \\?\ 前缀（前端拼 URL 用不了它）。
pub fn to_slash(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    if let Some(rest) = s.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }
    match s.strip_prefix("//?/") {
        Some(rest) => rest.to_string(),
        None => s,
    }
}

/// 目录必须存在且真的是目录，返回 canonicalize 后的绝对路径。
pub fn canonical_dir(dir: &str) -> Result<PathBuf, String> {
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        return Err("目录路径为空".to_string());
    }
    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(format!("目录不存在：{trimmed}"));
    }
    if !path.is_dir() {
        return Err(format!("不是目录：{trimmed}"));
    }
    fs::canonicalize(path).map_err(|e| format!("无法解析目录 {trimmed}：{e}"))
}

/// 文件名白名单：`^[A-Za-z0-9._\- ]+\.css$`（扩展名大小写不敏感），因此不可能带路径分隔符或 `..`。
fn is_plain_css_name(file: &str) -> bool {
    if file.is_empty() || file.contains("..") {
        return false;
    }
    let lower = file.to_ascii_lowercase();
    if !lower.ends_with(".css") || lower.len() == 4 {
        return false;
    }
    file.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

/// 允许写入 themes 目录的文件：我们自己的两个产物、base.user.css、主题 CSS 及其备份。
fn is_writable_name(name: &str) -> bool {
    name == CONFIG_JSON || name.ends_with(BAK_SUFFIX) || is_plain_css_name(name)
}

/// 拼路径并复核包含关系：文件名不含分隔符，canonicalize 后仍必须落在 dir 里（防符号链接外指）。
fn join_checked(dir: &str, name: &str) -> Result<PathBuf, String> {
    let base = canonical_dir(dir)?;
    let candidate = base.join(name);
    let inside = match fs::canonicalize(&candidate) {
        Ok(real) => real.starts_with(&base),
        // 文件还不存在（新建场景）：父目录必须正好是 dir
        Err(_) => candidate.parent() == Some(base.as_path()),
    };
    if !inside {
        return Err(format!("{name} 不在目录 {dir} 内，已拒绝访问"));
    }
    Ok(candidate)
}

/// 所有 CSS 读写的唯一入口。
pub fn resolve_in_dir(dir: &str, file: &str) -> Result<PathBuf, String> {
    if !is_plain_css_name(file) {
        return Err(format!(
            "非法文件名：{file}（只接受 themes 目录下的 *.css，不能带路径）"
        ));
    }
    join_checked(dir, file)
}

/// 固定名字（crab-typography.json）不走 *.css 规则，但同样做包含校验。
fn resolve_fixed(dir: &str, name: &str) -> Result<PathBuf, String> {
    if name != CONFIG_JSON {
        return Err(format!("非法文件名：{name}"));
    }
    join_checked(dir, name)
}

/// 读文本：去掉 BOM，非 UTF-8 字节用替换字符兜底，避免个别主题文件导致整个列表失败。
pub fn read_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取失败 {}：{}", to_slash(path), e))?;
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Ok(String::from_utf8_lossy(body).into_owned())
}

/// 写文本：UTF-8 无 BOM，且只允许白名单文件名。
fn write_text(path: &Path, text: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    if !is_writable_name(&name) {
        return Err(format!("拒绝写入非白名单文件：{name}"));
    }
    fs::write(path, text.as_bytes()).map_err(|e| format!("写入失败 {}：{}", to_slash(path), e))
}

// ---------------------------------------------------------------- 主题探测与列表

/// custom 给了就必须可用；否则按 APPDATA、USERPROFILE 顺序探测。
pub fn detect_dir(custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(raw) = custom {
        if !raw.trim().is_empty() {
            return canonical_dir(raw);
        }
    }
    for cand in candidate_dirs() {
        if cand.is_dir() {
            if let Ok(real) = fs::canonicalize(&cand) {
                return Ok(real);
            }
        }
    }
    Err("没找到 Typora 主题目录，请手动选择".to_string())
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        list.push(Path::new(&appdata).join("Typora").join("themes"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        list.push(
            Path::new(&profile)
                .join("AppData")
                .join("Roaming")
                .join("Typora")
                .join("themes"),
        );
    }
    list
}

/// crab-plus / crab-classic / crab-simple 之外统统算 other。
fn flavor_of(file: &str) -> &'static str {
    let lower = file.to_ascii_lowercase();
    if lower.contains("crab-plus") {
        "plus"
    } else if lower.contains("crab-classic") {
        "classic"
    } else if lower.contains("crab-simple") {
        "simple"
    } else {
        "other"
    }
}

/// 排序权重：仅用于 detect_themes 返回列表的稳定排序，界面分组顺序由前端决定。
fn flavor_rank(flavor: &str) -> u8 {
    match flavor {
        "plus" => 0,
        "simple" => 1,
        "classic" => 2,
        _ => 3,
    }
}

/// 文件名带 dark，或内容引了 crab.dark.css，都算深色。
fn is_dark(file: &str, content: &str) -> bool {
    file.to_ascii_lowercase().contains("dark") || content.contains("crab.dark.css")
}

/// 只要 *.css，排除 base.user.css、crab-typography.css 和 *.crab-bak 备份。
fn is_theme_candidate(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".css") || lower.len() == 4 || lower.ends_with(BAK_SUFFIX) {
        return false;
    }
    lower != BASE_USER_CSS && lower != OVERRIDE_CSS
}

/// 列出目录下的主题文件（不递归）。
pub fn list_themes(dir: &Path) -> Result<Vec<ThemeEntry>, String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("无法读取目录 {}：{}", to_slash(dir), e))?;
    let mut themes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_theme_candidate(name) {
            continue;
        }
        // 单个文件读失败不该让整个列表挂掉，退化成“空内容”即可
        let content = read_text(&path).unwrap_or_default();
        themes.push(ThemeEntry {
            file: name.to_string(),
            name: name[..name.len() - 4].to_string(),
            flavor: flavor_of(name).to_string(),
            dark: is_dark(name, &content),
            patched: content.contains(MARKER_TAG),
        });
    }
    themes.sort_by(|a, b| {
        flavor_rank(&a.flavor)
            .cmp(&flavor_rank(&b.flavor))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(themes)
}

/// detect_themes 的实现：目录 + 主题列表 + 三个注入状态。
pub fn collect_themes_info(custom: Option<&str>) -> Result<ThemesInfo, String> {
    let dir = detect_dir(custom)?;
    let themes = list_themes(&dir)?;
    let base_user = dir.join(BASE_USER_CSS);
    let has_base_user_css = base_user.is_file();
    let base_user_imports = has_base_user_css
        && read_text(&base_user)
            .map(|text| has_crab_import(&text))
            .unwrap_or(false);
    Ok(ThemesInfo {
        dir: to_slash(&dir),
        themes,
        has_base_user_css,
        base_user_imports,
        has_override_css: dir.join(OVERRIDE_CSS).is_file(),
    })
}

// ---------------------------------------------------------------- @import 内联

/// 大小写不敏感地找 ASCII 小写 needle；返回字节下标（ASCII 不会落在多字节字符内部）。
fn find_ci(hay: &str, needle: &str, from: usize) -> Option<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || h.len() < n.len() || from > h.len() - n.len() {
        return None;
    }
    (from..=h.len() - n.len()).find(|&i| {
        h[i..i + n.len()]
            .iter()
            .zip(n)
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
    })
}

/// 从 `url(` 后面读出路径，返回 (路径, 右括号之后的下标)。引号内的括号（data:URI 里很常见）不会被误当结束。
fn read_url_value(text: &str, from: usize) -> Option<(String, usize)> {
    let bytes = text.as_bytes();
    let mut i = from;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    let (value, mut j) = if bytes[i] == b'"' || bytes[i] == b'\'' {
        let quote = bytes[i];
        let start = i + 1;
        let mut k = start;
        while k < bytes.len() && bytes[k] != quote {
            k += 1;
        }
        if k >= bytes.len() {
            return None; // 引号没闭合，交给调用方原样保留
        }
        (text[start..k].to_string(), k + 1)
    } else {
        let start = i;
        let mut k = i;
        while k < bytes.len() && bytes[k] != b')' {
            k += 1;
        }
        if k >= bytes.len() {
            return None;
        }
        (text[start..k].trim().to_string(), k)
    };
    while j < bytes.len() && bytes[j] != b')' {
        j += 1;
    }
    if j >= bytes.len() {
        return None;
    }
    Some((value, j + 1))
}

/// 只处理指向本地、相对路径的资源；data:/http(s):/协议相对/绝对路径都原样放过。
fn is_local_relative(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() || v.starts_with('#') || v.starts_with('/') || v.starts_with('\\') {
        return false;
    }
    let lower = v.to_ascii_lowercase();
    for scheme in [
        "data:", "http:", "https:", "blob:", "asset:", "about:", "file:",
    ] {
        if lower.starts_with(scheme) {
            return false;
        }
    }
    let b = v.as_bytes();
    // 盘符绝对路径 C:/... 或 C:\...
    !(b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
}

/// 把相对 url 挪到以 dir 为基准：prefix 是被内联文件相对 dir 的目录前缀（如 `crab/`）。
fn rebase_url(value: &str, prefix: &str) -> Option<String> {
    if !is_local_relative(value) {
        return None;
    }
    let rel = value.trim().replace('\\', "/");
    let rel = rel.trim_start_matches("./");
    Some(format!("./{prefix}{rel}"))
}

/// 找下一个真正的 `url(` 记号，跳过 `myurl(` 这类标识符尾巴。
fn find_url_token(text: &str, from: usize) -> Option<usize> {
    let mut at = from;
    loop {
        let i = find_ci(text, "url(", at)?;
        let prev_ok = i == 0 || {
            let p = text.as_bytes()[i - 1];
            !(p.is_ascii_alphanumeric() || p == b'-' || p == b'_')
        };
        if prev_ok {
            return Some(i);
        }
        at = i + 4;
    }
}

/// 给一段 CSS 里所有相对 url() 加上目录前缀。prefix 为空表示路径已经相对 dir，原样返回。
fn rewrite_urls(text: &str, prefix: &str) -> String {
    if prefix.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    while let Some(at) = find_url_token(text, cursor) {
        let Some((value, end)) = read_url_value(text, at + 4) else {
            break;
        };
        out.push_str(&text[cursor..at]);
        match rebase_url(&value, prefix) {
            Some(fixed) => out.push_str(&format!("url(\"{fixed}\")")),
            None => out.push_str(&text[at..end]),
        }
        cursor = end;
    }
    out.push_str(&text[cursor..]);
    out
}

/// 一条 @import 语句在原文里的位置与它引用的路径。
struct ImportStmt {
    start: usize,
    end: usize,
    target: Option<String>,
}

/// 粗略判断某个位置是否在块注释里（避免内联被注释掉的 @import）。
fn in_comment(text: &str, pos: usize) -> bool {
    let head = &text[..pos];
    match (head.rfind("/*"), head.rfind("*/")) {
        (Some(open), Some(close)) => open > close,
        (Some(_), None) => true,
        _ => false,
    }
}

/// 从 from 开始找下一条 @import；语句以分号结束（没有分号就到文件尾）。
fn next_import(text: &str, from: usize) -> Option<ImportStmt> {
    let mut at = from;
    loop {
        let start = find_ci(text, "@import", at)?;
        let end = match text[start..].find(';') {
            Some(i) => start + i + 1,
            None => text.len(),
        };
        if in_comment(text, start) {
            at = end;
            continue;
        }
        let target = extract_import_target(&text[start..end]);
        return Some(ImportStmt { start, end, target });
    }
}

/// 支持 `@import url(x)`、`@import url("x")` 与 `@import "x"` 三种写法。
fn extract_import_target(stmt: &str) -> Option<String> {
    if let Some(u) = find_ci(stmt, "url(", 0) {
        return read_url_value(stmt, u + 4).map(|(value, _)| value);
    }
    let bytes = stmt.as_bytes();
    let q = bytes.iter().position(|&c| c == b'"' || c == b'\'')?;
    let quote = bytes[q] as char;
    let rest = &stmt[q + 1..];
    let close = rest.find(quote)?;
    Some(rest[..close].to_string())
}

/// 相对 root 的目录前缀，形如 `crab/`；文件就在 root 下则返回空串。
fn rel_prefix(root: &Path, path: &Path) -> String {
    let Some(parent) = path.parent() else {
        return String::new();
    };
    match parent.strip_prefix(root) {
        Ok(rel) if rel.as_os_str().is_empty() => String::new(),
        Ok(rel) => format!("{}/", to_slash(rel).trim_end_matches('/')),
        Err(_) => String::new(),
    }
}

/// 决定一条 @import 换成什么：内联正文、原样保留（远程）或一句注释（越界/成环/过深/读失败）。
fn replace_import(
    root: &Path,
    importer: &Path,
    raw: &str,
    target: Option<&str>,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
) -> String {
    let Some(target) = target else {
        return raw.to_string();
    };
    if !is_local_relative(target) {
        return raw.to_string(); // 远程 / data: 的 @import 留给 webview 自己去取
    }
    let rel = target.replace('\\', "/");
    let joined = importer.parent().unwrap_or(root).join(&rel);
    let Ok(real) = fs::canonicalize(&joined) else {
        return format!("/* crab: 找不到 @import 目标 {rel}，已跳过 */");
    };
    if !real.starts_with(root) {
        return format!("/* crab: @import 目标 {rel} 在主题目录之外，已跳过 */");
    }
    if depth + 1 > MAX_IMPORT_DEPTH {
        return format!("/* crab: @import 超过 {MAX_IMPORT_DEPTH} 层，已跳过 {rel} */");
    }
    if !seen.insert(real.clone()) {
        return format!("/* crab: {rel} 已内联过，重复引用忽略 */");
    }
    match inline_file(root, &real, depth + 1, seen) {
        Ok(css) => format!("/* crab: inline {rel} */\n{css}\n/* crab: end {rel} */"),
        Err(err) => format!("/* crab: 读取 {rel} 失败（{err}），已跳过 */"),
    }
}

/// 递归内联：文件自身的内容按自己的目录前缀改写 url()，@import 处换成被导入文件的内联结果。
fn inline_file(
    root: &Path,
    path: &Path,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
) -> Result<String, String> {
    let text = read_text(path)?;
    let prefix = rel_prefix(root, path);
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    while let Some(stmt) = next_import(&text, cursor) {
        out.push_str(&rewrite_urls(&text[cursor..stmt.start], &prefix));
        out.push_str(&replace_import(
            root,
            path,
            &text[stmt.start..stmt.end],
            stmt.target.as_deref(),
            depth,
            seen,
        ));
        cursor = stmt.end;
    }
    out.push_str(&rewrite_urls(&text[cursor..], &prefix));
    Ok(out)
}

/// read_preview_css 的实现。
pub fn preview_css(dir: &str, file: &str) -> Result<PreviewCss, String> {
    let base = canonical_dir(dir)?;
    let entry = resolve_in_dir(dir, file)?;
    if !entry.is_file() {
        return Err(format!("主题文件不存在：{file}"));
    }
    // dark 用原文判断，和 detect_themes 保持一致（内联后的正文可能带进无关关键字）
    let dark = is_dark(file, &read_text(&entry)?);
    let mut seen = HashSet::new();
    seen.insert(fs::canonicalize(&entry).unwrap_or_else(|_| entry.clone()));
    let css = inline_file(&base, &entry, 0, &mut seen)?;
    Ok(PreviewCss {
        css,
        base_dir: to_slash(&base),
        dark,
    })
}

// ---------------------------------------------------------------- 配置与写入

/// 读 themes/crab-typography.json 原文，不存在返回 None。
pub fn load_config(dir: &str) -> Result<Option<String>, String> {
    let path = resolve_fixed(dir, CONFIG_JSON)?;
    if !path.is_file() {
        return Ok(None);
    }
    read_text(&path).map(Some)
}

/// 原样写回配置（校验 JSON 是前端的事，这里只负责落盘）。
pub fn save_config(dir: &str, json: &str) -> Result<(), String> {
    let path = resolve_fixed(dir, CONFIG_JSON)?;
    write_text(&path, json)
}

/// 写 themes/crab-typography.css，返回绝对路径。
pub fn write_override_css(dir: &str, css: &str) -> Result<String, String> {
    let path = resolve_in_dir(dir, OVERRIDE_CSS)?;
    write_text(&path, css)?;
    Ok(to_slash(&path))
}

/// 判定一行是不是引入我们覆盖文件的 @import。
fn is_crab_import_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed
        .get(..7)
        .is_some_and(|head| head.eq_ignore_ascii_case("@import"))
        && trimmed.contains(OVERRIDE_CSS)
}

fn has_crab_import(text: &str) -> bool {
    text.lines().any(is_crab_import_line)
}

/// 幂等地把 import 加到最前面：@import 必须排在其它规则之前。
fn add_import(text: &str) -> String {
    if has_crab_import(text) {
        return text.to_string();
    }
    if text.trim().is_empty() {
        return format!("{BASE_USER_HEADER}\n{IMPORT_LINE}\n");
    }
    format!("{IMPORT_LINE}\n{text}")
}

/// 删掉所有引入我们覆盖文件的 @import 行，其余内容不动。
fn remove_import(text: &str) -> String {
    if !has_crab_import(text) {
        return text.to_string();
    }
    let kept: Vec<&str> = text.lines().filter(|l| !is_crab_import_line(l)).collect();
    if kept.iter().all(|l| l.trim().is_empty()) {
        return String::new();
    }
    let mut out = kept.join("\n");
    if text.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// patch_base_user_css 的实现，返回 base.user.css 绝对路径。
pub fn patch_base_user_css(dir: &str, enable: bool) -> Result<String, String> {
    let path = resolve_in_dir(dir, BASE_USER_CSS)?;
    let existing = if path.is_file() {
        Some(read_text(&path)?)
    } else {
        None
    };
    let next = match (&existing, enable) {
        (Some(text), true) => add_import(text),
        (Some(text), false) => remove_import(text),
        (None, true) => format!("{BASE_USER_HEADER}\n{IMPORT_LINE}\n"),
        // 文件都没有，本来就没 import 可删
        (None, false) => return Ok(to_slash(&path)),
    };
    if existing.as_deref() != Some(next.as_str()) {
        write_text(&path, &next)?;
    }
    Ok(to_slash(&path))
}

/// 标记区块在原文里的字节范围（begin 行首起、end 止，含标记本身）。
/// 按 MARKER_TAG 定位而不是整条 MARKER_BEGIN：注释文案改版后仍能认出旧区块。
fn find_block(text: &str) -> Option<(usize, usize)> {
    let tag = text.find(MARKER_TAG)?;
    // 回退到该行行首，避免把 "/* ==== " 这段前缀留在文件里
    let begin = text[..tag].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let end = text[tag..].find(MARKER_END)? + tag + MARKER_END.len();
    Some((begin, end))
}

/// 有区块就整块替换，没有就追加到末尾。
fn upsert_block(text: &str, css: &str) -> String {
    let block = format!("{MARKER_BEGIN}\n{css}\n{MARKER_END}");
    match find_block(text) {
        Some((start, end)) => format!("{}{}{}", &text[..start], block, &text[end..]),
        None => format!("{}\n\n{}\n", text.trim_end(), block),
    }
}

/// 删除区块，顺手收掉它前后多出来的空行。
fn remove_block(text: &str) -> String {
    let Some((start, end)) = find_block(text) else {
        return text.to_string();
    };
    let head = text[..start].trim_end();
    let tail = text[end..].trim_start();
    match (head.is_empty(), tail.is_empty()) {
        (true, true) => String::new(),
        (true, false) => format!("{tail}\n"),
        (false, true) => format!("{head}\n"),
        (false, false) => format!("{head}\n\n{tail}\n"),
    }
}

/// 首次写入前备份成 <file>.crab-bak；已有备份不覆盖，保住用户最原始的版本。
fn backup_once(path: &Path) -> Result<(), String> {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return Err("无法解析主题文件名".to_string());
    };
    let bak = path.with_file_name(format!("{name}{BAK_SUFFIX}"));
    if bak.exists() {
        return Ok(());
    }
    fs::copy(path, &bak)
        .map(|_| ())
        .map_err(|e| format!("备份 {} 失败：{}", to_slash(&bak), e))
}

/// patch_theme_css 的实现：css=Some 写入/替换区块，css=None 删除区块（备份保留）。
pub fn patch_theme_css(dir: &str, file: &str, css: Option<&str>) -> Result<String, String> {
    let path = resolve_in_dir(dir, file)?;
    if !path.is_file() {
        return Err(format!("主题文件不存在：{file}"));
    }
    let text = read_text(&path)?;
    let next = match css {
        Some(block) => {
            if find_block(&text).is_none() {
                backup_once(&path)?;
            }
            upsert_block(&text, block)
        }
        None => remove_block(&text),
    };
    if next != text {
        write_text(&path, &next)?;
    }
    Ok(to_slash(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时目录，Drop 时清理。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!("crab-fsops-{}-{}", tag, std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("建临时目录");
            TempDir(fs::canonicalize(&path).expect("canonicalize 临时目录"))
        }

        fn path(&self) -> &Path {
            &self.0
        }

        /// 传给命令层的 dir 字符串。
        fn dir(&self) -> String {
            to_slash(&self.0)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn resolve_in_dir_rejects_escapes() {
        let tmp = TempDir::new("resolve");
        fs::write(tmp.path().join("theme.css"), "body{}").unwrap();
        fs::create_dir_all(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("sub").join("inner.css"), "body{}").unwrap();
        let dir = tmp.dir();

        assert!(resolve_in_dir(&dir, "theme.css").is_ok());
        for bad in [
            "../theme.css",
            "..\\theme.css",
            "sub/inner.css",
            "sub\\inner.css",
            "/etc/passwd.css",
            "C:/Windows/win.css",
            "theme.txt",
            ".css",
            "",
        ] {
            assert!(resolve_in_dir(&dir, bad).is_err(), "应拒绝 {bad:?}");
        }
        // dir 本身也要校验
        assert!(resolve_in_dir(&format!("{dir}/theme.css"), "theme.css").is_err());
        assert!(resolve_in_dir(&format!("{dir}/nope"), "theme.css").is_err());
        // crab-typography.json 不能从 *.css 通道进来
        assert!(resolve_in_dir(&dir, CONFIG_JSON).is_err());
    }

    #[test]
    fn inlines_imports_and_rebases_urls() {
        let tmp = TempDir::new("inline");
        fs::create_dir_all(tmp.path().join("crab")).unwrap();
        fs::write(
            tmp.path().join("crab").join("base.css"),
            concat!(
                "@font-face { src: url(\"./Harmony.woff2\") format(\"woff2\"); }\n",
                ".i { background: url('sub/pic.png'); }\n",
                ".d { mask: url(\"data:image/svg+xml;utf8,<svg fill='rgba(1, 2, 3, 0.5)'/>\"); }\n",
                ".r { background: url(https://example.com/a.png); }\n",
            ),
        )
        .unwrap();
        fs::write(
            tmp.path().join("theme.css"),
            concat!(
                "@import url(./crab/base.css);\n",
                "@IMPORT \"./crab/base.css\";\n",
                "/* @import url(./crab/missing.css); */\n",
                "body { background: url(\"./bg.png\"); }\n",
            ),
        )
        .unwrap();

        let out = preview_css(&tmp.dir(), "theme.css").unwrap();
        assert_eq!(out.base_dir, tmp.dir());
        assert!(!out.dark);
        // 被内联文件的相对 url 要带上它相对 dir 的目录前缀
        assert!(
            out.css.contains("url(\"./crab/Harmony.woff2\")"),
            "缺少改写后的字体路径：{}",
            out.css
        );
        assert!(out.css.contains("url(\"./crab/sub/pic.png\")"));
        assert!(!out.css.contains("url(\"./Harmony.woff2\")"));
        // data: 与 http(s): 原样保留
        assert!(out
            .css
            .contains("url(\"data:image/svg+xml;utf8,<svg fill='rgba(1, 2, 3, 0.5)'/>\")"));
        assert!(out.css.contains("url(https://example.com/a.png)"));
        // 主题自身的相对路径本来就相对 dir，不动
        assert!(out.css.contains("url(\"./bg.png\")"));
        // 同一文件只内联一次，注释里的 @import 不当真
        assert_eq!(out.css.matches("@font-face").count(), 1);
        assert!(out.css.contains("重复引用忽略"));
        assert!(out.css.contains("/* @import url(./crab/missing.css); */"));
    }

    #[test]
    fn theme_block_write_replace_remove() {
        let tmp = TempDir::new("block");
        let dir = tmp.dir();
        let file = "crab-plus-blue.css";
        let original = "body { color: red; }\n";
        fs::write(tmp.path().join(file), original).unwrap();
        let bak = tmp.path().join(format!("{file}{BAK_SUFFIX}"));

        let path = patch_theme_css(&dir, file, Some("#write{font-size:16px}")).unwrap();
        let first = fs::read_to_string(&path).unwrap();
        assert!(first.starts_with("body { color: red; }"));
        assert!(first.contains(MARKER_BEGIN) && first.contains(MARKER_END));
        assert_eq!(fs::read_to_string(&bak).unwrap(), original);

        // 备份只做一次：改掉备份内容后再写，内容必须保持不变
        fs::write(&bak, "sentinel").unwrap();
        patch_theme_css(&dir, file, Some("#write{font-size:18px}")).unwrap();
        let second = fs::read_to_string(&path).unwrap();
        assert_eq!(second, first.replace("16px", "18px"));
        assert_eq!(second.matches(MARKER_BEGIN).count(), 1);
        assert_eq!(fs::read_to_string(&bak).unwrap(), "sentinel");

        // 删区块回到原样，且可重复执行
        patch_theme_css(&dir, file, None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        patch_theme_css(&dir, file, None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert!(bak.is_file(), "删区块不该动备份");

        // 旧版本写下的区块（注释文案不同）也要能被认出、替换与删除
        let legacy = format!(
            "{original}\n/* ==== crab-typography:begin · 旧版文案 ==== */\n#write{{color:blue}}\n{MARKER_END}\n"
        );
        fs::write(tmp.path().join(file), &legacy).unwrap();
        patch_theme_css(&dir, file, Some("#write{color:green}")).unwrap();
        let replaced = fs::read_to_string(&path).unwrap();
        assert_eq!(
            replaced.matches(MARKER_TAG).count(),
            1,
            "不该追加出第二个区块"
        );
        assert!(replaced.contains("color:green") && !replaced.contains("color:blue"));
        patch_theme_css(&dir, file, None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
    }

    #[test]
    fn base_user_import_toggle_is_idempotent() {
        let tmp = TempDir::new("baseuser");
        let dir = tmp.dir();

        // 文件不存在 → 新建注释头 + import
        let path = patch_base_user_css(&dir, true).unwrap();
        let created = fs::read_to_string(&path).unwrap();
        assert!(created.contains(IMPORT_LINE) && created.starts_with("/*"));
        patch_base_user_css(&dir, true).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), created);

        // 用户自己的内容必须原样留在后面
        let user = "body { color: red; }\n";
        fs::write(&path, user).unwrap();
        patch_base_user_css(&dir, true).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!("{IMPORT_LINE}\n{user}")
        );
        patch_base_user_css(&dir, true).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!("{IMPORT_LINE}\n{user}")
        );

        // 关掉：只删我们的 import 行
        patch_base_user_css(&dir, false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), user);
        patch_base_user_css(&dir, false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), user);

        // 别的写法（单引号 / url()）也要能删掉
        fs::write(
            &path,
            "@import url('crab-typography.css');\n@import \"other.css\";\n",
        )
        .unwrap();
        patch_base_user_css(&dir, false).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "@import \"other.css\";\n"
        );
    }

    #[test]
    fn collects_theme_info_and_config() {
        let tmp = TempDir::new("themes");
        let dir = tmp.dir();
        let write = |name: &str, body: &str| fs::write(tmp.path().join(name), body).unwrap();
        write(
            "crab-plus-dark-green.css",
            "@import url(./crab/crab.dark.css);\n",
        );
        write("crab-plus-blue.css", "body{}");
        write(
            "crab-simple-green.css",
            &format!("body{{}}\n{MARKER_BEGIN}\nx\n{MARKER_END}\n"),
        );
        write("crab-classic-light.css", "body{}");
        write("zz-other.css", "body{}");
        write(OVERRIDE_CSS, "/* 覆盖 */");
        write(BASE_USER_CSS, &format!("{IMPORT_LINE}\n"));
        write("crab-plus-blue.css.crab-bak", "body{}");

        let info = collect_themes_info(Some(&dir)).unwrap();
        assert_eq!(info.dir, dir);
        let files: Vec<&str> = info.themes.iter().map(|t| t.file.as_str()).collect();
        assert_eq!(
            files,
            vec![
                "crab-plus-blue.css",
                "crab-plus-dark-green.css",
                "crab-simple-green.css",
                "crab-classic-light.css",
                "zz-other.css",
            ]
        );
        assert_eq!(info.themes[0].name, "crab-plus-blue");
        assert_eq!(info.themes[1].flavor, "plus");
        assert!(info.themes[1].dark);
        assert!(info.themes[2].patched);
        assert_eq!(info.themes[4].flavor, "other");
        assert!(info.has_override_css && info.has_base_user_css && info.base_user_imports);

        assert!(load_config(&dir).unwrap().is_none());
        save_config(&dir, "{\"fontSize\":16}").unwrap();
        assert_eq!(
            load_config(&dir).unwrap().as_deref(),
            Some("{\"fontSize\":16}")
        );
        let written = write_override_css(&dir, "#write{}").unwrap();
        assert!(written.ends_with(OVERRIDE_CSS));
        assert_eq!(fs::read_to_string(&written).unwrap(), "#write{}");

        // 目录不存在 / 不是目录都要报错
        assert!(collect_themes_info(Some(&format!("{dir}/nope"))).is_err());
        assert!(collect_themes_info(Some(&format!("{dir}/{OVERRIDE_CSS}"))).is_err());
    }
}
