// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Dialog } from '@base-ui/react/dialog';
import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProviderConfig } from '../providers/types';
import { Button } from './ui/button';

type ProviderId = 'google-genai';

const GEMINI_MODELS = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro Latest' },
] as const;

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  config: ProviderConfig | null;
  onSave: (config: ProviderConfig) => void;
  onClear: () => void;
}

interface SettingsFormProps {
  config: ProviderConfig | null;
  onClose: () => void;
  onSave: (config: ProviderConfig) => void;
  onClear: () => void;
}

function SettingsForm({ config, onClose, onSave, onClear }: SettingsFormProps) {
  const [provider, setProvider] = useState<ProviderId>('google-genai');
  const [apiKey, setApiKey] = useState(config?.provider === 'google-genai' ? config.apiKey : '');
  const [model, setModel] = useState<string>(
    config?.provider === 'google-genai' && config.model ? config.model : DEFAULT_GEMINI_MODEL
  );

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    onSave({ provider: 'google-genai', apiKey: trimmed, model });
    onClose();
  }

  function handleClear() {
    onClear();
    onClose();
  }

  return (
    <form onSubmit={handleSave}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Dialog.Title className="text-sm font-semibold">Settings</Dialog.Title>
        <Dialog.Close
          aria-label="Close settings"
          className="p-1 rounded hover:bg-accent transition-colors"
        >
          <X size={14} />
        </Dialog.Close>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        <Dialog.Description className="text-xs text-muted-foreground">
          Configure the LLM provider used by the assistant. The API key is stored in this
          browser&apos;s localStorage.
        </Dialog.Description>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="google-genai">Google Gemini</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {GEMINI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza..."
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
        <Button type="button" variant="destructive" onClick={handleClear} disabled={!config}>
          Clear
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!apiKey.trim()}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SettingsPanel({ isOpen, onClose, config, onSave, onClear }: SettingsPanelProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-150" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-card text-card-foreground shadow-xl outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:scale-95 transition-all duration-150">
          {isOpen && (
            <SettingsForm config={config} onClose={onClose} onSave={onSave} onClear={onClear} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
