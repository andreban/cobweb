// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SplitPane } from './SplitPane';

describe('SplitPane', () => {
  it('renders both children', () => {
    render(
      <SplitPane orientation="horizontal" initialSize={50}>
        {[<div key="a">First</div>, <div key="b">Second</div>]}
      </SplitPane>,
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('applies col-resize cursor for horizontal orientation', () => {
    const { container } = render(
      <SplitPane orientation="horizontal" initialSize={50}>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitPane>,
    );
    const divider = container.querySelector('[style*="col-resize"]');
    expect(divider).not.toBeNull();
  });

  it('applies row-resize cursor for vertical orientation', () => {
    const { container } = render(
      <SplitPane orientation="vertical" initialSize={50}>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitPane>,
    );
    const divider = container.querySelector('[style*="row-resize"]');
    expect(divider).not.toBeNull();
  });

  it('sets initial first-pane size from initialSize prop', () => {
    const { container } = render(
      <SplitPane orientation="horizontal" initialSize={30}>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitPane>,
    );
    const firstPane = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(firstPane.style.width).toBe('30%');
  });

  it('divider is rendered between the two panes', () => {
    const { container } = render(
      <SplitPane orientation="horizontal" initialSize={50}>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitPane>,
    );
    const root = container.firstElementChild as HTMLElement;
    // root has exactly 3 children: first pane, divider, second pane
    expect(root.children).toHaveLength(3);
  });

  it('hides the divider when collapsed=true', () => {
    const { container } = render(
      <SplitPane orientation="horizontal" initialSize={50} collapsed>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitPane>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.children).toHaveLength(2);
  });

  it('keeps the divider visible when size is 0 but not collapsed', () => {
    const { container } = render(
      <SplitPane orientation="horizontal" initialSize={50} size={0}>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitPane>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.children).toHaveLength(3);
  });

  it('uses controlled size over initialSize', () => {
    const { container } = render(
      <SplitPane orientation="horizontal" initialSize={50} size={30}>
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitPane>,
    );
    const firstPane = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(firstPane.style.width).toBe('30%');
  });
});
