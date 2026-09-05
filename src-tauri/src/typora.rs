//! Typora 安装目录探测与进程重启。
//!
//! 主题 CSS 改完必须重启 Typora 才生效，这里把「请它正常退出 → 等它真的退出 → 重新拉起」
//! 这套流程收在一处。默认走优雅关闭（Typora 有未保存文档时会自己弹窗留住自己），
//! 只有调用方显式要求才强制结束。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

use serde::Serialize;

const EXE_NAME: &str = "Typora.exe";
/// 优雅关闭后等它退出的上限：Electron 主进程退出后还要收掉渲染 / GPU 子进程。
const CLOSE_WAIT: Duration = Duration::from_secs(8);
const POLL_EVERY: Duration = Duration::from_millis(200);
/// 旧进程刚消失时单实例锁可能还没释放，缓一下再拉起，免得新进程被自己挡掉。
const RELAUNCH_DELAY: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TyporaInfo {
    /// Typora.exe 绝对路径（正斜杠）；没探到就是 None
    pub exe: Option<String>,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartResult {
    /// started=原本没开直接启动 · restarted=关掉又拉起 · blocked=没退出，没敢拉起
    pub outcome: &'static str,
    pub exe: String,
    /// blocked 时 taskkill 说了什么，用来区分「有未保存文档」和「权限不足」
    pub detail: String,
}

/// GUI 进程里调命令行工具会闪一下黑窗，加 CREATE_NO_WINDOW 压掉。
#[cfg(windows)]
fn hidden(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000)
}

#[cfg(not(windows))]
fn hidden(cmd: &mut Command) -> &mut Command {
    cmd
}

/// 命令行工具一律走 System32 的绝对路径。
/// Windows 的可执行文件搜索顺序把「进程所在目录」排在 System32 前面，
/// 便携运行（程序放在下载目录）时，同目录下的同名 exe 会被优先执行。
fn system32(tool: &str) -> PathBuf {
    match std::env::var("SystemRoot") {
        Ok(root) => PathBuf::from(root).join("System32").join(tool),
        Err(_) => PathBuf::from(tool),
    }
}

fn to_slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_typora_exe(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case(EXE_NAME))
}

/// `tasklist /NH /FO CSV` 的输出里有没有指定镜像名。
///
/// 不能看提示文案：进程不存在时 tasklist 也往 stdout 写一行「没有运行的任务…」，
/// 这句话跟系统语言绑定。CSV 行必定以 `"Typora.exe",` 开头，认这个才稳。
fn csv_has_exe(stdout: &str, exe_name: &str) -> bool {
    stdout.lines().any(|line| {
        line.trim_start()
            .strip_prefix('"')
            .and_then(|rest| rest.get(..exe_name.len()))
            .is_some_and(|name| name.eq_ignore_ascii_case(exe_name))
    })
}

/// 指定镜像名的进程是否在跑。
fn is_running_of(exe_name: &str) -> Result<bool, String> {
    let out = hidden(&mut Command::new(system32("tasklist.exe")))
        .args([
            "/FI",
            &format!("IMAGENAME eq {exe_name}"),
            "/NH",
            "/FO",
            "CSV",
        ])
        .output()
        .map_err(|e| format!("查询 {exe_name} 进程失败：{e}"))?;
    Ok(csv_has_exe(&String::from_utf8_lossy(&out.stdout), exe_name))
}

/// Typora 是否在跑。
pub fn is_running() -> Result<bool, String> {
    is_running_of(EXE_NAME)
}

/// `reg query … /v InstallLocation` 的输出里所有安装目录。
///
/// 行长这样：`    InstallLocation    REG_SZ    D:\Program Files\Typora\`
/// 不按 DisplayName 过滤——拿到目录后直接看里面有没有 Typora.exe，比对名字更可靠。
fn parse_install_locations(stdout: &str) -> Vec<PathBuf> {
    stdout
        .lines()
        .filter_map(|line| {
            let (head, rest) = line.trim().split_once("REG_SZ")?;
            if !head.trim().eq_ignore_ascii_case("InstallLocation") {
                return None;
            }
            let path = rest.trim().trim_end_matches(['\\', '/']);
            // 削掉尾部分隔符后 `C:\` 会变成 `C:`，那是「C 盘当前目录」而不是根目录，
            // 再 join 出来的 `C:Typora.exe` 会指到工作目录去，必须要求是完整的绝对路径
            (!path.is_empty() && Path::new(path).has_root()).then(|| PathBuf::from(path))
        })
        .collect()
}

