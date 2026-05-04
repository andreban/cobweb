// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { Queue, AsyncBlockingQueue } from './Queues';

describe('Queue', () => {
  it('is empty on creation', () => {
    expect(new Queue().isEmpty()).toBe(true);
  });

  it('is not empty after enqueue', () => {
    const q = new Queue<number>();
    q.enqueue(1);
    expect(q.isEmpty()).toBe(false);
  });

  it('dequeues items in FIFO order', () => {
    const q = new Queue<number>();
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    expect(q.dequeue()).toBe(1);
    expect(q.dequeue()).toBe(2);
    expect(q.dequeue()).toBe(3);
  });

  it('is empty after all items are dequeued', () => {
    const q = new Queue<number>();
    q.enqueue(1);
    q.dequeue();
    expect(q.isEmpty()).toBe(true);
  });

  it('throws when dequeuing from an empty queue', () => {
    expect(() => new Queue().dequeue()).toThrow();
  });

  it('handles drain-then-refill cycles correctly', () => {
    const q = new Queue<number>();
    q.enqueue(1);
    expect(q.dequeue()).toBe(1);
    expect(q.isEmpty()).toBe(true);
    q.enqueue(2);
    q.enqueue(3);
    expect(q.dequeue()).toBe(2);
    expect(q.dequeue()).toBe(3);
    expect(q.isEmpty()).toBe(true);
  });

  it('clears the tail reference once the queue empties', () => {
    const q = new Queue<number>();
    q.enqueue(1);
    q.dequeue();
    // Access private field to verify the dequeued node isn't retained.
    expect((q as unknown as { tail?: unknown }).tail).toBeUndefined();
  });
});

describe('AsyncBlockingQueue', () => {
  it('resolves immediately when an item is already enqueued', async () => {
    const q = new AsyncBlockingQueue<number>();
    q.enqueue(42);
    expect(await q.dequeue()).toBe(42);
  });

  it('resolves after enqueue when dequeue was called first', async () => {
    const q = new AsyncBlockingQueue<string>();
    const promise = q.dequeue();
    q.enqueue('hello');
    expect(await promise).toBe('hello');
  });

  it('delivers items in FIFO order', async () => {
    const q = new AsyncBlockingQueue<number>();
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    expect(await q.dequeue()).toBe(1);
    expect(await q.dequeue()).toBe(2);
    expect(await q.dequeue()).toBe(3);
  });

  it('delivers items in FIFO order when consumers wait first', async () => {
    const q = new AsyncBlockingQueue<number>();
    const p1 = q.dequeue();
    const p2 = q.dequeue();
    const p3 = q.dequeue();
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(await p3).toBe(3);
  });

  it('hasBufferedValues is false after dequeue on empty queue (promise was returned, not buffered)', () => {
    const q = new AsyncBlockingQueue<number>();
    q.dequeue();
    expect(q.hasBufferedValues()).toBe(false);
  });

  it('hasBufferedValues is true after enqueue with no waiting consumer', () => {
    const q = new AsyncBlockingQueue<number>();
    q.enqueue(1);
    expect(q.hasBufferedValues()).toBe(true);
  });

  it('hasWaitingConsumers is true when a dequeue is waiting for data', () => {
    const q = new AsyncBlockingQueue<number>();
    q.dequeue();
    expect(q.hasWaitingConsumers()).toBe(true);
  });

  it('hasWaitingConsumers is false after enqueue with no waiting consumer', () => {
    const q = new AsyncBlockingQueue<number>();
    q.enqueue(1);
    expect(q.hasWaitingConsumers()).toBe(false);
  });

  it('clears waiting-consumer state once a matching enqueue arrives', async () => {
    const q = new AsyncBlockingQueue<number>();
    const pending = q.dequeue();
    expect(q.hasWaitingConsumers()).toBe(true);
    q.enqueue(1);
    expect(q.hasWaitingConsumers()).toBe(false);
    expect(q.hasBufferedValues()).toBe(false);
    expect(await pending).toBe(1);
  });

  it('clears buffered-value state once a matching dequeue arrives', async () => {
    const q = new AsyncBlockingQueue<number>();
    q.enqueue(1);
    expect(q.hasBufferedValues()).toBe(true);
    expect(await q.dequeue()).toBe(1);
    expect(q.hasBufferedValues()).toBe(false);
    expect(q.hasWaitingConsumers()).toBe(false);
  });
});
