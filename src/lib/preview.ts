/**
 * 预览文档：用 Typora 的 #write DOM 结构渲染一段示例内容，
 * 让主题 CSS（`#write h1` 这类选择器）与生成的覆盖都能真实命中。
 */

import { convertFileSrc } from '@tauri-apps/api/core';

export const SAMPLE_HTML = `
<div id="write" class="is-node">
  <h1>排版管理器 · 实时预览</h1>
  <p>这段示例文档用来预览<strong>字体、字号、行高与字间距</strong>的实际效果。中文与 English 混排、数字 0123456789，都会按当前设置渲染。</p>
  <h2>二级标题 · Heading 2</h2>
  <p>正文段落会继承版心的行高与字间距。行内代码写成 <code>letter-spacing</code>，链接写成 <a href="#">Crab Theme</a>，都属于正文段落的一部分。</p>
  <blockquote>
    <p>引用块用于强调整段内容，它有自己的行高与内边距。</p>
    <p>第二段引用，可以检查段间距是否合适。</p>
  </blockquote>
  <h3>三级标题 · 列表</h3>
  <ul>
    <li><section><p>无序列表项，检查列表项间距与行高。</p></section></li>
    <li><section><p>第二项，内容稍长一些，用来观察折行后的行距表现是否舒适。</p></section></li>
  </ul>
  <ol>
    <li><section><p>有序列表第一项</p></section></li>
    <li><section><p>有序列表第二项</p></section></li>
  </ol>
  <h4>四级标题 · 代码块</h4>
  <div class="md-fences md-end-block ty-contain-cm modeLoaded" lang="ts">
    <div class="CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap">
      <div class="CodeMirror-scroll">
        <div class="CodeMirror-sizer">
          <div class="CodeMirror-lines">
            <div class="CodeMirror-code">
<pre class="CodeMirror-line"><span role="presentation"><span class="cm-keyword">const</span> <span class="cm-def">style</span> = { <span class="cm-property">lineHeight</span>: <span class="cm-number">1.8</span> };</span></pre>
<pre class="CodeMirror-line"><span role="presentation"><span class="cm-keyword">export</span> <span class="cm-keyword">default</span> style;</span></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <h5>五级标题 · 表格</h5>
  <figure>
    <table>
      <thead><tr><th>属性</th><th>作用</th><th>常用值</th></tr></thead>
      <tbody>
        <tr><td>font-size</td><td>字号</td><td>16px</td></tr>
        <tr><td>line-height</td><td>行间距</td><td>1.8</td></tr>
        <tr><td>letter-spacing</td><td>字间距</td><td>0.05em</td></tr>
        <tr><td>text-indent</td><td>首行缩进</td><td>2em</td></tr>
      </tbody>
    </table>
  </figure>
  <h6>六级标题</h6>
  <p>最后一段：排版的目标是让长文读起来不费力，而不是把每个数字都调到极致。</p>
</div>
`;

/** 把主题 CSS 里的相对 url() 换成 webview 能加载的地址（字体、背景图） */
export function resolveAssetUrls(css: string, baseDir: string): string {
  const dir = baseDir.replace(/[\\/]+$/, '');
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (whole, _quote: string, raw: string) => {
    const path = raw.trim();
    if (/^(data:|https?:|blob:|asset:|about:|#)/i.test(path)) return whole;
    const normalized = path.replace(/^\.\//, '').replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) return whole;
    try {
      return `url("${convertFileSrc(`${dir}/${normalized}`)}")`;
    } catch {
      return whole;
    }
  });
}

export interface PreviewDocOptions {
  themeCss: string;
  overrideCss: string;
  baseDir: string;
  dark: boolean;
}

/** 组装 iframe 的完整文档：主题 CSS 在前，覆盖在后（同特异性时后者胜） */
export function buildPreviewDoc({ themeCss, overrideCss, baseDir, dark }: PreviewDocOptions): string {
  const resolved = resolveAssetUrls(themeCss, baseDir);
  return `<!doctype html>
<html lang="zh"${dark ? ' data-dark="true"' : ''}>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body { overflow-x: hidden; }
  #write { margin: 0 auto; }
  .CodeMirror-line { margin: 0; }
</style>
<style id="theme-css">${resolved}</style>
<style id="crab-typography-style">${overrideCss}</style>
</head>
<body class="typora-preview">${SAMPLE_HTML}</body>
</html>`;
}
