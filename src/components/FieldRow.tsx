import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button, Input, InputNumber, Segmented, Select, Slider, Tooltip, Typography, theme } from 'antd';
import { Info, RotateCcw } from 'lucide-react';
import { FIELDS, FONT_STACKS, WEIGHT_NAMES, selectorsFor, unitsFor } from '../lib/model';
import type { FieldId, TargetDef } from '../lib/model';
import { clampTo, convertUnit, limitsFor, round, splitLength } from '../lib/css';
import type { PreviewHandle } from './PreviewPane';

const { Text } = Typography;
const CUSTOM = '__custom__';
const SAMPLE = '春江潮水连海平 · Crab Typography 0123';

/* ---------- 本机字体检测：先问 document.fonts，再退回 canvas 宽度对比，结果缓存 ---------- */
const fontCache = new Map<string, boolean>();
let measureCtx: CanvasRenderingContext2D | null = null;

function measure(font: string, text: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function fontInstalled(probe?: string): boolean {
  if (!probe) return true;
  const cached = fontCache.get(probe);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    ok = document.fonts.check(`16px "${probe}"`);
  } catch {
    ok = false;
  }
  if (!ok) {
    const text = '中文Wmg0123';
    const base = measure('16px monospace', text);
    const test = measure(`16px "${probe}", monospace`, text);
    ok = base > 0 && Math.abs(base - test) > 0.5;
  }
  fontCache.set(probe, ok);
  return ok;
}

/** 把计算样式值整理成可读的"当前生效值"：行高换成倍数，字重带中文名，枚举映射中文 */
function describe(field: FieldId, raw: string, fontBase: number): string {
  if (!raw) return '';
  const def = FIELDS[field];
  if (field === 'lineHeight') {
    const px = parseFloat(raw);
    if (!Number.isFinite(px)) return raw;
    const times = fontBase > 0 ? round(px / fontBase, 2) : 0;
    return times ? `${times}（≈${Math.round(px)}px）` : `${Math.round(px)}px`;
  }
  if (def.kind === 'weight') {
    const n = parseInt(raw, 10);
    const name = WEIGHT_NAMES[String(n)];
    return name ? `${n} ${name}` : raw;
  }
  if (def.options) {
    const hit = def.options.find(([v]) => v === raw);
    return hit ? hit[1] : raw;
  }
  return raw;
}

export interface FieldRowProps {
  target: TargetDef;
  field: FieldId;
  /** 用户显式设置的 CSS 值；undefined = 未设置（继承主题） */
  value?: string;
  preview: RefObject<PreviewHandle | null>;
  /** 预览文档重建后自增，用来重读"当前生效值" */
  refreshKey: number;
  onChange: (targetId: string, field: FieldId, value: string | null) => void;
}

