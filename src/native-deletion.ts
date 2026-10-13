import { App, normalizePath, requireApiVersion } from 'obsidian';
import type { DeletionSettings } from './types';

export type NativeDeletionMode = 'unsupported' | 'never' | 'ask' | 'always' | 'unknown';

export interface NativeDeletionProvider {
  mode: NativeDeletionMode;
  refresh(): Promise<NativeDeletionMode>;
}

/** Native attachment cleanup was introduced in Obsidian 1.12. */
export function nativeDeletionMode(supported: boolean, config: unknown): NativeDeletionMode {
  if (!supported) return 'unsupported';
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'unknown';
  const value: unknown = (config as Record<string, unknown>).deleteUnlinkedAttachments;
  // Obsidian omits default values from app.json; its native default is Ask.
  if (value === undefined || value === 'ask') return 'ask';
  if (value === 'always' || value === 'never') return value;
  return 'unknown';
}

export function nativeHandlesDeletion(mode: NativeDeletionMode): boolean {
  return mode === 'ask' || mode === 'always';
}

export function nativeBlocksPluginDeletion(mode: NativeDeletionMode): boolean {
  return nativeHandlesDeletion(mode) || mode === 'unknown';
}

export function deletionControlState(settings: DeletionSettings, mode: NativeDeletionMode): {
  noteChecked: boolean; noteDisabled: boolean; confirmDisabled: boolean;
} {
  const blocked = nativeBlocksPluginDeletion(mode);
  return {
    noteChecked: nativeHandlesDeletion(mode) || settings.noteToResources,
    noteDisabled: blocked,
    confirmDisabled: !settings.resourceToNote && !(settings.noteToResources && !blocked),
  };
}

/** Read only persisted core settings through public adapter APIs, never private getConfig(). */
export class NativeDeletionMonitor implements NativeDeletionProvider {
  mode: NativeDeletionMode = 'unknown';
  private listeners = new Set<() => void>();
  private inFlight: Promise<NativeDeletionMode> | null = null;
  private stopped = false;

  constructor(private app: App, private supported = requireApiVersion('1.12.0')) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  stop(): void {
    this.stopped = true;
    this.listeners.clear();
  }

  refresh(): Promise<NativeDeletionMode> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.read().then(mode => {
      if (!this.stopped && mode !== this.mode) {
        this.mode = mode;
        for (const listener of this.listeners) listener();
      }
      return mode;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async read(): Promise<NativeDeletionMode> {
    if (!this.supported) return 'unsupported';
    const path = normalizePath(`${this.app.vault.configDir}/app.json`);
    try {
      if (!await this.app.vault.adapter.exists(path)) return 'ask';
      const config: unknown = JSON.parse(await this.app.vault.adapter.read(path));
      return nativeDeletionMode(true, config);
    } catch {
      // A failed read must not enable a second deletion handler.
      return 'unknown';
    }
  }
}
