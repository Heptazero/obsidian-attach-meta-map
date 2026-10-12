import { describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { DeletionManager } from '../src/deletion-manager';
import { DeletionPlan } from '../src/deletion-policy';
import { createGroup, defaultSettings, normalizeSettings } from '../src/settings-model';

function harness(initial: Record<string, unknown>) {
  const files = new Map<string, TFile>();
  const fm = new Map<string, Record<string, unknown>>();
  const disk = new Map<string, Record<string, unknown>>();
  const settings = defaultSettings();
  settings.groups = [createGroup({ resourceFolder: 'Files', noteFolder: 'Notes' })];
  settings.deletion = { resourceToNote: true, noteToResources: true, confirm: true };
  const deleted: string[] = [];
  const prompts: DeletionPlan[] = [];
  let decide: (plan: DeletionPlan) => Promise<boolean> = async () => true;
  const handlers: Record<string, (...args: any[]) => void> = {};
  const add = (path: string, source?: unknown) => {
    const file = new TFile();
    const name = path.split('/').pop()!;
    Object.assign(file, { path, name, extension: name.split('.').pop()!, stat: { mtime: 1, size: 10 } });
    files.set(path, file);
    if (file.extension === 'md') {
      const value = { source, title: 'Preserved title' };
      fm.set(path, value);
      disk.set(path, { ...value });
    }
    return file;
  };
  for (const [path, source] of Object.entries(initial)) add(path, source);
  let manager: DeletionManager;
  const trash = vi.fn(async (file: TFile) => {
    files.delete(file.path);
    deleted.push(file.path);
    handlers['vault:delete'](file);
  });
  const writes = vi.fn(async (file: TFile, callback: (value: Record<string, unknown>) => void) => {
    const value = disk.get(file.path)!;
    callback(value);
    fm.set(file.path, { ...value });
    file.stat.mtime++;
    handlers['metadata:changed'](file);
  });
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()].filter(file => file.extension === 'md'),
      getFileByPath: (path: string) => files.get(path) ?? null,
      read: async (file: TFile) => JSON.stringify(disk.get(file.path) ?? {}),
      on: (event: string, handler: (...args: any[]) => void) => { handlers[`vault:${event}`] = handler; return {}; },
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: fm.get(file.path) }),
      getFirstLinkpathDest: (target: string) => [...files.values()].find(file => file.path === target || file.name === target) ?? null,
      on: (event: string, handler: (...args: any[]) => void) => { handlers[`metadata:${event}`] = handler; return {}; },
    },
    fileManager: { trashFile: trash, processFrontMatter: writes },
  } as unknown as App;
  manager = new DeletionManager(app, () => settings, async plan => { prompts.push(plan); return decide(plan); });
  manager.start(() => {});
  const remove = (path: string) => {
    const file = files.get(path)!;
    files.delete(path);
    fm.delete(path); // Host metadata for a deleted note is no longer available.
    handlers['vault:delete'](file);
  };
  return { manager, settings, files, fm, disk, prompts, deleted, trash, writes, remove, add, handlers,
    decide: (callback: typeof decide) => { decide = callback; } };
}

