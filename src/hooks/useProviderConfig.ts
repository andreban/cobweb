import { useState } from 'react';
import type { ProviderConfig } from '../providers/types';
import {
  loadProviderConfig,
  saveProviderConfig,
  clearProviderConfig,
} from '../providers/storage';

export function useProviderConfig() {
  const [config, setConfig] = useState<ProviderConfig | null>(() =>
    loadProviderConfig(),
  );

  function save(newConfig: ProviderConfig) {
    saveProviderConfig(newConfig);
    setConfig(newConfig);
  }

  function clear() {
    clearProviderConfig();
    setConfig(null);
  }

  return { config, save, clear };
}