/// 注册表卸载项里登记的安装目录。要开子进程，只在常规路径都没命中时才走。
fn registry_dirs() -> Vec<PathBuf> {
    const ROOTS: [&str; 3] = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    let mut dirs = Vec::new();
    for root in ROOTS {
        if let Ok(out) = hidden(&mut Command::new(system32("reg.exe")))
            .args(["query", root, "/s", "/v", "InstallLocation"])
            .output()
        {
            dirs.extend(parse_install_locations(&String::from_utf8_lossy(
                &out.stdout,
            )));
        }
    }
    dirs
}

/// 常规安装位置，命中率最高且不用开子进程。
fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for key in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Ok(base) = std::env::var(key) {
            dirs.push(PathBuf::from(base).join("Typora"));
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local).join("Programs").join("Typora"));
    }
    // 装到别的盘是常事，把前几个盘的默认位置也扫一遍
    for drive in ['C', 'D', 'E', 'F'] {
        dirs.push(PathBuf::from(format!(r"{drive}:\Program Files\Typora")));
        dirs.push(PathBuf::from(format!(
            r"{drive}:\Program Files (x86)\Typora"
        )));
    }
    dirs
}

fn exe_in(dir: &Path) -> Option<PathBuf> {
    let exe = dir.join(EXE_NAME);
    exe.is_file().then_some(exe)
}

/// 找 Typora.exe。hint 是用户手动指定的安装目录（也允许直接给到 Typora.exe），优先级最高。
///
/// hint 可能来自用户可手改的 crab-typography.json，而那个文件就躺在 themes 目录里
/// ——第三方主题包解压进来的正是这个目录。所以直接给文件时必须验名字，
/// 否则一份夹带的配置就能让这个按钮去启动任意程序。
pub fn find_exe(hint: Option<&str>) -> Result<PathBuf, String> {
    if let Some(raw) = hint.map(str::trim).filter(|h| !h.is_empty()) {
        let path = PathBuf::from(raw.replace('/', std::path::MAIN_SEPARATOR_STR));
        if path.is_file() {
            return if is_typora_exe(&path) {
                Ok(path)
            } else {
                Err(format!("这不是 {EXE_NAME}：{raw}"))
            };
        }
        return exe_in(&path).ok_or_else(|| format!("这个目录里没有 {EXE_NAME}：{raw}"));
    }
    for dir in candidate_dirs() {
        if let Some(exe) = exe_in(&dir) {
            return Ok(exe);
        }
    }
    for dir in registry_dirs() {
        if let Some(exe) = exe_in(&dir) {
            return Ok(exe);
        }
    }
    Err(format!("没找到 {EXE_NAME}，请手动指定 Typora 的安装目录。"))
}

/// 探 Typora 的位置与运行状态；任何一步失败都只当「没探到」，不打断界面。
pub fn info(hint: Option<&str>) -> TyporaInfo {
    TyporaInfo {
        exe: find_exe(hint).ok().as_deref().map(to_slash),
        running: is_running().unwrap_or(false),
    }
}

