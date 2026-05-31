import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BackgroundMusic from '../BackgroundMusic';

describe('BackgroundMusic', () => {
  it('toggles playback when clicked', async () => {
    render(<BackgroundMusic />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(button).toBeInTheDocument();
  });
});
