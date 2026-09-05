import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

/**
 * 明暗算法要在 ConfigProvider 上切换，而"跟随所选主题"的判断在 App 里，
 * 所以把 dark 状态放在这一层，往下传给 App。
 */
function Root() {
  const [dark, setDark] = useState(false);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        // 主色取应用图标那道蓝→青→绿渐变的蓝端（见 app-icon.svg）。
        // antd 的 colorPrimary 只吃单色，整条渐变落在 styles.css 的 .brand-title 上。
        // 取蓝端而非青/绿端：绿是 success、青近 info/link，拿来当主色会跟语义色打架，
        // 而蓝正好是圆环下半部视觉面积最大的那一段。
        token: { colorPrimary: '#1B4DE8', borderRadius: 6, fontSize: 13 },
        components: { Slider: { handleSize: 9, handleSizeHover: 11 } },
      }}
    >
      <AntApp>
        <App dark={dark} onDarkChange={setDark} />
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
