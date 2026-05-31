import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';

export const renderWithRouter = (ui, { route = '/' } = {}) => render(
  <ConfigProvider>
    <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
  </ConfigProvider>
);
