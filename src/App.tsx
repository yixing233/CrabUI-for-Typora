import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  Empty,
  Layout,
  Popconfirm,
  Select,
  Space,
  Splitter,
  Switch,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  FileCode2,
  FileDown,
  FolderOpen,
  Info,
  Moon,
  Power,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
} from 'lucide-react';
import { PRESETS, TARGETS, TARGET_MAP } from './lib/model';
import type { FieldId, Values } from './lib/model';
import { buildCss, countOverrides, exportCss, sanitizeValues, targetCount } from './lib/css';
import {
  detectThemes,
  loadConfig,
  patchBaseUserCss,
  patchThemeCss,
  readPreviewCss,
  restartTypora,
  revealPath,
  saveConfig,
  typoraInfo,
  writeOverrideCss,
} from './lib/api';
import type { ThemeFlavor, ThemesInfo, TyporaInfo } from './lib/api';
import PreviewPane from './components/PreviewPane';
import type { PreviewHandle } from './components/PreviewPane';
import FieldRow from './components/FieldRow';
import CssDrawer from './components/CssDrawer';
import TargetList from './components/TargetList';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

const FLAVOR_ORDER: ThemeFlavor[] = ['plus', 'classic', 'simple', 'other'];
const FLAVOR_LABEL: Record<ThemeFlavor, string> = {
  plus: 'Crab Plus',
  classic: 'Crab Classic',
  simple: 'Crab Simple',
  other: '其它主题',
};

export interface AppProps {
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
}

