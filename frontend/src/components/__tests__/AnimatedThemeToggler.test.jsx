import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getThemeTransitionClipPaths } from '../AnimatedThemeToggler';

const setColorModeMock = vi.fn();

vi.mock('../../context/UiPreferencesContext', () => ({
  useUiPreferences: () => ({
    colorMode: 'light',
    setColorMode: setColorModeMock
  })
}));

import AnimatedThemeToggler from '../AnimatedThemeToggler';

describe('AnimatedThemeToggler', () => {
  it('generates clip paths for supported transition variants', () => {
    const variants = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'rectangle', 'star'];
    variants.forEach((variant) => {
      const [start, end] = getThemeTransitionClipPaths(variant, 100, 100, 200, 800, 600);
      expect(start).toBeTruthy();
      expect(end).toBeTruthy();
    });
  });

  it('toggles theme when view transitions are unavailable', () => {
    render(<AnimatedThemeToggler label="Theme" />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(setColorModeMock).toHaveBeenCalledWith('dark');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
  });
});
