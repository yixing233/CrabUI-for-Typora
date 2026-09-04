import { describe, expect, it } from 'vitest';
import { buildCss, sanitizeValues } from './css';
import { TABLE_BORDERS, TABLE_FILLS, TARGETS } from './model';

describe('标题对齐生成的 CSS', () => {
  for (const id of ['h3', 'h4', 'h5', 'h6']) {
    it(`${id} 居中 / 右对齐要收缩盒子，装饰才跟着标题走`, () => {
      for (const align of ['center', 'right']) {
        const css = buildCss({ [id]: { textAlign: align } });
        expect(css).toContain(`text-align: ${align} !important;`);
        expect(css).toContain('width: fit-content !important;');
        expect(css).toMatch(/margin-left: (auto|0) !important;/);
        expect(css).toMatch(/margin-right: (auto|0) !important;/);
      }
    });
    it(`${id} 左对齐 / 两端对齐保持整行宽度`, () => {
      for (const align of ['left', 'justify']) {
        const css = buildCss({ [id]: { textAlign: align } });
        expect(css).toContain('margin-left: 0 !important;');
        expect(css).not.toContain('width:');
      }
    });
  }

  for (const id of ['h1', 'h2']) {
    it(`${id} 只挪外边距，不收缩（classic / simple 给它画了整行 border-bottom）`, () => {
      const css = buildCss({ [id]: { textAlign: 'center' } });
      expect(css).toContain('margin-left: auto !important;');
      expect(css).not.toContain('width:');
    });
  }

  it('版心与正文段落不写外边距，避免破掉 #write 的 margin:0 auto', () => {
    for (const id of ['base', 'p', 'blockquote', 'list']) {
      const css = buildCss({ [id]: { textAlign: 'center' } });
      expect(css).toContain('text-align: center !important;');
      expect(css).not.toContain('margin-left:');
      expect(css).not.toContain('width:');
    }
  });

  it('对齐值不认识时，宁可什么都不补', () => {
    const css = buildCss({ h3: { textAlign: '__proto__' } });
    expect(css).not.toContain('margin-left:');
    expect(css).not.toContain('width:');
  });

  it('凡是要收缩的条目，必定也写外边距', () => {
    expect(TARGETS.every((t) => !t.alignByShrink || t.alignByMargin)).toBe(true);
  });
});

