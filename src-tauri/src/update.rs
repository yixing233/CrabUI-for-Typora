//! 主题在线更新与应用版本检查。
//!
//! 安全边界不在这里：能写哪些路径由 [`fsops::resolve_asset_in_dir`] 说了算，能改哪些类型的文件
//! 由 [`fsops::ASSET_KINDS`] 说了算。这个模块只负责三件事——把字节取回来、核对 sha256、
//! 把通过校验的那些交给 [`fsops::write_asset`]。凡是判断都写成纯函数，好让单测不用碰网络。

use std::collections::HashSet;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::fsops;

/// 清单体积上限。一份 40 个文件的清单不到 10 KB，1 MB 已经宽得离谱。
const MANIFEST_MAX: u64 = 1024 * 1024;
/// 单文件上限。最大的字体 2.6 MB。
const FILE_MAX: u64 = 8 * 1024 * 1024;
/// 单次更新的总量上限。全套主题连字体一起是 26 MB。
const RUN_MAX: u64 = 64 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const TIMEOUT: Duration = Duration::from_secs(30);

const UA: &str = concat!("CrabUI-for-Typora/", env!("CARGO_PKG_VERSION"));

/// 默认清单地址。换分支、换仓库、换成别的分发渠道，都只改这一行。
pub const DEFAULT_SOURCE: &str =
    "https://raw.githubusercontent.com/yixing233/CrabUI-for-Typora/main/themes/manifest.json";

const RELEASES_API: &str =
    "https://api.github.com/repos/yixing233/CrabUI-for-Typora/releases/latest";

// ---------------------------------------------------------------- 清单

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ManifestFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Manifest {
    pub schema: u32,
    pub version: String,
    #[serde(default)]
    pub released: String,
    #[serde(default)]
    pub notes: String,
    pub files: Vec<ManifestFile>,
}

/// 一个文件在本地的处境。`rejected` 附带原因，直接显示给用户看。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub path: String,
    pub kind: String,
    pub size: u64,
    /// `new` / `changed` / `same` / `rejected`
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 计划把清单里**所有**文件都列出来，前端按 kind 开关过滤时不必再跑一趟网络。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlan {
    pub manifest: Manifest,
    pub items: Vec<PlanItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedItem {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReport {
    pub version: String,
    pub installed: Vec<String>,
    pub failed: Vec<FailedItem>,
}

/// 按文件粒度报进度——三十几个文件，不必做到字节。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub path: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRelease {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    pub notes: String,
    pub url: String,
    pub published: String,
}

// ---------------------------------------------------------------- 校验（纯函数）

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// 校验清单地址。
///
/// 必须 https（明文 http 一律拒绝）、必须有主机名、不带 `?` 和 `#`——查询串会让下面
/// 「同目录」的判断变得含糊，而我们本来也不需要它。
pub fn check_source(source: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(source.trim()).map_err(|e| format!("源地址无法解析：{e}"))?;
    if url.scheme() != "https" {
        return Err("源地址必须是 https，明文 http 一律拒绝".to_string());
    }
    if url.host_str().is_none() {
        return Err("源地址没有主机名".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("源地址不该带 ? 或 #".to_string());
    }
    if !url.path().to_ascii_lowercase().ends_with(".json") {
        return Err("源地址应当指向一个 .json 清单".to_string());
    }
    Ok(url)
}

/// 文件地址一律相对清单自己解析，然后复核：同协议、同主机、同端口，且仍在清单所在目录之下。
///
/// 清单里没有 baseUrl 字段就是为了这一步——下载源只有一处，谁也没法把某个文件指到别的主机上。
pub fn asset_url(manifest_url: &reqwest::Url, rel: &str) -> Result<reqwest::Url, String> {
    let base = manifest_url
        .join("./")
        .map_err(|e| format!("清单目录无法解析：{e}"))?;
    let url = base.join(rel).map_err(|e| format!("{rel} 无法解析：{e}"))?;
    if url.scheme() != "https"
        || url.host_str() != manifest_url.host_str()
        || url.port_or_known_default() != manifest_url.port_or_known_default()
    {
        return Err(format!("{rel} 解析出的地址不在源站上，已拒绝"));
    }
    if !url.path().starts_with(base.path()) {
        return Err(format!("{rel} 解析出的地址跳出了清单所在目录，已拒绝"));
    }
    Ok(url)
}

/// 解析清单并做内容校验。喂进来的是网上的字节，所以每个字段都当成可疑的。
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, String> {
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|e| format!("清单不是合法的 JSON：{e}"))?;
    if manifest.schema != 1 {
        return Err(format!(
            "清单的 schema={} 这个版本的 CrabUI 还看不懂，请先更新应用",
            manifest.schema
        ));
    }
    if manifest.version.trim().is_empty() {
        return Err("清单里没有版本号".to_string());
    }
    if manifest.files.is_empty() {
        return Err("清单里没有任何文件".to_string());
    }
    let mut seen = HashSet::new();
    for f in &manifest.files {
        if f.size > FILE_MAX {
            return Err(format!(
                "{} 声明了 {} 字节，超过单文件上限 {FILE_MAX}",
                f.path, f.size
            ));
        }
        if f.sha256.len() != 64 || !f.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("{} 的 sha256 不是 64 位十六进制", f.path));
        }
        if !seen.insert(f.path.as_str()) {
            return Err(format!("清单里 {} 出现了两次", f.path));
        }
    }
    Ok(manifest)
}

