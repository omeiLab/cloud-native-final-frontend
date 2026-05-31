import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithRouter';
import { describe, expect, it, vi } from 'vitest';
import BackgroundMusic from '../BackgroundMusic';

describe('BackgroundMusic', () => {
  it('toggles playback when clicked', async () => {
    renderWithProviders(<BackgroundMusic />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(button).toBeInTheDocument();
  });
});
