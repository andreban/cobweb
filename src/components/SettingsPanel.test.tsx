// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';
import type { ProviderConfig } from '../providers/types';

function makeDefaults(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    config: null as ProviderConfig | null,
    onSave: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

describe('SettingsPanel', () => {
  it('renders nothing when closed', () => {
    render(<SettingsPanel {...makeDefaults({ isOpen: false })} />);
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('renders the modal when open', () => {
    render(<SettingsPanel {...makeDefaults()} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
  });

  it('prefills the API key from an existing config', () => {
    render(
      <SettingsPanel
        {...makeDefaults({
          config: { provider: 'google-genai', apiKey: 'AIza-existing' },
        })}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('API key').value).toBe('AIza-existing');
  });

  it('prefills the model from an existing config', () => {
    render(
      <SettingsPanel
        {...makeDefaults({
          config: { provider: 'google-genai', apiKey: 'AIza', model: 'gemini-2.5-pro' },
        })}
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Model').value).toBe('gemini-2.5-pro');
  });

  it('defaults the model to Gemini 3.1 Flash-Lite Preview when no config is set', () => {
    render(<SettingsPanel {...makeDefaults()} />);
    expect(screen.getByLabelText<HTMLSelectElement>('Model').value).toBe(
      'gemini-3.1-flash-lite-preview',
    );
  });

  it('disables Save when API key is empty', () => {
    render(<SettingsPanel {...makeDefaults()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Clear when there is no existing config', () => {
    render(<SettingsPanel {...makeDefaults()} />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('enables Clear when there is an existing config', () => {
    render(
      <SettingsPanel
        {...makeDefaults({
          config: { provider: 'google-genai', apiKey: 'AIza-existing' },
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Clear' })).not.toBeDisabled();
  });

  it('calls onSave with the trimmed API key and selected model, then closes', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SettingsPanel {...makeDefaults({ onSave, onClose })} />);

    await userEvent.type(screen.getByLabelText('API key'), '  AIza-new  ');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'gemini-2.5-flash');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      provider: 'google-genai',
      apiKey: 'AIza-new',
      model: 'gemini-2.5-flash',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClear and closes when Clear is clicked', async () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    render(
      <SettingsPanel
        {...makeDefaults({
          config: { provider: 'google-genai', apiKey: 'AIza-existing' },
          onClear,
          onClose,
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onClear).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Cancel is clicked without saving', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SettingsPanel {...makeDefaults({ onSave, onClose })} />);

    await userEvent.type(screen.getByLabelText('API key'), 'AIza-new');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