/// 请指定镜像名的进程退出，返回 taskkill 说的话（用于诊断）。
///
/// 不带 /F 时 taskkill 发的是 WM_CLOSE，等同于点窗口的关闭按钮：有未保存文档
/// Typora 会弹窗把自己留住，这正是我们要的——宁可重启失败也别弄丢用户的字。
/// 退出码一律不看：进程早就没了、或渲染子进程拒绝优雅关闭都会让它非零，
/// 到底走没走干净由后面的轮询说话。但输出要留着：权限不足和「有未保存文档」
/// 在轮询看来一模一样，只有 taskkill 的原话能把两者分开。
fn close_of(exe_name: &str, force: bool) -> Result<String, String> {
    let mut cmd = Command::new(system32("taskkill.exe"));
    cmd.args(["/IM", exe_name]);
    if force {
        cmd.arg("/F");
    }
    let out = hidden(&mut cmd)
        .output()
        .map_err(|e| format!("结束 {exe_name} 进程失败：{e}"))?;
    let mut said = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !said.is_empty() {
            said.push('\n');
        }
        said.push_str(err.trim());
    }
    Ok(said)
}

/// 轮询等到进程列表里再没有指定镜像名；超时返回 false。
fn wait_gone_of(exe_name: &str) -> bool {
    let deadline = Instant::now() + CLOSE_WAIT;
    loop {
        // 查询本身出错时按「还在」处理，继续等到超时，不误判成已退出
        if !is_running_of(exe_name).unwrap_or(true) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(POLL_EVERY);
    }
}

/// 拉起前要从子进程环境里摘掉的变量：它们会改写 Node / Electron 的启动方式。
///
/// 罪魁祸首是 `ELECTRON_RUN_AS_NODE`——VSCode 的扩展宿主与集成终端都会设成 `1`，
/// 从那里启动本程序，子进程就一路继承下来。而 Typora 是 Electron 应用：这个变量一开，
/// `Typora.exe` 就退化成一个普通的 Node 运行时，不给参数时读一遍 stdin 便以 0 退出，
/// 既不开窗口也不写 `typora.log`，表现就是「点了启动完全没反应」。
/// `NODE_OPTIONS` / `ELECTRON_NO_ASAR` 同理会干扰启动，一并摘掉，
/// 让子进程的环境尽量贴近从资源管理器双击图标。
const STRIP_ENV: [&str; 3] = ["ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ASAR", "NODE_OPTIONS"];