/// 版本比较：只认点分数字，短的那边缺的段按 0 算。
///
/// 不碰 semver 预发布那一套（我们的 tag 就是 `vX.Y.Z`）。解析不了就当「没有更新」——
/// 宁可漏提示一次，也不要弹一个假更新把人引去下载。
pub fn is_newer(latest: &str, current: &str) -> bool {
    let nums = |s: &str| -> Option<Vec<u64>> {
        s.trim()
            .split('.')
            .map(|part| part.trim().parse::<u64>().ok())
            .collect()
    };
    let (Some(a), Some(b)) = (nums(latest), nums(current)) else {
        return false;
    };
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// 外链只放行 https。界面上那几个「去下载」都走这里，前端拿不到「随便打开一个 URL」的能力。
pub fn check_external(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|e| format!("地址无法解析：{e}"))?;
    if parsed.scheme() != "https" {
        return Err("只允许打开 https 链接".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("地址没有主机名".to_string());
    }
    Ok(parsed.to_string())
}

// ---------------------------------------------------------------- 取字节

/// 客户端锁定在一个主机上：重定向最多 3 跳，且每一跳都必须还在这个主机上。
/// 跳出去或跳太多次就停在那一跳，调用方会因为拿到一个 3xx 而报错。
fn client(host: &str) -> Result<reqwest::Client, String> {
    let host = host.to_string();
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(TIMEOUT)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.stop();
            }
            match attempt.url().host_str() {
                Some(h) if h == host => attempt.follow(),
                _ => attempt.stop(),
            }
        }))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

/// reqwest 的错误信息会把整条 URL 重复一遍，界面上只要一句人话。
fn short_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "超时".to_string();
    }
    if e.is_connect() {
        return "连不上（检查网络或代理）".to_string();
    }
    if e.is_redirect() {
        return "重定向被拒（跳出了源站或跳得太多）".to_string();
    }
    e.to_string()
}

/// 边收边数，超过 cap 立刻中断。
///
/// 不能只看 Content-Length：它可以撒谎，也可以在 chunked 响应里根本不出现。
/// 状态码转人话。光报个数字，用户没法判断该等一会儿还是该去改地址。
/// 这几种是这个功能真会撞上的：清单还没提交（404）、GitHub 对未登录请求按出口 IP 限流（403/429）。
fn status_hint(status: reqwest::StatusCode) -> &'static str {
    match status.as_u16() {
        401 => "对方要求认证——本功能只支持公开可读的地址",
        403 | 429 => "对方在限流（GitHub 对未登录请求按出口 IP 计数），过一会儿再试",
        404 => "地址不存在：清单还没提交、路径写错，或者仓库不是公开的",
        500..=599 => "对方服务器出错，过一会儿再试",
        _ => "",
    }
}

