// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import ReactDOM from 'react-dom/client';
import '@mast-ai/react-ui/styles.css';
import './index.css';
import { App } from './App';

class ConversationErrorBoundary extends React.Component<
  object,
  { hasError: boolean; resetKey: number }
> {
  state = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    localStorage.removeItem('cobweb:conversation');
    this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }));
  }

  render() {
    if (this.state.hasError) return null;
    return <App key={this.state.resetKey} />;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConversationErrorBoundary />
  </React.StrictMode>,
);