/// 拉起 Typora 用的命令：工作目录设在安装目录，跟双击图标的行为一致。
/// 三个标准流都接到 null：Typora 活得比本程序久，不该攥着我们的管道端。
fn launch_cmd(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    for key in STRIP_ENV {
        cmd.env_remove(key);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd
}

/// 拉起 Typora，不等它结束。
fn launch(exe: &Path) -> Result<(), String> {
    launch_cmd(exe)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动 Typora 失败：{e}"))
}

/// 重启 Typora：没在跑就直接启动，在跑就先请它退出。
///
/// force=false 时若它没退出，返回 outcome="blocked" 而不是报错，
/// 交给界面提示用户存盘后再试，或显式选择强制重启。
pub fn restart(hint: Option<&str>, force: bool) -> Result<RestartResult, String> {
    // 先确认找得到 exe 再动手关，否则会把 Typora 关掉又起不来
    let exe = find_exe(hint)?;
    let path = to_slash(&exe);
    if !is_running()? {
        launch(&exe)?;
        return Ok(RestartResult {
            outcome: "started",
            exe: path,
            detail: String::new(),
        });
    }
    let detail = close_of(EXE_NAME, force)?;
    if !wait_gone_of(EXE_NAME) {
        if force {
            return Err(format!(
                "{EXE_NAME} 强制结束后仍在进程列表里，请手动关掉 Typora 再试。\ntaskkill 输出：{detail}"
            ));
        }
        return Ok(RestartResult {
            outcome: "blocked",
            exe: path,
            detail,
        });
    }
    sleep(RELAUNCH_DELAY);
    launch(&exe)?;
    Ok(RestartResult {
        outcome: "restarted",
        exe: path,
        detail: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_exe_in_tasklist_csv() {
        let has = |s: &str| csv_has_exe(s, EXE_NAME);
        // 真实 CSV 行
        assert!(has(
            "\"Typora.exe\",\"1234\",\"Console\",\"1\",\"234,567 K\""
        ));
        // 大小写不敏感
        assert!(has("\"typora.exe\",\"1\",\"Console\",\"1\",\"1 K\""));
        // 多行里夹着一条
        assert!(has(
            "\"other.exe\",\"9\",\"Console\",\"1\",\"1 K\"\r\n\"Typora.exe\",\"1\",\"Console\",\"1\",\"1 K\"\r\n"
        ));
    }

    #[test]
    fn ignores_localized_no_task_message() {
        let has = |s: &str| csv_has_exe(s, EXE_NAME);
        // 进程不存在时 tasklist 往 stdout 写的提示，中英文都不能误判成在跑
        assert!(!has("信息: 没有运行的任务匹配指定标准。"));
        assert!(!has(
            "INFO: No tasks are running which match the specified criteria."
        ));
        assert!(!has(""));
        // 名字只是前缀相同的别的进程，不能算
        assert!(!has("\"TyporaHelper.exe\",\"1\",\"Console\",\"1\",\"1 K\""));
        // 没加引号的行也不认
        assert!(!has("Typora.exe 1234 Console"));
    }

    #[test]
    fn survives_gbk_bytes_mangled_by_lossy() {
        // 中文系统 tasklist 输出的是 GBK 字节流，from_utf8_lossy 会把它变成一串 U+FFFD。
        // 切片落在替换字符中间时 str::get 返回 None，只会判「不在跑」，既不 panic 也不误判。
        let gbk = [0xD0u8, 0xC5, 0xCF, 0xA2, 0x3A, 0x20, 0xC3, 0xBB, 0xD3, 0xD0];
        let lossy = String::from_utf8_lossy(&gbk);
        assert!(!csv_has_exe(&lossy, EXE_NAME));
        // 引号后紧跟被 lossy 的中文，同样不能命中
        assert!(!csv_has_exe(
            &format!("\"{lossy}\",\"1\",\"Console\""),
            EXE_NAME
        ));
    }

    #[test]
    fn parses_install_location_lines() {
        let out = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\Uninstall\\Typora\r\n    \
             InstallLocation    REG_SZ    D:\\Program Files\\Typora\\\r\n\r\n\
             HKEY_LOCAL_MACHINE\\SOFTWARE\\...\\Uninstall\\Other\r\n    \
             InstallLocation    REG_SZ    \r\n    \
             DisplayName    REG_SZ    Typora\r\n";
        let dirs = parse_install_locations(out);
        // 空值那条要丢掉，尾部反斜杠要削掉，DisplayName 不能被当成路径
        assert_eq!(dirs, vec![PathBuf::from(r"D:\Program Files\Typora")]);
    }

    #[test]
    fn rejects_drive_relative_install_location() {
        // 削掉尾部分隔符后 `C:\` 变成 `C:`，join 出来是盘符相对路径 C:Typora.exe，
        // 会指到「C 盘的当前目录」而不是根目录。这种值必须丢掉。
        assert_eq!(
            Path::new("C:").join(EXE_NAME),
            PathBuf::from(format!("C:{EXE_NAME}"))
        );
        assert!(parse_install_locations("    InstallLocation    REG_SZ    C:\\").is_empty());
        assert!(parse_install_locations("    InstallLocation    REG_SZ    /").is_empty());
        // 相对路径也不要
        assert!(parse_install_locations("    InstallLocation    REG_SZ    Typora").is_empty());
    }

    #[test]
    fn hint_must_contain_the_exe() {
        // 指了个铁定没有 Typora.exe 的目录，必须报错而不是回退到自动探测
        let err = find_exe(Some(r"C:\Windows\System32\drivers\etc")).unwrap_err();
        assert!(err.contains(EXE_NAME), "{err}");
        // 直接指到别的 exe 上也必须拒绝：配置文件用户可手改，不能让它启动任意程序
        let notepad = system32("notepad.exe");
        if notepad.is_file() {
            let err = find_exe(Some(&notepad.to_string_lossy())).unwrap_err();
            assert!(err.contains(EXE_NAME), "{err}");
        }
        // 空 hint 视为没指定，走自动探测（本机可能装了也可能没装，只要不 panic）
        let _ = find_exe(Some("   "));
    }

    #[test]
    fn auto_detect_only_returns_a_real_exe() {
        // 本机装没装 Typora 都算通过，但只要报了路径，就必须真是那个 exe
        match find_exe(None) {
            Ok(exe) => {
                println!("探到 Typora：{}", exe.display());
                assert!(exe.is_file());
                assert!(exe
                    .file_name()
                    .is_some_and(|n| n.eq_ignore_ascii_case(EXE_NAME)));
                // 拿探到的目录再当 hint 走一遍，两条路径必须给出同一个结果
                let dir = exe.parent().unwrap().to_string_lossy().to_string();
                assert_eq!(find_exe(Some(&dir)).unwrap(), exe);
            }
            Err(err) => println!("本机没探到 Typora：{err}"),
        }
    }

    /// 拉起 Typora 前必须把 Electron 那几个变量摘掉，否则从 VSCode 的扩展宿主 /
    /// 集成终端启动本程序时，`ELECTRON_RUN_AS_NODE=1` 会一路继承到 Typora，
    /// 让 `Typora.exe` 变成普通 Node 运行时，读完 stdin 就以 0 退出——
    /// 不开窗口、不写日志，界面上看就是「点了启动完全没反应」。
    #[test]
    fn launch_strips_electron_env() {
        let dir = r"D:\Program Files\Typora";
        let cmd = launch_cmd(&Path::new(dir).join(EXE_NAME));
        let removed: Vec<&str> = cmd
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .filter_map(|(k, _)| k.to_str())
            .collect();
        for key in STRIP_ENV {
            assert!(removed.contains(&key), "{key} 没被摘掉：{removed:?}");
        }
        // 只摘不设：不该顺手往 Typora 的环境里塞东西
        assert!(cmd.get_envs().all(|(_, v)| v.is_none()));
        // 工作目录仍落在安装目录，跟双击图标一致
        assert_eq!(cmd.get_current_dir(), Some(Path::new(dir)));
    }

    /// 拿字符映射表当替身，把「启动 → 查存活 → 优雅关闭 → 等它消失」这条链真跑一遍。
    ///
    /// 不碰 Typora。选 charmap 而不是 notepad：Win11 的记事本是应用商店版，
    /// 窗口关掉后进程仍常驻，WM_CLOSE 之后 tasklist 里还在，验不了优雅退出这条路。
    /// charmap 是传统 Win32 程序，收到 WM_CLOSE 就真退。跑测试时会闪一下它的窗口。
    #[test]
    fn close_and_wait_on_a_stand_in_process() {
        const STAND_IN: &str = "charmap.exe";
        let exe = system32(STAND_IN);
        if !exe.is_file() {
            println!("本机没有 {STAND_IN}，跳过");
            return;
        }
        if is_running_of(STAND_IN).unwrap_or(true) {
            println!("{STAND_IN} 已在运行，跳过以免动到别人的窗口");
            return;
        }
        launch(&exe).unwrap();
        // 起进程要点时间，用同样的轮询等它出现
        let deadline = Instant::now() + Duration::from_secs(5);
        let appeared = loop {
            if is_running_of(STAND_IN).unwrap_or(false) {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            sleep(POLL_EVERY);
        };
        assert!(appeared, "{STAND_IN} 启动后没出现在进程列表里");
        // 等它把窗口建好并开始处理消息。真实场景里 Typora 早就在跑了，
        // 这里纯粹是替身刚起来的时序：进程已存在但消息循环还没转，
        // 此刻投过去的 WM_CLOSE 会落空（实测 200ms 就关会关不掉）。
        sleep(Duration::from_secs(2));

        println!("taskkill 输出：{}", close_of(STAND_IN, false).unwrap());
        let gone = wait_gone_of(STAND_IN);
        if !gone {
            // 别把替身留在用户机器上
            let _ = close_of(STAND_IN, true);
        }
        assert!(gone, "{STAND_IN} 优雅关闭后没有在 {CLOSE_WAIT:?} 内退出");
        assert!(!is_running_of(STAND_IN).unwrap());
    }
}
