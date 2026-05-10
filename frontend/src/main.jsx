import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App.jsx';
import { UiPreferencesProvider, useUiPreferences } from './context/UiPreferencesContext.jsx';
import './styles/index.css';

const ThemedApp = () => {
  const { antdConfig } = useUiPreferences();
  return (
    <ConfigProvider {...antdConfig}>
      <App />
    </ConfigProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UiPreferencesProvider>
      <ThemedApp />
    </UiPreferencesProvider>
  </React.StrictMode>,
);
