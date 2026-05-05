// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toolbar } from './Toolbar';

const defaults = {
  connectionState: 'disconnected' as const,
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onReset: vi.fn(),
  onRun: vi.fn(),
  onSave: vi.fn(),
  saveEnabled: true,
  onOpenSettings: vi.fn(),
  isAgentConfigured: false,
  themePreference: 'light' as const,
  onCycleTheme: vi.fn(),
};

describe('Toolbar', () => {
  it('shows Connect button when disconnected', () => {
    render(<Toolbar {...defaults} connectionState="disconnected" />);
    expect(screen.getByTitle('Connect to device')).toBeInTheDocument();
    expect(screen.queryByTitle('Disconnect')).toBeNull();
  });

  it('shows Disconnect button when connected', () => {
    render(<Toolbar {...defaults} connectionState="connected" />);
    expect(screen.getByTitle('Disconnect')).toBeInTheDocument();
    expect(screen.queryByTitle('Connect to device')).toBeNull();
  });

  it('disables Reset and Run when disconnected', () => {
    render(<Toolbar {...defaults} connectionState="disconnected" />);
    expect(screen.getByTitle('Reset device')).toBeDisabled();
    expect(screen.getByTitle('Run current file')).toBeDisabled();
  });

  it('enables Reset and Run when connected', () => {
    render(<Toolbar {...defaults} connectionState="connected" />);
    expect(screen.getByTitle('Reset device')).not.toBeDisabled();
    expect(screen.getByTitle('Run current file')).not.toBeDisabled();
  });

  it('calls onConnect when Connect is clicked', async () => {
    const onConnect = vi.fn();
    render(<Toolbar {...defaults} onConnect={onConnect} />);
    await userEvent.click(screen.getByTitle('Connect to device'));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('calls onRun when Run is clicked while connected', async () => {
    const onRun = vi.fn();
    render(<Toolbar {...defaults} connectionState="connected" onRun={onRun} />);
    await userEvent.click(screen.getByTitle('Run current file'));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('calls onOpenSettings when Settings is clicked', async () => {
    const onOpenSettings = vi.fn();
    render(<Toolbar {...defaults} onOpenSettings={onOpenSettings} />);
    await userEvent.click(screen.getByTitle('Settings'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('calls onCycleTheme when theme button is clicked', async () => {
    const onCycleTheme = vi.fn();
    render(<Toolbar {...defaults} onCycleTheme={onCycleTheme} />);
    await userEvent.click(screen.getByTitle(/Theme:/));
    expect(onCycleTheme).toHaveBeenCalledOnce();
  });

  it('renders the Save button and calls onSave when clicked', async () => {
    const onSave = vi.fn();
    render(<Toolbar {...defaults} onSave={onSave} />);
    const saveButton = screen.getByRole('button', { name: /Save/ });
    expect(saveButton).not.toBeDisabled();
    await userEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('disables Save when saveEnabled is false', () => {
    render(<Toolbar {...defaults} saveEnabled={false} />);
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('reflects each theme preference in the button title', () => {
    const { rerender } = render(<Toolbar {...defaults} themePreference="light" />);
    expect(screen.getByTitle('Theme: light (click for dark)')).toBeInTheDocument();
    rerender(<Toolbar {...defaults} themePreference="dark" />);
    expect(screen.getByTitle('Theme: dark (click for system)')).toBeInTheDocument();
    rerender(<Toolbar {...defaults} themePreference="system" />);
    expect(screen.getByTitle('Theme: system (click for light)')).toBeInTheDocument();
  });
});
