// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/** Callback used to fulfill a pending {@link AsyncBlockingQueue.dequeue} promise. */
type Resolver<T> = (value: T) => void;

/** Internal singly-linked node used by {@link Queue}. */
class QueueEntry<T> {
  data: T;
  next?: QueueEntry<T>;

  constructor(data: T) {
    this.data = data;
  }
}

/**
 * A FIFO queue backed by a singly-linked list. Both `enqueue` and `dequeue` run in O(1).
 */
export class Queue<T> {
  private head?: QueueEntry<T>;
  private tail?: QueueEntry<T>;

  /** Appends an item to the back of the queue. */
  enqueue(data: T): void {
    const newNode = new QueueEntry<T>(data);
    if (this.tail) {
      this.tail.next = newNode;
    }
    this.tail = newNode;

    if (!this.head) {
      this.head = this.tail;
    }
  }

  /**
   * Removes and returns the item at the front of the queue.
   * @throws Error if the queue is empty — callers should guard with {@link isEmpty}.
   */
  dequeue(): T {
    if (this.isEmpty()) {
      throw new Error('Cannot dequeue. Queue is empty');
    }
    const node = this.head!.data;
    this.head = this.head!.next;
    if (!this.head) {
      this.tail = undefined;
    }
    return node;
  }

  /** Returns `true` when the queue contains no items. */
  isEmpty(): boolean {
    return this.head == null;
  }
}

/**
 * A FIFO queue with an asynchronous consumer side: {@link dequeue} returns a `Promise` that
 * resolves with the next available item, or stays pending until one is enqueued. Producers
 * never block.
 *
 * Internally the queue maintains two sub-queues such that exactly one of them is non-empty at
 * any time: `promiseQueue` holds buffered (already-resolved) values waiting to be consumed,
 * and `resolverQueue` holds resolvers for promises that have been handed out to consumers.
 */
export class AsyncBlockingQueue<T> {
  private promiseQueue: Queue<Promise<T>> = new Queue<Promise<T>>();
  private resolverQueue: Queue<Resolver<T>> = new Queue<Resolver<T>>();

  /** Creates a paired promise + resolver, appending each to its respective queue. */
  private add(): void {
    const promise = new Promise<T>(resolve => {
      this.resolverQueue.enqueue(resolve);
    });
    this.promiseQueue.enqueue(promise);
  }

  /**
   * Adds an item to the queue. If a consumer is already waiting, its pending promise is
   * resolved with `data`; otherwise the value is buffered for the next `dequeue` call.
   */
  enqueue(data: T): void {
    if (this.resolverQueue.isEmpty()) {
      this.add();
    }
    const resolve = this.resolverQueue.dequeue();
    resolve(data);
  }

  /**
   * Returns a `Promise` for the next item. Resolves immediately if a value is already
   * buffered; otherwise resolves when an item is enqueued. Items are delivered in FIFO
   * order across both producers and consumers.
   */
  dequeue(): Promise<T> {
    if (this.promiseQueue.isEmpty()) {
      this.add();
    }
    return this.promiseQueue.dequeue();
  }

  /** Returns `true` when items have been enqueued and are waiting for a consumer. */
  hasBufferedValues(): boolean {
    return !this.promiseQueue.isEmpty();
  }

  /** Returns `true` when consumers are waiting for items to be enqueued. */
  hasWaitingConsumers(): boolean {
    return !this.resolverQueue.isEmpty();
  }
}
