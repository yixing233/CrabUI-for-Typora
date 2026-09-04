import { App as AntApp, Button, Drawer, Space, Typography } from 'antd';
import { Copy, Save } from 'lucide-react';

const { Text } = Typography;

export interface CssDrawerProps {
  open: boolean;
  css: string;
  onClose: () => void;
  /** 保存为 themes/crab-typography.css */
  onSave: () => void;
}

/** 展示 exportCss() 的完整结果，可选中复制或直接保存 */
export default function CssDrawer({ open, css, onClose, onSave }: CssDrawerProps) {
  const { message } = AntApp.useApp();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(css);
      message.success('已复制到剪贴板');
      return;
    } catch {
      // 无剪贴板权限时退回老办法
    }
    const area = document.createElement('textarea');
    area.value = css;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    if (ok) message.success('已复制到剪贴板');
    else message.error('复制失败，请手动选中复制');
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      width={680}
      title="生成的 CSS"
      extra={
        <Space>
          <Button size="small" icon={<Copy size={14} />} onClick={copy}>
            复制
          </Button>
          <Button size="small" type="primary" icon={<Save size={14} />} onClick={onSave}>
            保存为 crab-typography.css
          </Button>
        </Space>
      }
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        只包含你改过的属性，其余全部沿用主题原值。
      </Text>
      <pre className="css-pre" style={{ marginTop: 10 }}>
        {css}
      </pre>
    </Drawer>
  );
}
