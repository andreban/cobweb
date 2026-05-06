// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ReactNode, useCallback, useRef, useState } from 'react';

interface SplitPaneProps {
  orientation: 'horizontal' | 'vertical';
  initialSize: number;
  size?: number;
  onSizeChange?: (size: number) => void;
  collapsed?: boolean;
  children: [ReactNode, ReactNode];
}

export function SplitPane({
  orientation,
  initialSize,
  size: controlledSize,
  onSizeChange,
  collapsed = false,
  children,
}: SplitPaneProps) {
  const [internalSize, setInternalSize] = useState(initialSize);
  const firstSize = controlledSize ?? internalSize;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startPos: number; startSize: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const container = containerRef.current;
      if (!container) return;
      const totalSize =
        orientation === 'horizontal' ? container.offsetWidth : container.offsetHeight;
      dragState.current = {
        startPos: orientation === 'horizontal' ? e.clientX : e.clientY,
        startSize: (firstSize / 100) * totalSize,
      };
    },
    [orientation, firstSize],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState.current || !(e.buttons & 1)) return;
      const container = containerRef.current;
      if (!container) return;
      const totalSize =
        orientation === 'horizontal' ? container.offsetWidth : container.offsetHeight;
      const currentPos = orientation === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - dragState.current.startPos;
      const newSize = dragState.current.startSize + delta;
      const clamped = Math.min(Math.max(newSize, 0), totalSize);
      const newPct = (clamped / totalSize) * 100;
      if (controlledSize === undefined) setInternalSize(newPct);
      onSizeChange?.(newPct);
    },
    [orientation, controlledSize, onSizeChange],
  );

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const isHorizontal = orientation === 'horizontal';
  const showDivider = !collapsed;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          [isHorizontal ? 'width' : 'height']: `${firstSize}%`,
          [isHorizontal ? 'height' : 'width']: '100%',
          overflow: 'auto',
        }}
      >
        {children[0]}
      </div>
      {showDivider && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            [isHorizontal ? 'width' : 'height']: '10px',
            [isHorizontal ? 'height' : 'width']: '100%',
            [isHorizontal ? 'marginInline' : 'marginBlock']: '-3px',
            cursor: isHorizontal ? 'col-resize' : 'row-resize',
            background: 'transparent',
            zIndex: 1,
          }}
        >
          <div
            style={{
              [isHorizontal ? 'width' : 'height']: '4px',
              [isHorizontal ? 'height' : 'width']: '100%',
              background: 'var(--split-pane-divider, #e5e7eb)',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}
      <div
        style={{
          flex: 1,
          [isHorizontal ? 'height' : 'width']: '100%',
          overflow: 'auto',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {children[1]}
      </div>
    </div>
  );
}