describe('表格框线配方', () => {
  it('每份都从归零起步：外框、圆角、阴影、竖线、行组线全部显式清掉', () => {
    for (const s of TABLE_BORDERS) {
      const css = buildCss({ table: { tableBorder: s.id } });
      expect(css, s.id).toContain('border-collapse:');
      expect(css, s.id).toContain('border-spacing: 0 !important;');
      expect(css, s.id).toContain('border-radius:');
      expect(css, s.id).toContain('box-shadow:');
      expect(css, s.id).toContain('#write table tr,\n#write table thead,\n#write table tbody,\n#write table tfoot');
      // 框线不许碰底色
      expect(css, s.id).not.toContain('background');
    }
  });

  it('三线只有顶线 / 表头线 / 底线', () => {
    const css = buildCss({ table: { tableBorder: 'three' } });
    expect(css).toContain('border-top: 2px solid');
    expect(css).toContain('border-bottom: 2px solid');
    expect(css).toMatch(/#write table th \{\n\s+border-bottom: 1px solid/);
  });

  it('无框线只有归零，不补任何线', () => {
    const css = buildCss({ table: { tableBorder: 'none' } });
    expect(css).not.toMatch(/border(-top|-bottom)?: \d/);
    // 单独一条 th 规则（前面隔着空行），而不是 CELLS 里那半截 "#write table th {"
    expect(css).not.toMatch(/\n\n#write table th \{/);
  });

  it('圆角卡片保留圆角与裁剪，末行不画底线', () => {
    const css = buildCss({ table: { tableBorder: 'card' } });
    expect(css).toContain('border-radius: 10px !important;');
    expect(css).toContain('overflow: hidden !important;');
    expect(css).toContain('#write table tbody tr:last-child > td');
    // 归零里的 collapse 必须被 separate 覆盖，且排在后面
    expect(css.indexOf('border-collapse: separate')).toBeGreaterThan(css.indexOf('border-collapse: collapse'));
  });

  it('表头规则排在单元格规则之后，表头线才压得住单元格线', () => {
    for (const id of ['rows', 'card', 'three', 'grid']) {
      const css = buildCss({ table: { tableBorder: id } });
      expect(css.indexOf('#write table th {'), id).toBeGreaterThan(css.indexOf('#write table td,'));
    }
  });
});

describe('表格底色配方', () => {
  it('每份都清掉面板底、表头底与隔行底色，且不碰任何线条', () => {
    for (const s of TABLE_FILLS) {
      const css = buildCss({ table: { tableFill: s.id } });
      expect(css, s.id).toContain('background: transparent !important;');
      expect(css, s.id).toContain('backdrop-filter: none !important;');
      expect(css, s.id).toContain('#write table thead tr');
      expect(css, s.id).toContain('#write table tbody tr,');
      expect(css, s.id).toContain('#write table tbody tr:hover > td');
      expect(css, s.id).not.toMatch(/border(-top|-bottom|-collapse|-spacing|-radius)?:/);
    }
  });

  it('无底色不补任何填充，只留归零和悬停', () => {
    const css = buildCss({ table: { tableFill: 'none' } });
    expect(css).not.toContain(':nth-child(2n)');
    expect(css).not.toMatch(/\n\n#write table th \{/);
  });

  it('斑马纹给偶数行上底色，悬停规则排在它后面', () => {
    const css = buildCss({ table: { tableFill: 'zebra' } });
    const zebra = css.indexOf('tr:nth-child(2n) > td');
    const hover = css.indexOf('tr:hover > td');
    expect(zebra).toBeGreaterThan(-1);
    expect(hover).toBeGreaterThan(zebra);
  });

  it('表头底色的规则排在单元格清零之后才盖得住', () => {
    for (const id of ['head', 'headZebra']) {
      const css = buildCss({ table: { tableFill: id } });
      expect(css.indexOf('#write table th {'), id).toBeGreaterThan(css.indexOf('#write table td,'));
    }
  });
});

describe('框线与底色两轴组合', () => {
  it('两轴各管一半，可以任意搭配', () => {
    const css = buildCss({ table: { tableBorder: 'three', tableFill: 'zebra' } });
    expect(css).toContain('border-top: 2px solid');
    expect(css).toContain(':nth-child(2n)');
  });

  it('内边距与配方并进同一条单元格规则，不各写一遍', () => {
    const css = buildCss({ table: { tableBorder: 'grid', tableFill: 'head', cellPadY: '12px', cellPadX: '18px' } });
    expect(css.match(/#write table td,\n#write table th \{/g)).toHaveLength(1);
    expect(css).toContain('padding-block: 12px !important;');
    expect(css).toContain('padding-inline: 18px !important;');
    expect(css).toContain('border: 1px solid');
  });

  it('输出与键序无关', () => {
    const a = buildCss({ table: { tableBorder: 'grid', tableFill: 'zebra', fontWeight: '400' } });
    const b = buildCss({ table: { fontWeight: '400', tableFill: 'zebra', tableBorder: 'grid' } });
    expect(a).toBe(b);
  });

  it('配方 id 不认识时什么都不输出', () => {
    for (const bad of ['__proto__', 'constructor', 'toString', '没这个']) {
      expect(buildCss({ table: { tableBorder: bad } }), bad).toBe('');
      expect(buildCss({ table: { tableFill: bad } }), bad).toBe('');
    }
  });

  it('配方里的声明不含能撑破规则的字符', () => {
    for (const s of [...TABLE_BORDERS, ...TABLE_FILLS]) {
      for (const [, decls] of s.rules) {
        for (const d of decls) expect(d, `${s.id}: ${d}`).not.toMatch(/[;{}]|!important/);
      }
    }
  });

  it('配方的单元格选择器与内边距的选择器逐字一致，否则并不进同一条规则', () => {
    const table = TARGETS.find((t) => t.id === 'table')!;
    const cells = TABLE_BORDERS[0].rules.find(([sels]) => sels.length === 2 && sels[0].endsWith(' td'))![0];
    expect(table.selFor?.cellPadY).toEqual(cells);
    expect(table.selFor?.cellPadX).toEqual(cells);
  });
});

describe('sanitizeValues', () => {
  it('手改配置里的原型链键直接丢掉，不抛异常', () => {
    const raw = JSON.parse('{"__proto__":{"textAlign":"center"},"constructor":{"textAlign":"center"},"h3":{"textAlign":"right"}}');
    const clean = sanitizeValues(raw);
    expect(Object.keys(clean)).toEqual(['h3']);
    expect(({} as Record<string, unknown>).textAlign).toBeUndefined();
  });

  it('挡掉能撑破规则的值', () => {
    const clean = sanitizeValues({ h3: { textAlign: 'right}#write{color:red', fontSize: '18px' } });
    expect(clean.h3).toEqual({ fontSize: '18px' });
  });
});
