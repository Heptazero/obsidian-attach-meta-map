import { describe, expect, it, vi } from 'vitest';
import { runInBackground } from '../src/background-task';

describe('runInBackground', () => {
  it('reports a synchronous failure', () => {
    const error = new Error('sync');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    runInBackground(() => { throw error; }, 'sync task');

    expect(spy).toHaveBeenCalledWith('[Att Meta Map] sync task', error);
    spy.mockRestore();
  });

  it('reports a rejected promise', async () => {
    const error = new Error('async');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    runInBackground(() => Promise.reject(error), 'async task');
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).toHaveBeenCalledWith('[Att Meta Map] async task', error);
    spy.mockRestore();
  });
});
