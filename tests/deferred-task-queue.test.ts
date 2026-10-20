import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredTaskQueue } from '../src/deferred-task-queue';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('deferred creation queue', () => {
  it('handles a 1000-file import without growing timers or simultaneous jobs', async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    const run = vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
    });
    const queue = new DeferredTaskQueue(run, 'bulk import');
    for (let i = 0; i < 1000; i++) { queue.enqueue(i, 500); queue.enqueue(i, 500); }
    expect(vi.getTimerCount()).toBe(1);
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(1000);
    expect(peak).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a single timer, coalesces file identity, and runs at most one job at a time', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    let active = 0;
    let peak = 0;
    const run = vi.fn(async (key: string) => {
      peak = Math.max(peak, ++active);
      if (key === 'first') await new Promise<void>(resolve => { release = resolve; });
      active--;
    });
    const queue = new DeferredTaskQueue(run, 'test queue');
    queue.enqueue('first', 500);
    queue.enqueue('first', 500);
    queue.enqueue('second', 500);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    queue.enqueue('first'); // A repeated event for the active file is also coalesced.
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.runAllTimersAsync();
    expect(run.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    expect(peak).toBe(1);
  });

  it('continues after synchronous and asynchronous failures without unhandled rejection', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn().mockImplementationOnce(() => { throw new Error('sync'); })
      .mockRejectedValueOnce(new Error('async')).mockResolvedValue(undefined);
    const queue = new DeferredTaskQueue(run, 'test queue');
    queue.enqueue('first'); queue.enqueue('second'); queue.enqueue('third');
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('cancels the delay and drops all pending keys on stop', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const queue = new DeferredTaskQueue(run, 'test queue');
    queue.enqueue('first', 500); queue.enqueue('second', 500);
    queue.stop(); queue.enqueue('third');
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
  });

  it('does not start waiting tasks after stopping during an active task', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const queue = new DeferredTaskQueue(run, 'test queue');
    queue.enqueue('first'); queue.enqueue('second');
    await vi.advanceTimersByTimeAsync(0);
    queue.stop(); release();
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
