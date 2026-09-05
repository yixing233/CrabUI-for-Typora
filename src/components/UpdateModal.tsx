import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Divider,
  Input,
  List,
  Modal,
  Progress,
  Space,
  Tag,
  Typography,
} from 'antd';
import { listen } from '@tauri-apps/api/event';
import { CloudDownload, Download, ExternalLink, Search } from 'lucide-react';
import {
  applyThemeUpdate,
  checkAppUpdate,
  openExternal,
  planThemeUpdate,
  type AppRelease,
  type AssetKind,
  type UpdatePlan,
  type UpdateProgress,
  type UpdateReport,
  type UpdateStatus,
} from '../lib/api';
import {
  formatSize,
  groupByKind,
  KIND_LABEL,
  KIND_ORDER,
  pickDownloads,
  STATUS_LABEL,
  totalSize,
} from '../lib/update';

const { Text, Paragraph } = Typography;

const STATUS_COLOR: Record<UpdateStatus, string> = {
  new: 'green',
  changed: 'blue',
  same: 'default',
  rejected: 'red',
};

export interface UpdateModalProps {
  open: boolean;
  /** 当前的 themes 目录，没探到时为空串 */
  dir: string;
  source: string;
  kinds: AssetKind[];
  /** 上次装好的主题包版本，空串表示从没用过在线更新 */
  installedVersion: string;
  onSourceChange: (source: string) => void;
  onKindsChange: (kinds: AssetKind[]) => void;
  /** 待更新文件数变化时告诉 App，让顶栏按钮挂红点 */
  onPendingChange: (count: number) => void;
  onClose: () => void;
  /** 装完交回 App：那边要把标记区块写回去、刷新列表、记下装了哪个版本 */
  onInstalled: (report: UpdateReport) => void | Promise<void>;
}

/**
 * 主题在线更新与应用版本检查。
 *
 * 两件事放一个弹窗里：都是「问一次远端、告诉用户有没有新东西」。应用那边只查不装——
 * 装的话得有签名密钥，那是另一回事，这一版不做。
 */
