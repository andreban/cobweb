import type { ProviderConfig } from './types';

const STORAGE_KEY = 'cobweb:provider-config';

export function loadProviderConfig(): ProviderConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProviderConfig;
  } catch {
    return null;
  }
}

export function saveProviderConfig(config: ProviderConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearProviderConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