/// 先看它是为了连一个字节都不必下（对方老实报了个超大的数就直接不要了），
/// 真正封住内存的是下面按 chunk 累加那一段。
async fn get_bytes(
    client: &reqwest::Client,
    url: &reqwest::Url,
    cap: u64,
) -> Result<Vec<u8>, String> {
    let resp = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| format!("请求失败：{}", short_err(&e)))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let hint = status_hint(status);
        return Err(if hint.is_empty() {
            format!("{} 返回 {status}", url.path())
        } else {
            format!("{} 返回 {status}——{hint}", url.path())
        });
    }
    if let Some(len) = resp.content_length() {
        if len > cap {
            return Err(format!("{} 声明了 {len} 字节，超过上限 {cap}", url.path()));
        }
    }
    let mut stream = resp.bytes_stream();
    let mut out: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断：{}", short_err(&e)))?;
        if out.len() as u64 + chunk.len() as u64 > cap {
            return Err(format!("{} 超过上限 {cap} 字节，已中断", url.path()));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

// ---------------------------------------------------------------- 三个动作

pub async fn fetch_manifest(source: &str) -> Result<Manifest, String> {
    let url = check_source(source)?;
    let client = client(url.host_str().unwrap_or_default())?;
    let bytes = get_bytes(&client, &url, MANIFEST_MAX).await?;
    parse_manifest(&bytes)
}

/// 逐个算本地 sha256 与清单比对。
///
/// 返回清单里的**每一个**文件，包括 `same` 和 `rejected` 的——前端切换分类开关时不必再跑网络，
/// 用户也能看见「这个文件为什么没被更新」。单个文件读不出来（权限、被占用）只让它自己变成
/// `rejected`，不该毁掉整份计划。
///
/// 单独抽出来是为了能不碰网络就测：四种状态是这功能最核心的用户可见输出。
pub fn compare(dir: &str, manifest: &Manifest) -> Vec<PlanItem> {
    let mut items = Vec::with_capacity(manifest.files.len());
    for f in &manifest.files {
        let mk = |status: &'static str, reason: Option<String>| PlanItem {
            path: f.path.clone(),
            kind: f.kind.clone(),
            size: f.size,
            status,
            reason,
        };
        items.push(match fsops::resolve_asset_in_dir(dir, &f.path, &f.kind) {
            Err(reason) => mk("rejected", Some(reason)),
            Ok(target) => match fsops::read_asset(&target) {
                Err(reason) => mk("rejected", Some(reason)),
                Ok(None) => mk("new", None),
                Ok(Some(bytes)) => {
                    if sha256_hex(&bytes).eq_ignore_ascii_case(&f.sha256) {
                        mk("same", None)
                    } else {
                        mk("changed", None)
                    }
                }
            },
        });
    }
    items
}

pub async fn plan(dir: &str, source: &str) -> Result<UpdatePlan, String> {
    let manifest = fetch_manifest(source).await?;
    let items = compare(dir, &manifest);
    Ok(UpdatePlan { manifest, items })
}

/// 下一个文件并让它就位。任何一步不过就整条放弃，磁盘上什么都不留。
async fn install_one(
    client: &reqwest::Client,
    manifest_url: &reqwest::Url,
    dir: &str,
    f: &ManifestFile,
    allow_scripts: bool,
) -> Result<(), String> {
    // 后端复核一遍，不信前端的开关：脚本会被注入进 Typora 执行，这一层不能只靠界面把住。
    if f.kind == "script" && !allow_scripts {
        return Err("脚本类文件的在线更新没有开启".to_string());
    }
    let target = fsops::resolve_asset_in_dir(dir, &f.path, &f.kind)?;
    let url = asset_url(manifest_url, &f.path)?;

    // cap 直接用清单声明的大小：多发一个字节就中断。
    let bytes = get_bytes(client, &url, f.size).await?;
    if bytes.len() as u64 != f.size {
        return Err(format!(
            "大小不符：清单说 {} 字节，实际收到 {}",
            f.size,
            bytes.len()
        ));
    }
    let got = sha256_hex(&bytes);
    if !got.eq_ignore_ascii_case(&f.sha256) {
        return Err(format!(
            "校验不通过，已丢弃（清单 {}…，实际 {}…）",
            &f.sha256[..8],
            &got[..8]
        ));
    }
    // 字体不备份：26 MB 的字体几乎不会变，也没人手改过字体，备份只是白占一倍磁盘。
    // 主题 CSS 就不一样了——用户可能手改过，那份得留住。
    if f.kind != "font" {
        fsops::backup_asset(&target)?;
    }
    fsops::write_asset(&target, &bytes)
}