export default function App({ dark, onDarkChange }: AppProps) {
  const { message, notification, modal } = AntApp.useApp();
  const { token } = theme.useToken();
  const previewRef = useRef<PreviewHandle>(null);

  const [themesInfo, setThemesInfo] = useState<ThemesInfo | null>(null);
  const [themeFile, setThemeFile] = useState('');
  const [themeCss, setThemeCss] = useState('');
  const [baseDir, setBaseDir] = useState('');
  /** 所选主题自身是深色主题（预览文档用它，不跟界面明暗联动） */
  const [themeDark, setThemeDark] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [enabled, setEnabled] = useState(true);
  const [activeTarget, setActiveTarget] = useState('base');
  const [presetId, setPresetId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** 预览文档重建后自增，驱动各行重读"当前生效值" */
  const [refreshKey, setRefreshKey] = useState(0);
  /** 配置读完才允许回写，避免用空配置覆盖磁盘上的内容 */
  const [loaded, setLoaded] = useState(false);
  /** Typora 的安装位置与运行状态，供「重启 Typora」按钮用 */
  const [typora, setTypora] = useState<TyporaInfo>({ exe: null, running: false });
  /** 自动探测失败时用户手选的 Typora 安装目录，随配置一起存盘 */
  const [typoraDir, setTyporaDir] = useState('');
  const [restarting, setRestarting] = useState(false);

  /** 磁盘配置里我们不认识的顶层字段，回写时原样保留 */
  const extraRef = useRef<Record<string, unknown>>({});
  const darkTouched = useRef(false);
  const saveWarned = useRef(false);

  const target = TARGET_MAP[activeTarget] ?? TARGETS[0];
  const themeEntry = themesInfo?.themes.find((t) => t.file === themeFile);
  const themeName = themeEntry?.name ?? themeFile.replace(/\.css$/i, '');
  /** 总开关关掉时一律按"没有覆盖"处理：预览、导出、保存、写入主题走同一份数据 */
  const activeValues = useMemo(() => (enabled ? values : {}), [enabled, values]);
  const overrideCss = useMemo(() => buildCss(activeValues), [activeValues]);
  const dirty = useMemo(() => countOverrides(values), [values]);
  const targetDirty = targetCount(values, target.id);

  const fail = useCallback(
    (title: string, e: unknown) => {
      const detail = e instanceof Error ? e.message : String(e);
      notification.error({ message: title, description: detail, placement: 'bottomRight' });
      setStatus(`${title}：${detail}`);
    },
    [notification],
  );

  const refreshInfo = useCallback(async (dir: string) => {
    try {
      setThemesInfo(await detectThemes(dir));
    } catch {
      // 状态标记刷新失败不影响主流程
    }
  }, []);

  /** 探 Typora 的位置与运行状态；探不到只是让按钮改文案，不打断主流程 */
  const refreshTypora = useCallback(async (hint: string) => {
    try {
      setTypora(await typoraInfo(hint || null));
    } catch {
      setTypora({ exe: null, running: false });
    }
  }, []);

  const loadTheme = useCallback(
    async (dir: string, file: string) => {
      setThemeFile(file);
      try {
        const res = await readPreviewCss(dir, file);
        setThemeCss(res.css);
        setBaseDir(res.baseDir);
        setThemeDark(res.dark);
        if (!darkTouched.current) onDarkChange(res.dark);
      } catch (e) {
        setThemeCss('');
        setBaseDir('');
        fail('读取主题 CSS 失败', e);
      }
    },
    [fail, onDarkChange],
  );

  /** 启动 / 换目录：探测 → 读配置 → 选主题 → 读预览 CSS，任何一步失败都保持界面可用 */
  const boot = useCallback(
    async (dir: string | null) => {
      setBusy(true);
      try {
        const info = await detectThemes(dir);
        setThemesInfo(info);

        let wantFile = '';
        let wantTypora = '';
        let configBroken = false;
        try {
          const raw = await loadConfig(info.dir);
          const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          const rest: Record<string, unknown> = { ...parsed };
          delete rest.version;
          delete rest.enabled;
          delete rest.values;
          delete rest.studio;
          // 换目录时不要把上一个目录的配置带过去：没有配置文件就一律回到空状态
          extraRef.current = rest;
          setValues(sanitizeValues(parsed.values));
          setEnabled(parsed.enabled !== false);
          const studio = (parsed.studio ?? {}) as Record<string, unknown>;
          if (typeof studio.themeFile === 'string') wantFile = studio.themeFile;
          if (typeof studio.typoraDir === 'string') wantTypora = studio.typoraDir;
          setActiveTarget(
            typeof studio.activeTarget === 'string' && TARGET_MAP[studio.activeTarget]
              ? studio.activeTarget
              : TARGETS[0].id,
          );
        } catch (e) {
          // 解析失败时禁止自动回写，否则 400ms 后就把用户手改坏的原文件覆盖掉了
          configBroken = true;
          notification.warning({
            message: 'crab-typography.json 解析失败，本次不会自动回写该文件',
            description: `${e instanceof Error ? e.message : String(e)} —— 修好文件后重新探测，或先在界面里改一次并手动保存。`,
            duration: 0,
            placement: 'bottomRight',
          });
        }

        const file = info.themes.find((t) => t.file === wantFile)?.file ?? info.themes[0]?.file ?? '';
        if (file) await loadTheme(info.dir, file);
        else {
          setThemeFile('');
          setThemeCss('');
        }
        setTyporaDir(wantTypora);
        void refreshTypora(wantTypora);
        setStatus(`已探测到 ${info.themes.length} 个 Crab 主题`);
        setLoaded(!configBroken);
      } catch (e) {
        fail('探测 themes 目录失败', e);
      } finally {
        setBusy(false);
      }
    },
    [fail, loadTheme, notification, refreshTypora],
  );

  useEffect(() => {
    void boot(null);
    // 仅启动时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 400ms 防抖回写配置；只覆盖 version / enabled / values / studio
  useEffect(() => {
    if (!loaded || !themesInfo) return;
    const dir = themesInfo.dir;
    const timer = window.setTimeout(() => {
      const payload = {
        ...extraRef.current,
        version: '1.0.0',
        enabled,
        values,
        studio: { themeFile, activeTarget, typoraDir },
      };
      saveConfig(dir, JSON.stringify(payload, null, 2)).catch((e) => {
        if (saveWarned.current) return;
        saveWarned.current = true;
        fail('保存 crab-typography.json 失败', e);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [values, enabled, themeFile, activeTarget, typoraDir, loaded, themesInfo, fail]);

  // Typora 可能是在本应用启动之后才被打开 / 关掉的，回到窗口时补探一次，
  // 免得按钮还写着「启动 Typora」却把正在用的实例给关了
  useEffect(() => {
    const onFocus = () => void refreshTypora(typoraDir);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [typoraDir, refreshTypora]);

  const handleChange = useCallback((targetId: string, field: FieldId, value: string | null) => {
    setValues((prev) => {
      const bag = { ...(prev[targetId] ?? {}) };
      if (value === null) delete bag[field];
      else bag[field] = value;
      const next = { ...prev };
      if (Object.keys(bag).length) next[targetId] = bag;
      else delete next[targetId];
      return next;
    });
  }, []);

  const handleSelectTarget = useCallback((id: string) => {
    setActiveTarget(id);
    previewRef.current?.scrollToTarget(id);
  }, []);

  const handleDocReady = useCallback(() => setRefreshKey((k) => k + 1), []);

  const resetTarget = () => {
    setValues((prev) => {
      const next = { ...prev };
      delete next[target.id];
      return next;
    });
    setStatus(`已重置：${target.name}`);
  };

  const resetAll = () => {
    setValues({});
    setPresetId(undefined);
    setStatus('已清空全部自定义');
  };

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setValues(sanitizeValues(preset.values));
    setStatus(`已套用预设：${preset.name}`);
  };

  const pickDir = async () => {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: '选择 Typora themes 目录',
      });
      if (typeof picked === 'string') await boot(picked);
    } catch (e) {
      fail('打开目录选择器失败', e);
    }
  };

  const saveOverride = async () => {
    if (!themesInfo) return;
    const dir = themesInfo.dir;
    try {
      const path = await writeOverrideCss(dir, exportCss(activeValues, themeName));
      message.success('已保存 crab-typography.css');
      setStatus(`已保存：${path}`);
      if (!themesInfo.baseUserImports) {
        modal.confirm({
          title: '顺便让主题自动加载它？',
          content:
            '会在 themes/base.user.css 里加一行 @import "crab-typography.css"，这样所有主题都会带上这套排版（重启 Typora 生效）。',
          okText: '好，加上',
          cancelText: '先不用',
          onOk: async () => {
            try {
              await patchBaseUserCss(dir, true);
              message.success('已更新 base.user.css');
              setStatus('已在 base.user.css 里加入 @import');
            } catch (e) {
              fail('写入 base.user.css 失败', e);
            }
            await refreshInfo(dir);
          },
        });
      }
    } catch (e) {
      fail('保存 crab-typography.css 失败', e);
    }
  };

  const writeIntoTheme = async () => {
    if (!themesInfo || !themeFile) return;
    try {
      const path = await patchThemeCss(themesInfo.dir, themeFile, buildCss(activeValues));
      message.success(`已写入 ${themeName}`);
      setStatus(`已写入主题：${path}`);
      await refreshInfo(themesInfo.dir);
    } catch (e) {
      fail('写入主题失败', e);
    }
  };

  const removeFromTheme = async () => {
    if (!themesInfo || !themeFile) return;
    try {
      await patchThemeCss(themesInfo.dir, themeFile, null);
      message.success(`已从 ${themeName} 移除`);
      setStatus('已移除主题里的覆盖区块');
      await refreshInfo(themesInfo.dir);
    } catch (e) {
      fail('移除主题覆盖失败', e);
    }
  };

  const openThemesDir = async () => {
    if (!themesInfo) return;
    try {
      await revealPath(themesInfo.dir);
    } catch (e) {
      fail('打开目录失败', e);
    }
  };

  /** 自动探测失败时手选 Typora 安装目录，选中的路径随配置存盘 */
  const pickTyporaDir = async () => {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: '选择 Typora 安装目录（里面应有 Typora.exe）',
      });
      if (typeof picked !== 'string') return;
      const info = await typoraInfo(picked);
      if (!info.exe) {
        fail('这个目录里没有 Typora.exe', `请选到 Typora 的安装目录本身：${picked}`);
        return;
      }
      setTyporaDir(picked);
      setTypora(info);
      setStatus(`已指定 Typora：${info.exe}`);
    } catch (e) {
      fail('指定 Typora 位置失败', e);
    }
  };

  /**
   * 重启 Typora 让写进主题的排版生效。
   * 默认请它正常退出：有未保存文档时 Typora 会弹窗留住自己，这时不硬来，
   * 而是回到界面问用户——要么去存盘，要么明确选择强制重启。
   */
  const doRestart = async (force: boolean): Promise<void> => {
    setRestarting(true);
    try {
      const res = await restartTypora(typoraDir || null, force);
      if (res.outcome === 'blocked') {
        setStatus('Typora 没有退出，排版改动尚未生效');
        void refreshTypora(typoraDir);
        modal.confirm({
          title: 'Typora 没有退出',
          width: 460,
          content: (
            <div>
              <div>
                它可能正在等你确认未保存的文档。建议切过去保存后再重启——强制重启会丢掉未保存的内容，
                而且会关掉所有 Typora 窗口。
              </div>
              {res.detail ? (
                <pre
                  style={{
                    margin: '8px 0 0',
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    color: token.colorTextTertiary,
                  }}
                >
                  {res.detail}
                </pre>
              ) : null}
            </div>
          ),
          okText: '强制重启',
          okButtonProps: { danger: true },
          cancelText: '我去保存',
          onOk: () => void doRestart(true),
        });
        return;
      }
      const verb = res.outcome === 'started' ? '已启动' : '已重启';
      message.success(`Typora ${verb}`);
      setStatus(`${verb} ${res.exe}`);
      await refreshTypora(typoraDir);
    } catch (e) {
      fail('重启 Typora 失败', e);
    } finally {
      setRestarting(false);
    }
  };

  const themeOptions = useMemo(
    () =>
      FLAVOR_ORDER.map((flavor) => ({
        label: FLAVOR_LABEL[flavor],
        options: (themesInfo?.themes ?? [])
          .filter((t) => t.flavor === flavor)
          .map((t) => ({ value: t.file, label: t.dark ? `${t.name} · 深色` : t.name })),
      })).filter((g) => g.options.length > 0),
    [themesInfo],
  );

  const presetOptions = useMemo(
    () => PRESETS.map((p) => ({ value: p.id, label: p.name, title: `${p.name} · ${p.desc}`, desc: p.desc })),
    [],
  );

  /** 抽屉里展示的完整 CSS：拖滑块时不必每帧重新拼字符串 */
  const exportedCss = useMemo(() => exportCss(activeValues, themeName), [activeValues, themeName]);

  const barStyle = {
    height: 48,
    flex: '0 0 48px',
    background: token.colorBgContainer,
    padding: '0 12px',
  } as const;

  return (
    <Layout className="app-shell">
      <Header
        className="bar"
        style={{ ...barStyle, borderBottom: `1px solid ${token.colorSplit}` }}
      >
        <Sparkles size={16} color={token.colorPrimary} />
        <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
          CrabUI for Typora
        </Text>

        <div style={{ flex: 1, minWidth: 60, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Text
            type="secondary"
            ellipsis
            style={{ fontSize: 12, flex: '0 1 auto', minWidth: 0 }}
            title={themesInfo?.dir}
          >
            {themesInfo?.dir || '未选择 themes 目录'}
          </Text>
          <Tooltip title="选择 themes 目录">
            <Button
              type="text"
              size="small"
              aria-label="选择 themes 目录"
              icon={<FolderOpen size={14} />}
              onClick={pickDir}
            />
          </Tooltip>
          <Tooltip title="重新探测">
            <Button
              type="text"
              size="small"
              aria-label="重新探测"
              loading={busy}
              icon={<RefreshCw size={14} />}
              onClick={() => void boot(themesInfo?.dir ?? null)}
            />
          </Tooltip>
        </div>

        <Select
          size="small"
          style={{ width: 216 }}
          placeholder="选择主题"
          value={themeFile || undefined}
          options={themeOptions}
          aria-label="预览主题"
          showSearch={{
            filterOption: (input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase()),
          }}
          onChange={(file: string) => themesInfo && void loadTheme(themesInfo.dir, file)}
        />
        <Tooltip title={dark ? '切到浅色界面' : '切到深色界面'}>
          <Button
            type="text"
            size="small"
            aria-label="切换界面明暗"
            icon={dark ? <Sun size={14} /> : <Moon size={14} />}
            onClick={() => {
              darkTouched.current = true;
              onDarkChange(!dark);
            }}
          />
        </Tooltip>
        <Tooltip title="关掉后预览、导出与写入都按「无覆盖」处理，配置本身保留">
          <Switch
            size="small"
            checked={enabled}
            onChange={setEnabled}
            checkedChildren="启用覆盖"
            unCheckedChildren="已停用"
          />
        </Tooltip>
      </Header>

      <Content style={{ minHeight: 0, overflow: 'hidden' }}>
        <Splitter style={{ height: '100%' }}>
          <Splitter.Panel defaultSize="46%" min={380}>
            <div className="ctrl-split">
              <TargetList active={target.id} values={values} onSelect={handleSelectTarget} />
              <div className="field-panel" style={{ borderLeft: `1px solid ${token.colorSplit}` }}>
                <div className="field-head" style={{ marginBottom: 2 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    {target.name}
                  </Text>
                  {target.tip ? (
                    <Tooltip title={target.tip}>
                      <Info size={13} aria-label="条目说明" style={{ opacity: 0.5 }} />
                    </Tooltip>
                  ) : null}
                  <span className="bar-spacer" />
                  <Button
                    type="text"
                    size="small"
                    disabled={!targetDirty}
                    icon={<RotateCcw size={13} />}
                    onClick={resetTarget}
                  >
                    重置本项
                  </Button>
                </div>
                {target.fields.map((field) => (
                  <FieldRow
                    key={`${target.id}:${field}`}
                    target={target}
                    field={field}
                    value={values[target.id]?.[field]}
                    preview={previewRef}
                    refreshKey={refreshKey}
                    onChange={handleChange}
                  />
                ))}
              </div>
            </div>
          </Splitter.Panel>

          <Splitter.Panel>
            {themeCss ? (
              <PreviewPane
                ref={previewRef}
                themeCss={themeCss}
                baseDir={baseDir}
                dark={themeDark}
                overrideCss={overrideCss}
                onDocReady={handleDocReady}
              />
            ) : (
              <div className="preview-empty">
                <Empty
                  description={
                    themesInfo ? '这个目录里没找到可预览的 Crab 主题' : '请选择 Typora 的 themes 目录'
                  }
                >
                  <Button type="primary" icon={<FolderOpen size={14} />} onClick={pickDir}>
                    选择 themes 目录
                  </Button>
                </Empty>
              </div>
            )}
          </Splitter.Panel>
        </Splitter>
      </Content>

      <Footer className="bar" style={{ ...barStyle, borderTop: `1px solid ${token.colorSplit}` }}>
        <Select
          size="small"
          style={{ width: 132, flex: '0 0 auto' }}
          placeholder="套用预设"
          value={presetId}
          options={presetOptions}
          aria-label="排版预设"
          optionRender={(opt) => (
            <div>
              <div>{opt.data.label}</div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{opt.data.desc}</div>
            </div>
          )}
          onChange={applyPreset}
        />

        <Space size={6} style={{ flex: '0 0 auto' }}>
          <Popconfirm
            title="清空全部自定义？"
            description="所有段落的改动都会回到主题默认。"
            okText="清空"
            cancelText="算了"
            onConfirm={resetAll}
          >
            <Button size="small" danger disabled={!dirty} icon={<Trash2 size={14} />}>
              全部重置
            </Button>
          </Popconfirm>
          <Button size="small" icon={<FileCode2 size={14} />} onClick={() => setDrawerOpen(true)}>
            查看 CSS
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={!themesInfo}
            icon={<Save size={14} />}
            onClick={saveOverride}
          >
            保存 crab-typography.css
          </Button>
          <Popconfirm
            title={`把当前排版写进 ${themeName || '所选主题'}？`}
            description="首次写入会先生成 .crab-bak 备份，之后只替换标记区块。"
            okText="写入"
            cancelText="取消"
            onConfirm={writeIntoTheme}
          >
            <Button size="small" disabled={!themeFile} icon={<FileDown size={14} />}>
              写入所选主题
            </Button>
          </Popconfirm>
          {themeEntry?.patched ? (
            <Popconfirm
              title="移除该主题里的覆盖区块？"
              okText="移除"
              cancelText="取消"
              onConfirm={removeFromTheme}
            >
              <Button size="small" icon={<Undo2 size={14} />}>
                移除写入
              </Button>
            </Popconfirm>
          ) : null}
          {!typora.exe ? (
            <Tooltip title="没自动找到 Typora.exe，点这里手动指定安装目录">
              <Button size="small" icon={<FolderOpen size={14} />} onClick={pickTyporaDir}>
                指定 Typora
              </Button>
            </Tooltip>
          ) : typora.running ? (
            <Popconfirm
              title="重启 Typora？"
              description={
                <span style={{ display: 'inline-block', maxWidth: 280 }}>
                  先请它正常退出（有未保存的文档它会弹窗问你），退出后自动重新打开。
                  <br />
                  只有已经写进磁盘的改动才会生效——记得先「保存 crab-typography.css」或「写入所选主题」。
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {typora.exe}
                  </Text>
                </span>
              }
              okText="重启"
              cancelText="取消"
              onConfirm={() => void doRestart(false)}
            >
              <Button size="small" loading={restarting} icon={<RotateCw size={14} />}>
                重启 Typora
              </Button>
            </Popconfirm>
          ) : (
            <Tooltip title={`${typora.exe}（当前未运行）`}>
              <Button
                size="small"
                loading={restarting}
                icon={<Power size={14} />}
                onClick={() => void doRestart(false)}
              >
                启动 Typora
              </Button>
            </Tooltip>
          )}
          <Button
            size="small"
            disabled={!themesInfo}
            icon={<FolderOpen size={14} />}
            onClick={openThemesDir}
          >
            打开目录
          </Button>
        </Space>

        <Text
          type="secondary"
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'right',
            fontSize: 12,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
          title={status}
        >
          已自定义 {dirty} 项{status ? ` · ${status}` : ''}
        </Text>
      </Footer>

      <CssDrawer
        open={drawerOpen}
        css={exportedCss}
        onClose={() => setDrawerOpen(false)}
        onSave={saveOverride}
      />
    </Layout>
  );
}
