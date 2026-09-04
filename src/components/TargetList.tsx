import { memo } from 'react';
import { Badge, Tooltip, theme } from 'antd';
import {
  Braces,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  LayoutPanelLeft,
  List,
  Pilcrow,
  Quote,
  Table,
} from 'lucide-react';
import { TARGETS } from '../lib/model';
import type { Values } from '../lib/model';
import { targetCount } from '../lib/css';

type IconComp = typeof Pilcrow;

/** TARGETS 里的 icon 是 lucide 导出名，这里显式登记，避免整包引入 */
const ICONS: Record<string, IconComp> = {
  LayoutPanelLeft,
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Quote,
  List,
  Code,
  Braces,
  Table,
};

export interface TargetListProps {
  active: string;
  values: Values;
  onSelect: (targetId: string) => void;
}

function TargetListInner({ active, values, onSelect }: TargetListProps) {
  const { token } = theme.useToken();

  return (
    <nav className="target-list" aria-label="段落条目">
      {TARGETS.map((t) => {
        const Icon = ICONS[t.icon] ?? Pilcrow;
        const count = targetCount(values, t.id);
        const on = t.id === active;
        return (
          <Tooltip key={t.id} title={t.tip} placement="right" mouseEnterDelay={0.6}>
            <button
              type="button"
              className="target-item"
              aria-current={on ? 'true' : undefined}
              onClick={() => onSelect(t.id)}
              style={
                on
                  ? { background: token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 600 }
                  : undefined
              }
            >
              <Icon size={14} style={{ flex: '0 0 auto' }} />
              <span className="target-item-name">{t.name}</span>
              {count ? (
                <Badge
                  count={count}
                  size="small"
                  color={on ? token.colorPrimary : token.colorTextQuaternary}
                />
              ) : null}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export default memo(TargetListInner);