/// 只下 `paths` 里点名的文件，逐个校验、备份、就位。
///
/// 单个文件失败不中断其余的——一次更新里坏掉一个字体，不该把十五个主题一起拖住。
/// 进度用回调交出去，模块本身不认识 `AppHandle`，单测才能不起 Tauri。
pub async fn apply<F: FnMut(Progress)>(
    dir: &str,
    source: &str,
    paths: &[String],
    allow_scripts: bool,
    mut on_progress: F,
) -> Result<UpdateReport, String> {
    let url = check_source(source)?;
    let manifest = fetch_manifest(source).await?;
    let client = client(url.host_str().unwrap_or_default())?;

    let wanted: HashSet<&str> = paths.iter().map(String::as_str).collect();
    let picked: Vec<&ManifestFile> = manifest
        .files
        .iter()
        .filter(|f| wanted.contains(f.path.as_str()))
        .collect();
    if picked.len() != wanted.len() {
        return Err("要下载的文件里有清单上没有的条目，已中止".to_string());
    }
    if picked.is_empty() {
        return Err("没有选中任何文件".to_string());
    }
    let total_bytes: u64 = picked.iter().map(|f| f.size).sum();
    if total_bytes > RUN_MAX {
        return Err(format!(
            "这次要下 {total_bytes} 字节，超过单次上限 {RUN_MAX}"
        ));
    }

    let total = picked.len();
    let mut installed = Vec::new();
    let mut failed = Vec::new();
    for (i, f) in picked.iter().enumerate() {
        let ok = match install_one(&client, &url, dir, f, allow_scripts).await {
            Ok(()) => {
                installed.push(f.path.clone());
                true
            }
            Err(reason) => {
                failed.push(FailedItem {
                    path: f.path.clone(),
                    reason,
                });
                false
            }
        };
        on_progress(Progress {
            done: i + 1,
            total,
            path: f.path.clone(),
            ok,
        });
    }
    Ok(UpdateReport {
        version: manifest.version,
        installed,
        failed,
    })
}

// ---------------------------------------------------------------- 应用自身的版本

