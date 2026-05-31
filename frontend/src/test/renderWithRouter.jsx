import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { UiPreferencesProvider } from '../context/UiPreferencesContext';

export const renderWithRouter = (ui, { route = '/' } = {}) => render(
  <ConfigProvider>
    <UiPreferencesProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </UiPreferencesProvider>
  </ConfigProvider>
);

export const renderWithProviders = (ui) => render(
  <ConfigProvider>
    <UiPreferencesProvider>{ui}</UiPreferencesProvider>
  </ConfigProvider>
);
