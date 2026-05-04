// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';

const defaults = {
  leftOpen: true,
  replOpen: true,
  rightOpen: true,
  onToggleLeft: vi.fn(),
  onToggleRepl: vi.fn(),
  onToggleRight: vi.fn(),
};

describe('StatusBar', () => {
  it('renders all three toggle buttons', () => {
    render(<StatusBar {...defaults} />);
    expect(screen.getByTitle('Toggle file navigator')).toBeInTheDocument();
    expect(screen.getByTitle('Toggle REPL')).toBeInTheDocument();
    expect(screen.getByTitle('Toggle agent panel')).toBeInTheDocument();
  });

  it('calls onToggleLeft when left button is clicked', async () => {
    const onToggleLeft = vi.fn();
    render(<StatusBar {...defaults} onToggleLeft={onToggleLeft} />);
    await userEvent.click(screen.getByTitle('Toggle file navigator'));
    expect(onToggleLeft).toHaveBeenCalledOnce();
  });

  it('calls onToggleRepl when REPL button is clicked', async () => {
    const onToggleRepl = vi.fn();
    render(<StatusBar {...defaults} onToggleRepl={onToggleRepl} />);
    await userEvent.click(screen.getByTitle('Toggle REPL'));
    expect(onToggleRepl).toHaveBeenCalledOnce();
  });

  it('calls onToggleRight when right button is clicked', async () => {
    const onToggleRight = vi.fn();
    render(<StatusBar {...defaults} onToggleRight={onToggleRight} />);
    await userEvent.click(screen.getByTitle('Toggle agent panel'));
    expect(onToggleRight).toHaveBeenCalledOnce();
  });

  it('marks open panels as pressed', () => {
    render(<StatusBar {...defaults} leftOpen={true} replOpen={false} rightOpen={true} />);
    expect(screen.getByTitle('Toggle file navigator')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Toggle REPL')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTitle('Toggle agent panel')).toHaveAttribute('aria-pressed', 'true');
  });
});
