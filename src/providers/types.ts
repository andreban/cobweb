export type ProviderConfig =
  | { provider: 'google-genai'; apiKey: string; model?: string }
  | { provider: 'urp'; endpoint: string };
  // Future: | { provider: 'built-in-ai' }
  //         | { provider: 'openai'; apiKey: string; model?: string }
