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

  it('hasPendingPromises is false after dequeue on empty queue (promise was returned, not buffered)', () => {
    const q = new AsyncBlockingQueue<number>();
    q.dequeue();
    expect(q.hasPendingPromises()).toBe(false);
  });

  it('hasPendingPromises is true after enqueue with no waiting consumer', () => {
    const q = new AsyncBlockingQueue<number>();
    q.enqueue(1);
    expect(q.hasPendingPromises()).toBe(true);
  });

  it('hasPendingResolvers is true when a dequeue is waiting for data', () => {
    const q = new AsyncBlockingQueue<number>();
    q.dequeue();
    expect(q.hasPendingResolvers()).toBe(true);
  });

  it('hasPendingResolvers is false after enqueue with no waiting consumer', () => {
    const q = new AsyncBlockingQueue<number>();
    q.enqueue(1);
    expect(q.hasPendingResolvers()).toBe(false);
  });
});
