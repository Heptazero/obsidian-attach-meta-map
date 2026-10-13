import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { requireApiVersion } from 'obsidian';
import { NativeDeletionMonitor, deletionControlState, nativeDeletionMode } from '../src/native-deletion';

function harness(config = '{}', exists = true, supported = true) {
  const adapter = { exists: vi.fn(async () => exists), read: vi.fn(async () => config) };
  const app = { vault: { configDir: 'CustomConfig', adapter } } as unknown as App;
  return { adapter, monitor: new NativeDeletionMonitor(app, supported) };
}

describe('native attachment deletion preference', () => {
  it('recognizes native modes and defaults to ask when the persisted value is omitted', () => {
    expect(nativeDeletionMode(true, {})).toBe('ask');
    for (const value of ['ask', 'always', 'never'] as const) {
      expect(nativeDeletionMode(true, { deleteUnlinkedAttachments: value })).toBe(value);
    }
    expect(nativeDeletionMode(false, {})).toBe('unsupported');
    expect(nativeDeletionMode(true, { deleteUnlinkedAttachments: 'future-mode' })).toBe('unknown');
    expect(nativeDeletionMode(true, null)).toBe('unknown');
    expect(nativeDeletionMode(true, [])).toBe('unknown');
  });

  it('shows a checked, disabled native row without changing the saved plugin preference', () => {
    const settings = { resourceToNote: false, noteToResources: false, confirm: true };
    for (const mode of ['ask', 'always'] as const) {
      expect(deletionControlState(settings, mode)).toEqual({ noteChecked: true, noteDisabled: true, confirmDisabled: true });
    }
    expect(settings.noteToResources).toBe(false);
    expect(deletionControlState(settings, 'never')).toEqual({ noteChecked: false, noteDisabled: false, confirmDisabled: true });
    settings.noteToResources = true;
    expect(deletionControlState(settings, 'never')).toEqual({ noteChecked: true, noteDisabled: false, confirmDisabled: false });
    expect(deletionControlState(settings, 'unsupported')).toEqual({ noteChecked: true, noteDisabled: false, confirmDisabled: false });
    expect(deletionControlState(settings, 'unknown').noteDisabled).toBe(true);
    settings.resourceToNote = true;
    expect(deletionControlState(settings, 'ask').confirmDisabled).toBe(false);
  });

  it('reads the actual vault configuration directory and handles omitted app.json', async () => {
    const h = harness('{"deleteUnlinkedAttachments":"always"}');
    expect(await h.monitor.refresh()).toBe('always');
    expect(h.adapter.read).toHaveBeenCalledWith('CustomConfig/app.json');
    const defaults = harness('{}', false);
    expect(await defaults.monitor.refresh()).toBe('ask');
    expect(defaults.adapter.read).not.toHaveBeenCalled();
  });

  it('keeps old Obsidian versions available without reading native configuration', async () => {
    const h = harness('{}', true, false);
    expect(await h.monitor.refresh()).toBe('unsupported');
    expect(h.adapter.exists).not.toHaveBeenCalled();
    expect(h.adapter.read).not.toHaveBeenCalled();
    vi.mocked(requireApiVersion).mockReturnValueOnce(false);
    const app = { vault: { configDir: '.obsidian', adapter: h.adapter } } as unknown as App;
    expect(await new NativeDeletionMonitor(app).refresh()).toBe('unsupported');
    expect(requireApiVersion).toHaveBeenCalledWith('1.12.0');
  });

  it('shares one configuration read when polling and deletion check overlap', async () => {
    const h = harness();
    const first = h.monitor.refresh();
    const second = h.monitor.refresh();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(h.adapter.read).toHaveBeenCalledTimes(1);
  });

  it('pauses on invalid JSON or failed reads and recovers after the configuration is readable', async () => {
    const malformed = harness('{broken');
    expect(await malformed.monitor.refresh()).toBe('unknown');
    const h = harness();
    h.adapter.read.mockRejectedValueOnce(new Error('Busy'));
    expect(await h.monitor.refresh()).toBe('unknown');
    h.adapter.read.mockResolvedValueOnce('{"deleteUnlinkedAttachments":"never"}');
    expect(await h.monitor.refresh()).toBe('never');
  });

  it('notifies active settings only when the mode changes and releases subscribers', async () => {
    const h = harness();
    const listener = vi.fn();
    const unsubscribe = h.monitor.subscribe(listener);
    await h.monitor.refresh();
    await h.monitor.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    h.adapter.read.mockResolvedValueOnce('{"deleteUnlinkedAttachments":"never"}');
    await h.monitor.refresh();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await h.monitor.refresh();
    expect(listener).toHaveBeenCalledTimes(2);
    h.monitor.stop();
    h.adapter.read.mockResolvedValueOnce('{"deleteUnlinkedAttachments":"always"}');
    await h.monitor.refresh();
    expect(h.monitor.mode).toBe('ask');
  });
});