describe('linked deletion', () => {
  it('keeps both directions off and confirmation on for old and default settings', () => {
    const expected = { resourceToNote: false, noteToResources: false, confirm: true };
    expect(defaultSettings().deletion).toEqual(expected);
    expect(normalizeSettings({ groups: [createGroup()] }).deletion).toEqual(expected);
    expect(normalizeSettings({ groups: [createGroup()], deletion: { resourceToNote: 'true' } }).deletion).toEqual(expected);
  });

  it('does nothing with both directions off', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    h.settings.deletion.resourceToNote = false;
    h.remove('Files/p.pdf');
    await h.manager.settled();
    expect(h.prompts).toEqual([]);
    expect(h.deleted).toEqual([]);
    expect(h.writes).not.toHaveBeenCalled();
  });

  it('uses the cached source binding to trash a note after its final resource disappears', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    h.remove('Files/p.pdf');
    await h.manager.settled();
    expect(h.deleted).toEqual(['Notes/p.md']);
    expect(h.prompts[0].changes).toEqual([{ kind: 'trash', path: 'Notes/p.md' }]);
  });

  it('removes only the deleted resource from a multi-resource source scalar', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]] [[zh.pdf|中文]]', 'Files/p.pdf': null, 'Files/zh.pdf': null });
    h.remove('Files/p.pdf');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
    expect(h.disk.get('Notes/p.md')).toEqual({ source: '[[zh.pdf|中文]]', title: 'Preserved title' });
    expect(h.files.has('Files/zh.pdf')).toBe(true);
  });

  it('keeps notes that still have an unresolved source', async () => {
    const h = harness({ 'Notes/p.md': ['[[p.pdf]]', '[[missing.pdf]]'], 'Files/p.pdf': null });
    h.remove('Files/p.pdf');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
    expect(h.disk.get('Notes/p.md')?.source).toBe('[[missing.pdf]]');
  });

  it('does not infer bindings from names or unrelated properties', async () => {
    const h = harness({ 'Notes/p.md': undefined, 'Files/p.pdf': null });
    h.fm.get('Notes/p.md')!.attachment = '[[p.pdf]]';
    h.remove('Files/p.pdf');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
  });

  it('skips folder-only groups and notes whose cache was stale at deletion', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    h.settings.groups = [createGroup({ layout: 'folder', collectionFolder: 'Notes', createNoteFile: false })];
    h.remove('Notes/p.md');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
    const stale = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    stale.files.get('Notes/p.md')!.stat.mtime++;
    stale.remove('Notes/p.md');
    await stale.manager.settled();
    expect(stale.deleted).toEqual([]);
  });

  it('does not trash a replacement that appeared before the queued plan opened', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    h.remove('Notes/p.md');
    h.add('Files/p.pdf');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
  });

  it('remembers a proven resource binding across rename and rejects same-name rebinding', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    const file = h.files.get('Files/p.pdf')!;
    h.files.delete(file.path);
    file.path = 'Elsewhere/p.pdf';
    h.files.set(file.path, file);
    h.handlers['vault:rename'](file, 'Files/p.pdf');
    h.remove(file.path);
    h.add('Other/p.pdf');
    await h.manager.settled();
    expect(h.deleted).toEqual(['Notes/p.md']);
    expect(h.files.has('Other/p.pdf')).toBe(true);
  });

  it('trashes all unshared resources once when both directions are enabled', async () => {
    const h = harness({ 'Notes/p.md': ['[[p.pdf]]', '[[zh.pdf]]'], 'Files/p.pdf': null, 'Files/zh.pdf': null });
    h.remove('Notes/p.md');
    await h.manager.settled();
    expect(h.deleted).toEqual(['Files/p.pdf', 'Files/zh.pdf']);
    expect(h.prompts).toHaveLength(1);
  });

  it('ignores previously missing resources when deleting the remaining resources of a note', async () => {
    const h = harness({ 'Notes/p.md': ['[[p.pdf]]', '[[zh.pdf]]'], 'Files/p.pdf': null, 'Files/zh.pdf': null });
    h.decide(async () => false);
    h.remove('Files/p.pdf');
    await h.manager.settled();
    h.decide(async () => true);
    h.remove('Notes/p.md');
    await h.manager.settled();
    expect(h.deleted).toEqual(['Files/zh.pdf']);
  });

  it('protects resources referenced by notes outside every mapping group', async () => {
    const h = harness({ 'Notes/p.md': ['[[p.pdf]]', '[[zh.pdf]]'], 'Elsewhere/review.md': '[[p.pdf]]',
      'Files/p.pdf': null, 'Files/zh.pdf': null });
    h.remove('Notes/p.md');
    await h.manager.settled();
    expect(h.deleted).toEqual(['Files/zh.pdf']);
    expect(h.prompts[0].shared).toEqual(['Files/p.pdf']);
  });

  it('does not cascade from unmanaged notes or to Markdown or Canvas targets', async () => {
    const h = harness({ 'Elsewhere/p.md': '[[p.pdf]]', 'Files/p.pdf': null,
      'Notes/links.md': ['[[other.md]]', '[[diagram.canvas]]'], 'Notes/other.md': undefined, 'Files/diagram.canvas': null });
    h.remove('Elsewhere/p.md');
    h.remove('Notes/links.md');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
  });

  it('cancels without any additional file or property writes', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    h.decide(async () => false);
    h.remove('Files/p.pdf');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
    expect(h.writes).not.toHaveBeenCalled();
    expect(h.files.has('Files/p.pdf')).toBe(false);
  });

  it('supports automatic apply without opening the preview', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    h.settings.deletion.confirm = false;
    h.remove('Notes/p.md');
    await h.manager.settled();
    expect(h.prompts).toEqual([]);
    expect(h.deleted).toEqual(['Files/p.pdf']);
  });

  it.each(['restore', 'edit', 'disable', 'unload', 'new-owner', 'replace', 'move', 'change-group'])(
    'rejects a preview when state changes: %s', async mode => {
      const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
      h.decide(async () => {
        if (mode === 'restore') h.add('Notes/p.md', '[[p.pdf]]');
        if (mode === 'edit') h.files.get('Files/p.pdf')!.stat.mtime++;
        if (mode === 'disable') h.settings.deletion.noteToResources = false;
        if (mode === 'unload') h.manager.stop();
        if (mode === 'new-owner') h.add('Other/new.md', '[[p.pdf]]');
        if (mode === 'replace') h.add('Files/p.pdf');
        if (mode === 'move') h.files.get('Files/p.pdf')!.path = 'Files/moved.pdf';
        if (mode === 'change-group') h.settings.groups = [createGroup({ noteFolder: 'Other' })];
        return true;
      });
      h.remove('Notes/p.md');
      await h.manager.settled();
      expect(h.deleted).toEqual([]);
      expect(h.writes).not.toHaveBeenCalled();
    },
  );

  it('rejects stale metadata when disk source has changed', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null });
    h.disk.get('Notes/p.md')!.source = '[[other.pdf]]';
    h.remove('Files/p.pdf');
    await h.manager.settled();
    expect(h.prompts).toEqual([]);
    expect(h.deleted).toEqual([]);
  });

  it('protects a shared resource even before its owner metadata cache updates', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Files/p.pdf': null, 'Other/review.md': undefined });
    h.disk.get('Other/review.md')!.source = '[[p.pdf]]';
    h.remove('Notes/p.md');
    await h.manager.settled();
    expect(h.deleted).toEqual([]);
  });

  it('stops on trash failure without trying permanent deletion or continuing the batch', async () => {
    const h = harness({ 'Notes/p.md': ['[[p.pdf]]', '[[zh.pdf]]'], 'Files/p.pdf': null, 'Files/zh.pdf': null });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.trash.mockRejectedValueOnce(new Error('Trash unavailable'));
    h.remove('Notes/p.md');
    await h.manager.settled();
    expect(h.trash).toHaveBeenCalledTimes(1);
    expect(h.deleted).toEqual([]);
    log.mockRestore();
  });

  it('serializes previews for two independent deletions', async () => {
    const h = harness({ 'Notes/p.md': '[[p.pdf]]', 'Notes/q.md': '[[q.pdf]]', 'Files/p.pdf': null, 'Files/q.pdf': null });
    let resolve: (value: boolean) => void = () => {};
    h.decide(() => new Promise(answer => { resolve = answer; }));
    h.remove('Files/p.pdf');
    h.remove('Files/q.pdf');
    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    h.decide(async () => true);
    resolve(false);
    await h.manager.settled();
    expect(h.prompts).toHaveLength(2);
    expect(h.deleted).toEqual(['Notes/q.md']);
  });
});
