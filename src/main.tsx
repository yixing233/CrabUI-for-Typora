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
        token: { colorPrimary: '#e0703c', borderRadius: 6, fontSize: 13 },
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