function FieldRowInner({ target, field, value, preview, refreshKey, onChange }: FieldRowProps) {
  const { token } = theme.useToken();
  const def = FIELDS[field];
  const tip = target.tipFor?.[field] ?? def.tip;
  const isSet = value !== undefined;
  const units = useMemo(() => unitsFor(target, field), [target, field]);
  const selectors = useMemo(() => selectorsFor(target, field), [target, field]);

  /** 用户手动选过的单位（未设置该属性时保留选择） */
  const [unitPick, setUnitPick] = useState<string | null>(null);
  /** 计算样式原始值 + 同元素字号（行高换算倍数用） */
  const [inherited, setInherited] = useState('');
  const [inheritedBase, setInheritedBase] = useState(16);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');

  // 只在"未设置"时读继承值：拖动过程中不去碰 getComputedStyle，避免反复触发样式重算
  useEffect(() => {
    if (isSet || !def.css) return;
    const raf = requestAnimationFrame(() => {
      const api = preview.current;
      setInherited(api?.computed(selectors, def.read ?? def.css) ?? '');
      setInheritedBase((api && parseFloat(api.computed(selectors, 'font-size'))) || 16);
    });
    return () => cancelAnimationFrame(raf);
  }, [isSet, selectors, def, preview, refreshKey]);

  const parsed = splitLength(value);
  const unit = (parsed && units.includes(parsed.unit) ? parsed.unit : null) ?? unitPick ?? units[0] ?? '';
  const limits = limitsFor(def, unit);

  const baseOf = useCallback(
    (u: string) => preview.current?.fontBase(selectors, u, field === 'fontSize') ?? 16,
    [preview, selectors, field],
  );

  const write = useCallback(
    (next: string | null) => onChange(target.id, field, next),
    [onChange, target.id, field],
  );

  const writeNumber = (n: number | null) => {
    if (n === null || !Number.isFinite(n)) return;
    write(`${clampTo(n, limits)}${unit}`);
  };

  // 未设置时滑块停在"当前生效值"附近：把继承的 px 值折算到当前单位（行高折算成倍数）
  let numeric: number;
  if (parsed) {
    numeric = parsed.num;
  } else {
    const px = parseFloat(inherited);
    if (!Number.isFinite(px)) {
      numeric = def.neutral ?? Math.max(0, limits.min);
    } else if (def.kind === 'number') {
      numeric = clampTo(round(px / (inheritedBase || 16), 2), limits);
    } else {
      numeric = clampTo(unit && unit !== 'px' ? convertUnit(px, 'px', unit, baseOf) : px, limits);
    }
  }

  const fontOptions = useMemo(
    () => [
      ...FONT_STACKS.map((f) => ({
        value: f.value,
        label: fontInstalled(f.probe) ? f.label : `${f.label}（未安装）`,
      })),
      { value: CUSTOM, label: '自定义…' },
    ],
    [],
  );

  const knownFont = isSet && FONT_STACKS.some((f) => f.value === value);
  const customMode = def.kind === 'font' && (isSet ? !knownFont : customOpen);

  // 当前值不在预置列表里就自动进入自定义态并回填
  useEffect(() => {
    if (def.kind === 'font' && isSet && !knownFont) setCustomDraft(value ?? '');
  }, [def.kind, isSet, knownFont, value]);

  const commitCustom = () => {
    const next = customDraft.trim();
    write(next || null);
    if (!next) setCustomOpen(false);
  };

  const switchUnit = (next: string) => {
    const from = unit;
    setUnitPick(next);
    if (!parsed) return;
    write(`${clampTo(convertUnit(parsed.num, from, next, baseOf), limitsFor(def, next))}${next}`);
  };

  const slider = (
    <Slider
      min={limits.min}
      max={limits.max}
      step={limits.step}
      value={numeric}
      onChange={writeNumber}
      tooltip={{ formatter: (v) => `${v}${unit}` }}
    />
  );
  const spin = (
    <InputNumber
      size="small"
      style={{ width: 76, flex: '0 0 auto' }}
      min={limits.min}
      max={limits.max}
      step={limits.step}
      value={numeric}
      onChange={writeNumber}
      aria-label={def.label}
    />
  );

  let control: ReactNode;
  if (def.kind === 'font') {
    control = (
      <Select
        size="small"
        style={{ flex: 1, minWidth: 0 }}
        allowClear
        placeholder="继承主题"
        value={customMode ? CUSTOM : value}
        options={fontOptions}
        showSearch={{
          filterOption: (input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase()),
        }}
        onChange={(next: string | undefined) => {
          if (next === CUSTOM) {
            setCustomOpen(true);
            setCustomDraft(value ?? '');
            return;
          }
          setCustomOpen(false);
          write(next ? next : null);
        }}
      />
    );
  } else if (def.kind === 'preset') {
    control = (
      <Select
        size="small"
        style={{ flex: 1, minWidth: 0 }}
        allowClear
        placeholder="沿用主题"
        value={value}
        listItemHeight={48}
        options={(def.options ?? []).map(([v, label, desc]) => ({ value: v, label, desc }))}
        optionRender={(opt) => (
          <div>
            <div>{opt.data.label}</div>
            {opt.data.desc ? (
              <Text style={{ fontSize: 11, color: token.colorTextTertiary }}>{opt.data.desc}</Text>
            ) : null}
          </div>
        )}
        onChange={(next: string | undefined) => write(next ? next : null)}
      />
    );
  } else if (def.kind === 'length') {
    control = (
      <>
        {slider}
        {spin}
        {units.length > 1 ? (
          <Segmented
            size="small"
            value={unit}
            options={units}
            onChange={(v) => switchUnit(String(v))}
            aria-label="单位"
          />
        ) : null}
      </>
    );
  } else if (def.kind === 'number') {
    control = (
      <>
        {slider}
        {spin}
      </>
    );
  } else if (def.kind === 'weight') {
    control = (
      <>
        {slider}
        <Text style={{ flex: '0 0 auto', width: 60, fontSize: 12 }}>
          {numeric}
          {WEIGHT_NAMES[String(numeric)] ? ` ${WEIGHT_NAMES[String(numeric)]}` : ''}
        </Text>
      </>
    );
  } else {
    control = (
      <Segmented
        size="small"
        value={value ?? ''}
        options={(def.options ?? []).map(([v, label]) => ({
          value: v,
          // 点已选中项 = 取消该覆盖（radio 不会重复触发 onChange，交给这里处理）
          label: <span onClick={() => value === v && write(null)}>{label}</span>,
        }))}
        onChange={(v) => write(String(v))}
      />
    );
  }

  const inheritedText = describe(field, inherited, inheritedBase);

  return (
    <div className="field-row">
      <div className="field-head">
        <Text
          style={{
            flex: '0 0 auto',
            minWidth: 72,
            fontSize: 12,
            fontWeight: isSet ? 600 : 400,
            color: isSet ? token.colorPrimary : undefined,
          }}
        >
          {def.label}
        </Text>
        {tip ? (
          <Tooltip title={tip}>
            <Info size={12} aria-label="说明" style={{ flex: '0 0 auto', opacity: 0.5 }} />
          </Tooltip>
        ) : null}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontSize: 12,
            color: token.colorTextTertiary,
          }}
        >
          {!isSet && inheritedText ? `继承 ${inheritedText}` : ''}
        </span>
        {isSet ? (
          <Tooltip title="清除该属性，回到主题默认">
            <Button
              type="text"
              size="small"
              aria-label={`清除${def.label}`}
              icon={<RotateCcw size={12} />}
              onClick={() => write(null)}
            />
          </Tooltip>
        ) : null}
      </div>

      <div className="field-body">{control}</div>

      {def.kind === 'font' ? (
        <>
          {customMode ? (
            <Input
              size="small"
              style={{ marginTop: 4 }}
              value={customDraft}
              placeholder={'直接写 font-family，如 "LXGW WenKai", serif'}
              aria-label="自定义字体族"
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={commitCustom}
              onPressEnter={commitCustom}
            />
          ) : null}
          <div
            className="field-sample"
            style={{ fontFamily: value || inherited || undefined, color: token.colorTextSecondary }}
          >
            {SAMPLE}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default memo(FieldRowInner);
