import { useEffect, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * 自定义标题栏右端的窗口控制按钮：最小化 / 最大化-还原 / 关闭。
 *
 * 窗口在 tauri.conf.json 里关了 decorations，系统标题栏没了，这三个按钮就是唯一入口。
 * 字形自己画而不用 lucide：lucide 没有 Windows 那个「还原」字形（两个错位方框），
 * 而标题栏按钮的线宽与尺寸是像素级的约定，10×10 视口 + 线宽 1 才跟系统的观感对得上。
 */

const MINIMIZE = <path d="M0 5h10" />;
const MAXIMIZE = <rect x="0.5" y="0.5" width="9" height="9" />;
/** 还原：前面一个方框，右上角露出后面那个的两条边 */
const RESTORE = (
  <>
    <rect x="0.5" y="2.5" width="7" height="7" />
    <path d="M2.5 2.5V0.5h7v7h-2" />
  </>
);
const CLOSE = <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />;

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  // 最大化与否决定中间那个按钮画哪个字形。Tauri 没有「最大化状态变了」这个事件，
  // 只有 resize，所以每次尺寸变化后重新问一次窗口。
  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void win
        .isMaximized()
        .then((v) => {
          if (alive) setMaximized(v);
        })
        .catch(() => {});
    };
    sync();
    void win.onResized(sync).then((un) => {
      // 监听注册是异步的，组件可能已经卸载了，那就立刻退订
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return (
    <div className="win-ctrl">
      <button
        type="button"
        className="win-ctrl-btn"
        aria-label="最小化"
        title="最小化"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Glyph>{MINIMIZE}</Glyph>
      </button>
      <button
        type="button"
        className="win-ctrl-btn"
        aria-label={maximized ? '向下还原' : '最大化'}
        title={maximized ? '向下还原' : '最大化'}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        <Glyph>{maximized ? RESTORE : MAXIMIZE}</Glyph>
      </button>
      <button
        type="button"
        className="win-ctrl-btn win-ctrl-close"
        aria-label="关闭"
        title="关闭"
        onClick={() => void getCurrentWindow().close()}
      >
        <Glyph>{CLOSE}</Glyph>
      </button>
    </div>
  );
}
