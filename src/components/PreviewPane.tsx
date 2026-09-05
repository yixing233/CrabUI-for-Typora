import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button, theme, Tooltip } from 'antd';
import { Eye } from 'lucide-react';
import { TARGET_MAP } from '../lib/model';
import { buildPreviewDoc } from '../lib/preview';

/** 暴露给 App / FieldRow 的预览查询能力 */
export interface PreviewHandle {
  /** 依次尝试选择器，返回第一个命中元素的计算样式值；都没命中返回 '' */
  computed: (selectors: string[], prop: string) => string;
  /** em / rem 换算基准（px）：rem 取根字号，em 取命中元素（或其父级）的字号 */
  fontBase: (selectors: string[], unit: string, forFontSize: boolean) => number;
  /** 把预览滚动到该段落条目对应的元素 */
  scrollToTarget: (targetId: string) => void;
}

export interface PreviewPaneProps {
  themeCss: string;
  baseDir: string;
  dark: boolean;
  overrideCss: string;
  /** 预览文档重建完毕（iframe onload），父级借此重新读"继承值" */
  onDocReady?: () => void;
}

/** 松手快于这个毫秒数就当成点击（切换锁定），慢于它算按住（临时查看） */
const HOLD_MS = 250;

/**
 * 主题 CSS 变化才重建 srcDoc；拖滑块产生的 overrideCss 变化只就地改
 * <style id="crab-typography-style"> 的内容，避免闪屏与滚动位置丢失。
 */
const PreviewPane = forwardRef<PreviewHandle, PreviewPaneProps>(function PreviewPane(
  { themeCss, baseDir, dark, overrideCss, onDocReady },
  ref,
) {
  const { token } = theme.useToken();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const overrideRef = useRef(overrideCss);
  /** 点击锁定的「只看主题原样」状态 */
  const [locked, setLocked] = useState(false);
  /** 按住期间的临时状态，显示与 locked 相反的那一侧 */
  const [peeking, setPeeking] = useState(false);
  const pressAt = useRef(0);
  const bare = peeking ? !locked : locked;

  const startPeek = useCallback(() => {
    pressAt.current = Date.now();
    setPeeking(true);
  }, []);

  /** 松手：短按当点击，切换锁定态；按住超过阈值只是临时对比，回到原状 */
  const endPeek = useCallback((commit: boolean) => {
    setPeeking(false);
    if (commit && Date.now() - pressAt.current < HOLD_MS) setLocked((v) => !v);
  }, []);

  const srcDoc = useMemo(
    () => buildPreviewDoc({ themeCss, overrideCss: overrideRef.current, baseDir, dark }),
    // 故意不依赖 overrideCss：它只做就地更新
    [themeCss, baseDir, dark],
  );

  const applyOverride = useCallback((css: string) => {
    const style = frameRef.current?.contentDocument?.getElementById('crab-typography-style');
    if (style) style.textContent = css;
  }, []);

  useEffect(() => {
    overrideRef.current = overrideCss;
    applyOverride(bare ? '' : overrideCss);
  }, [overrideCss, bare, applyOverride]);

  const handleLoad = useCallback(() => {
    applyOverride(bare ? '' : overrideRef.current);
    onDocReady?.();
  }, [applyOverride, bare, onDocReady]);

  useImperativeHandle(
    ref,
    (): PreviewHandle => {
      const pick = (selectors: string[]): Element | null => {
        const doc = frameRef.current?.contentDocument;
        if (!doc) return null;
        for (const sel of selectors) {
          try {
            const el = doc.querySelector(sel);
            if (el) return el;
          } catch {
            // 非法选择器直接跳过
          }
        }
        return null;
      };
      const styleOf = (el: Element): CSSStyleDeclaration | null => {
        const view = frameRef.current?.contentDocument?.defaultView;
        return view ? view.getComputedStyle(el) : null;
      };
      return {
        computed(selectors, prop) {
          const el = pick(selectors);
          if (!el) return '';
          return styleOf(el)?.getPropertyValue(prop).trim() ?? '';
        },
        fontBase(selectors, unit, forFontSize) {
          const doc = frameRef.current?.contentDocument;
          if (!doc) return 16;
          if (unit === 'rem') {
            return parseFloat(styleOf(doc.documentElement)?.fontSize ?? '') || 16;
          }
          const hit = pick(selectors);
          const el = forFontSize ? hit?.parentElement ?? hit : hit;
          if (!el) return 16;
          return parseFloat(styleOf(el)?.fontSize ?? '') || 16;
        },
        scrollToTarget(targetId) {
          const target = TARGET_MAP[targetId];
          if (!target) return;
          const el = pick([target.probe ?? target.sel[0]]);
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        },
      };
    },
    [],
  );

  return (
    <div className="preview-wrap">
      <iframe
        ref={frameRef}
        className="preview-frame"
        title="排版预览"
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        onLoad={handleLoad}
      />
      <div
        className="preview-tools"
        style={{
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowTertiary,
        }}
      >
        <Tooltip title="点击锁定「只看主题原样」，按住可临时对比">
          <Button
            size="small"
            type={bare ? 'primary' : 'text'}
            aria-label="只看主题原样"
            aria-pressed={locked}
            icon={<Eye size={14} />}
            onPointerDown={startPeek}
            onPointerUp={() => endPeek(true)}
            onPointerLeave={() => endPeek(false)}
            onPointerCancel={() => endPeek(false)}
            onKeyDown={(e) => {
              if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) startPeek();
            }}
            onKeyUp={(e) => {
              // 键盘一律按「切换」处理，不看按住时长，免得慢按一下没反应
              if (e.key !== 'Enter' && e.key !== ' ') return;
              setPeeking(false);
              setLocked((v) => !v);
            }}
          />
        </Tooltip>
      </div>
    </div>
  );
});

export default PreviewPane;
