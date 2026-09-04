mod fsops;
mod typora;

use fsops::{PreviewCss, ThemesInfo};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// 把 themes 目录加进 asset 协议白名单，预览 iframe 才能用 asset:// 取到主题字体。
/// tauri.conf.json 里 assetProtocol.scope 故意留空，改由运行时按实际目录放行。
fn allow_asset_dir<R: tauri::Runtime, M: Manager<R>>(manager: &M, dir: &str) {
    if let Err(err) = manager.asset_protocol_scope().allow_directory(dir, true) {
        eprintln!("放行 asset 目录失败 {dir}：{err}");
    }
}

/// 探测（或校验）themes 目录并列出 Crab 主题。custom 为空时按 APPDATA、USERPROFILE 顺序找。
#[tauri::command]
fn detect_themes(app: tauri::AppHandle, custom: Option<String>) -> Result<ThemesInfo, String> {
    let info = fsops::collect_themes_info(custom.as_deref())?;
    allow_asset_dir(&app, &info.dir);
    Ok(info)
}

/// 读主题 CSS 并把 @import 递归内联，相对 url() 会重挂到 dir 上。
#[tauri::command]
fn read_preview_css(dir: String, file: String) -> Result<PreviewCss, String> {
    fsops::preview_css(&dir, &file)
}

/// 读 themes/crab-typography.json 原文，不存在返回 null。
#[tauri::command]
fn load_config(dir: String) -> Result<Option<String>, String> {
    fsops::load_config(&dir)
}

/// 原样写回 themes/crab-typography.json（UTF-8 无 BOM）。
#[tauri::command]
fn save_config(dir: String, json: String) -> Result<(), String> {
    fsops::save_config(&dir, &json)
}

/// 写 themes/crab-typography.css，返回写入的绝对路径。
#[tauri::command]
fn write_override_css(dir: String, css: String) -> Result<String, String> {
    fsops::write_override_css(&dir, &css)
}

/// 幂等地在 themes/base.user.css 首行加入 / 移除 @import "crab-typography.css"。
#[tauri::command]
fn patch_base_user_css(dir: String, enable: bool) -> Result<String, String> {
    fsops::patch_base_user_css(&dir, enable)
}

/// 用标记区块管理主题文件里的覆盖：css 为 null 表示删区块；首次写入前会留 .crab-bak 备份。
#[tauri::command]
fn patch_theme_css(dir: String, file: String, css: Option<String>) -> Result<String, String> {
    fsops::patch_theme_css(&dir, &file, css.as_deref())
}

/// 在系统文件管理器里打开目录；传的是文件就打开所在目录并选中它。
#[tauri::command]
fn reveal_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("路径不存在：{path}"));
    }
    if target.is_dir() {
        // 前端传过来的是正斜杠路径，交给系统前换成本地分隔符
        let native = target
            .to_string_lossy()
            .replace('/', std::path::MAIN_SEPARATOR_STR);
        app.opener()
            .open_path(native, None::<&str>)
            .map_err(|e| format!("打开目录失败：{e}"))
    } else {
        app.opener()
            .reveal_item_in_dir(&target)
            .map_err(|e| format!("打开所在目录失败：{e}"))
    }
}

/// 探 Typora 的安装位置与运行状态。typoraDir 为空时自动找。
/// 标 async 是为了别占主线程：自动探测失败时会连开三个 reg query 遍历卸载项。
#[tauri::command(async)]
fn typora_info(typora_dir: Option<String>) -> typora::TyporaInfo {
    typora::info(typora_dir.as_deref())
}

/// 重启 Typora 让主题改动生效。
/// force=false 走优雅关闭：Typora 有未保存文档会自己弹窗留住，此时返回 outcome="blocked"。
/// 必须标 async——它最长会阻塞 8 秒多（等进程退出），跑在主线程上窗口会被判定无响应。
#[tauri::command(async)]
fn restart_typora(
    typora_dir: Option<String>,
    force: bool,
) -> Result<typora::RestartResult, String> {
    typora::restart(typora_dir.as_deref(), force)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 启动就把默认探测到的 themes 目录放行，前端还没调 detect_themes 时预览也能取字体
            if let Ok(info) = fsops::collect_themes_info(None) {
                allow_asset_dir(app, &info.dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_themes,
            read_preview_css,
            load_config,
            save_config,
            write_override_css,
            patch_base_user_css,
            patch_theme_css,
            reveal_path,
            typora_info,
            restart_typora
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