export default function UpdateModal({
  open,
  dir,
  source,
  kinds,
  installedVersion,
  onSourceChange,
  onKindsChange,
  onPendingChange,
  onClose,
  onInstalled,
}: UpdateModalProps) {
  const { notification } = AntApp.useApp();
  const [checking, setChecking] = useState(false);
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [report, setReport] = useState<UpdateReport | null>(null);
  const [showSame, setShowSame] = useState(false);
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [checkingApp, setCheckingApp] = useState(false);

  // 进度事件只在安装期间有人 emit，所以整个弹窗打开期间收着就行，不必跟着 installing 反复挂卸。
  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | undefined;
    let dead = false;
    listen<UpdateProgress>('theme-update-progress', (event) => setProgress(event.payload)).then(
      (un) => {
        if (dead) un();
        else stop = un;
      },
    );
    return () => {
      dead = true;
      stop?.();
    };
  }, [open]);

  // 换了 themes 目录，之前那份比对结果就不作数了
  useEffect(() => {
    setPlan(null);
    setReport(null);
    setProgress(null);
  }, [dir]);

  const groups = useMemo(() => (plan ? groupByKind(plan.items) : []), [plan]);
  const downloads = useMemo(() => (plan ? pickDownloads(plan.items, kinds) : []), [plan, kinds]);
  const bytes = totalSize(downloads);

  // 待更新数变了就同步给 App：关掉弹窗后顶栏那个红点还替用户记着这件事
  useEffect(() => {
    onPendingChange(downloads.length);
  }, [downloads.length, onPendingChange]);

  const oops = (message: string, e: unknown) =>
    notification.error({ message, description: String(e), placement: 'bottomRight' });

  const checkApp = async () => {
    setCheckingApp(true);
    try {
      setRelease(await checkAppUpdate());
    } catch (e) {
      oops('检查应用更新失败', e);
    } finally {
      setCheckingApp(false);
    }
  };

  const goDownload = async () => {
    if (!release) return;
    try {
      await openExternal(release.url);
    } catch (e) {
      oops('打开发布页失败', e);
    }
  };

  const checkThemes = async () => {
    if (!dir) {
      notification.warning({
        message: '还没有 themes 目录',
        description: '先在主界面探测或手选一个 themes 目录，再来检查更新。',
        placement: 'bottomRight',
      });
      return;
    }
    setChecking(true);
    setReport(null);
    setProgress(null);
    try {
      setPlan(await planThemeUpdate(dir, source));
    } catch (e) {
      setPlan(null);
      oops('检查主题更新失败', e);
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    if (!plan || downloads.length === 0) return;
    setInstalling(true);
    setReport(null);
    setProgress({ done: 0, total: downloads.length, path: '', ok: true });
    try {
      const result = await applyThemeUpdate(
        dir,
        source,
        downloads.map((item) => item.path),
        kinds.includes('script'),
      );
      setReport(result);
      await onInstalled(result);
      // 重算一遍，列表就地变成「已是最新」；重算失败不影响已经装好的那些
      try {
        setPlan(await planThemeUpdate(dir, source));
      } catch {
        /* 装完了才是重点，列表刷不出来无所谓 */
      }
      if (result.failed.length) {
        notification.warning({
          message: `装好 ${result.installed.length} 个，${result.failed.length} 个没成功`,
          description: result.failed.map((f) => `${f.path}：${f.reason}`).join('；'),
          placement: 'bottomRight',
        });
      } else {
        notification.success({
          message: `主题已更新到 ${result.version}`,
          description: `${result.installed.length} 个文件已就位，改动要重启 Typora 才生效。`,
          placement: 'bottomRight',
        });
      }
    } catch (e) {
      oops('下载失败', e);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space size={8}>
          <CloudDownload size={16} />
          在线更新
        </Space>
      }
      width={720}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            icon={<Download size={14} />}
            disabled={downloads.length === 0}
            loading={installing}
            onClick={install}
          >
            {downloads.length > 0
              ? `下载并安装 ${downloads.length} 个（${formatSize(bytes)}）`
              : '下载并安装'}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap size={8}>
          <Text strong>应用版本</Text>
          <Button size="small" icon={<Search size={13} />} loading={checkingApp} onClick={checkApp}>
            检查应用更新
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            只查、只提示，装还是由你点开发布页自己装
          </Text>
        </Space>

        {release &&
          (release.newer ? (
            <Alert
              type="info"
              showIcon
              message={`有新版本 ${release.latest}（当前 ${release.current}）`}
              description={
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {release.published && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      发布于 {release.published}
                    </Text>
                  )}
                  {release.notes && (
                    <Paragraph
                      style={{
                        fontSize: 12,
                        marginBottom: 0,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 150,
                        overflow: 'auto',
                      }}
                    >
                      {release.notes}
                    </Paragraph>
                  )}
                  <Button
                    size="small"
                    type="primary"
                    icon={<ExternalLink size={13} />}
                    onClick={goDownload}
                  >
                    去下载
                  </Button>
                </Space>
              }
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              已经是最新版 {release.current}。
            </Text>
          ))}

        <Divider style={{ margin: '4px 0' }} />

        <Space wrap size={8}>
          <Text strong>主题包</Text>
          {installedVersion && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              上次装的是 {installedVersion}
            </Text>
          )}
        </Space>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            placeholder="https://…/themes/manifest.json"
            spellCheck={false}
          />
          <Button
            type="primary"
            icon={<Search size={14} />}
            loading={checking}
            onClick={checkThemes}
          >
            检查更新
          </Button>
        </Space.Compact>
        <Text type="secondary" style={{ fontSize: 12 }}>
          每个文件的下载地址都相对这份清单解析，所以换源只需改这一行，清单本身也指不到别的主机上去。
        </Text>

        {plan && (
          <>
            <Space wrap size={8} style={{ marginTop: 4 }}>
              <Tag color="blue">主题包 {plan.manifest.version}</Tag>
              {plan.manifest.released && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  发布于 {plan.manifest.released}
                </Text>
              )}
            </Space>
            {plan.manifest.notes && <Text style={{ fontSize: 12 }}>{plan.manifest.notes}</Text>}

            <Space wrap size={16}>
              <Checkbox.Group
                value={kinds}
                onChange={(next) => onKindsChange(next as AssetKind[])}
                options={KIND_ORDER.map((kind) => ({ label: KIND_LABEL[kind], value: kind }))}
              />
              <Checkbox checked={showSame} onChange={(e) => setShowSame(e.target.checked)}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  连已是最新的也列出来
                </Text>
              </Checkbox>
            </Space>

            {kinds.includes('script') && (
              <Alert
                type="warning"
                showIcon
                message="脚本类文件会被执行，不只是换个配色"
                description="crab-enhance.js 会被 Typora 加载进窗口里执行，crab-inject.ps1 是 PowerShell 脚本。把它们纳入在线更新，等于让一次换主题变成一次代码执行——上游仓库被投毒或这份清单被人换掉，后果和主题配色不在一个量级。只在你确实信得过这个源时才勾。"
              />
            )}

            {groups.map((group) => {
              const visible = showSame
                ? group.items
                : group.items.filter((item) => item.status !== 'same');
              const off = !kinds.includes(group.kind);
              return (
                <List
                  key={group.kind}
                  size="small"
                  bordered
                  style={{ opacity: off ? 0.55 : 1 }}
                  header={
                    <Space wrap size={8}>
                      <Text strong style={{ fontSize: 13 }}>
                        {KIND_LABEL[group.kind]}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        共 {group.items.length} 个
                        {group.pending > 0 && ` · 待更新 ${formatSize(group.pending)}`}
                        {off && ' · 这一类没有勾选'}
                      </Text>
                    </Space>
                  }
                  dataSource={visible}
                  locale={{ emptyText: '这一类都已是最新' }}
                  renderItem={(item) => (
                    <List.Item>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: item.path }}>
                          {item.path}
                        </Text>
                        {item.reason && (
                          <div>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {item.reason}
                            </Text>
                          </div>
                        )}
                      </div>
                      <Space size={8}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatSize(item.size)}
                        </Text>
                        <Tag color={STATUS_COLOR[item.status]} style={{ marginInlineEnd: 0 }}>
                          {STATUS_LABEL[item.status]}
                        </Tag>
                      </Space>
                    </List.Item>
                  )}
                />
              );
            })}

            {progress && (
              <>
                <Progress
                  percent={
                    progress.total ? Math.round((progress.done / progress.total) * 100) : 0
                  }
                  status={installing ? 'active' : progress.ok ? 'success' : 'exception'}
                  format={() => `${progress.done}/${progress.total}`}
                />
                {installing && progress.path && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    正在装 {progress.path}
                  </Text>
                )}
              </>
            )}

            {report && report.failed.length > 0 && (
              <Alert
                type="error"
                showIcon
                message={`${report.failed.length} 个文件没有装上`}
                description={
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    {report.failed.map((f) => (
                      <Text key={f.path} style={{ fontSize: 12 }}>
                        {f.path}：{f.reason}
                      </Text>
                    ))}
                  </Space>
                }
              />
            )}
          </>
        )}
      </Space>
    </Modal>
  );
}