/// 问一次 GitHub 的 latest release，比出来新就把版本号和说明交给界面。
///
/// 只查、只提示，不下载也不替换——真要装还是用户自己点开发布页下安装包。这样就不需要签名密钥，
/// 也就不存在「密钥丢了没法再发更新／密钥泄漏能给所有人推任意代码」这两个问题。
/// 匿名调用 GitHub 接口每小时 60 次，够用，所以也不做后台自动检查。
pub async fn check_app() -> Result<AppRelease, String> {
    let url = reqwest::Url::parse(RELEASES_API).map_err(|e| format!("接口地址有误：{e}"))?;
    let client = client(url.host_str().unwrap_or_default())?;
    let bytes = get_bytes(&client, &url, MANIFEST_MAX).await?;
    let body: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("GitHub 返回的不是合法 JSON：{e}"))?;

    let text = |key: &str| -> String {
        body.get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let tag = text("tag_name");
    if tag.is_empty() {
        return Err("GitHub 没有返回版本号（可能还没有正式发布，或者触发了接口限流）".to_string());
    }
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    let current = env!("CARGO_PKG_VERSION").to_string();
    let mut notes = text("body");
    if notes.chars().count() > 4000 {
        notes = notes.chars().take(4000).collect::<String>() + "…";
    }
    let url = match text("html_url") {
        s if s.is_empty() => "https://github.com/yixing233/CrabUI-for-Typora/releases".to_string(),
        s => check_external(&s)?,
    };

    Ok(AppRelease {
        newer: is_newer(&latest, &current),
        current,
        latest,
        notes,
        url,
        published: text("published_at").chars().take(10).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_json(files: &str) -> String {
        format!(r#"{{"schema":1,"version":"1.0.0","notes":"","files":[{files}]}}"#)
    }

    fn entry(path: &str, kind: &str, size: u64, sha: &str) -> String {
        format!(r#"{{"path":"{path}","sha256":"{sha}","size":{size},"kind":"{kind}"}}"#)
    }

    #[test]
    fn sha256_matches_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn check_source_only_takes_plain_https_json() {
        assert!(check_source(DEFAULT_SOURCE).is_ok());
        assert!(check_source("  https://example.com/a/manifest.JSON  ").is_ok());

        for bad in [
            "",
            "http://example.com/manifest.json",
            "file:///c:/manifest.json",
            "https:///manifest.json",
            "https://example.com/manifest.json?token=x",
            "https://example.com/manifest.json#frag",
            "https://example.com/themes/",
            "https://example.com/manifest.txt",
            "javascript:alert(1)",
        ] {
            assert!(check_source(bad).is_err(), "{bad} 本该被拒");
        }
    }

    #[test]
    fn asset_url_stays_under_the_manifest_directory() {
        let base = check_source("https://cdn.example.com/repo/main/themes/manifest.json").unwrap();

        assert_eq!(
            asset_url(&base, "crab/x.woff2").unwrap().as_str(),
            "https://cdn.example.com/repo/main/themes/crab/x.woff2"
        );

        for bad in [
            "../evil.css",                                   // 跳出 themes/
            "../../../evil.css",                             //
            "//evil.com/x.css",                              // 协议相对，会跑到别的主机上
            "https://evil.com/x.css",                        // 干脆是绝对地址
            "http://cdn.example.com/repo/main/themes/x.css", // 降级成明文
        ] {
            assert!(asset_url(&base, bad).is_err(), "{bad} 本该被拒");
        }
    }

    #[test]
    fn parse_manifest_rejects_malformed_lists() {
        let sha = "a".repeat(64);
        let good = manifest_json(&entry("crab-plus-blue.css", "theme", 20480, &sha));
        let parsed = parse_manifest(good.as_bytes()).unwrap();
        assert_eq!(parsed.version, "1.0.0");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.released, "", "released 缺了也该能解析");

        let dup = format!(
            "{},{}",
            entry("a.css", "theme", 1, &sha),
            entry("a.css", "theme", 1, &sha)
        );
        for (bad, why) in [
            ("{".to_string(), "不是 JSON"),
            (
                r#"{"schema":2,"version":"1.0.0","files":[]}"#.to_string(),
                "schema 不认识",
            ),
            (manifest_json(""), "files 是空的"),
            (
                r#"{"schema":1,"version":" ","files":[]}"#.to_string(),
                "版本号是空白",
            ),
            (
                manifest_json(&entry("a.css", "theme", 1, "xyz")),
                "sha256 不是 64 位 hex",
            ),
            (
                manifest_json(&entry("a.css", "theme", 1, &"g".repeat(64))),
                "sha256 有非 hex 字符",
            ),
            (
                manifest_json(&entry("a.css", "theme", 99 * 1024 * 1024, &sha)),
                "超过单文件上限",
            ),
            (manifest_json(&dup), "同一个 path 出现两次"),
        ] {
            assert!(parse_manifest(bad.as_bytes()).is_err(), "{why} 本该被拒");
        }
    }

    #[test]
    fn version_compare_errs_on_the_side_of_no_update() {
        assert!(is_newer("1.0.1", "1.0.0"));
        assert!(is_newer("1.1", "1.0.9"));
        assert!(is_newer("2.0", "1.9.9"));
        assert!(is_newer("1.0.0.1", "1.0.0"));
        assert!(is_newer("1.10.0", "1.9.0"), "按数字比，不是按字符串");

        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("1.0", "1.0.0"), "缺的段按 0 补，两边相等");
        assert!(!is_newer("0.9.9", "1.0.0"));
        // 解析不了一律当没有更新，宁可漏提示也不弹假更新
        assert!(!is_newer("1.0.0-rc1", "1.0.0"));
        assert!(!is_newer("nightly", "1.0.0"));
        assert!(!is_newer("", "1.0.0"));
    }

    #[test]
    fn external_links_are_https_only() {
        assert_eq!(
            check_external("https://github.com/a/b/releases").unwrap(),
            "https://github.com/a/b/releases"
        );
        for bad in [
            "http://github.com/a/b",
            "file:///c:/windows/system32/calc.exe",
            "javascript:alert(1)",
            "not a url",
            "",
        ] {
            assert!(check_external(bad).is_err(), "{bad} 本该被拒");
        }
    }

    #[test]
    fn http_errors_say_what_to_do_about_them() {
        use reqwest::StatusCode;
        // 限流和「清单还没提交」是最常撞上的两种，必须能一眼分开
        assert!(status_hint(StatusCode::FORBIDDEN).contains("限流"));
        assert!(status_hint(StatusCode::TOO_MANY_REQUESTS).contains("限流"));
        assert!(status_hint(StatusCode::NOT_FOUND).contains("还没提交"));
        assert!(status_hint(StatusCode::BAD_GATEWAY).contains("服务器出错"));
        // 没话说就别硬凑，交给调用方只打状态码
        assert!(status_hint(StatusCode::IM_A_TEAPOT).is_empty());
    }

    /// 临时目录，Drop 时清理。
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!("crab-update-{}-{}", tag, std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("建临时目录");
            TempDir(std::fs::canonicalize(&path).expect("canonicalize 临时目录"))
        }

        fn dir(&self) -> String {
            self.0.to_string_lossy().replace('\\', "/")
        }

        fn put(&self, rel: &str, bytes: &[u8]) {
            let abs = self.0.join(rel);
            std::fs::create_dir_all(abs.parent().expect("有父目录")).expect("建子目录");
            std::fs::write(abs, bytes).expect("写文件");
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn compare_labels_every_file_in_the_manifest() {
        let tmp = TempDir::new("compare");
        tmp.put("keep.css", b"same");
        tmp.put("stale.css", b"old");
        tmp.put("crab/font.woff2", b"glyphs");

        let same = sha256_hex(b"same");
        let want = sha256_hex(b"new");
        let font = sha256_hex(b"glyphs");
        let json = manifest_json(
            &[
                entry("keep.css", "theme", 4, &same),
                entry("stale.css", "theme", 3, &want),
                entry("fresh.css", "theme", 9, &want),
                entry("crab/font.woff2", "font", 6, &font),
                // 下面两个过不了路径校验：一个跳出 themes/，一个扩展名与 kind 不符
                entry("../escape.css", "theme", 1, &want),
                entry("hack.js", "theme", 1, &want),
            ]
            .join(","),
        );
        let manifest = parse_manifest(json.as_bytes()).expect("清单本身是合法的");

        let items = compare(&tmp.dir(), &manifest);
        let by_path = |p: &str| {
            items
                .iter()
                .find(|i| i.path == p)
                .unwrap_or_else(|| panic!("{p} 应该出现在结果里"))
        };

        // 清单里的每一个文件都要有交代，一个不少
        assert_eq!(items.len(), manifest.files.len());
        assert_eq!(by_path("keep.css").status, "same");
        assert_eq!(by_path("stale.css").status, "changed");
        assert_eq!(by_path("fresh.css").status, "new");
        assert_eq!(by_path("crab/font.woff2").status, "same");
        assert_eq!(by_path("../escape.css").status, "rejected");
        assert_eq!(by_path("hack.js").status, "rejected");

        // 被拒的必须说出理由，其余的不该带 reason 干扰界面
        assert!(by_path("../escape.css").reason.is_some());
        assert!(by_path("hack.js").reason.is_some());
        assert!(by_path("keep.css").reason.is_none());

        // 大小写不同的哈希也算相同：清单是别人生成的，不该为此报「有更新」
        let upper = manifest_json(&entry("keep.css", "theme", 4, &same.to_uppercase()));
        let items = compare(
            &tmp.dir(),
            &parse_manifest(upper.as_bytes()).expect("大写哈希也是合法清单"),
        );
        assert_eq!(items[0].status, "same");
    }
}
