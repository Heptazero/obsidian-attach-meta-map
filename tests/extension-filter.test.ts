import { describe, expect, it } from 'vitest';
import {
  activeExtensions, matchesGroupExtension, normalizeExtensions, setActiveExtensions,
} from '../src/extension-filter';
import { createGroup, normalizeSettings } from '../src/settings-model';
import { attachmentCandidates, groupForAttachment } from '../src/paths';
import { routeAttachment } from '../src/attachment-rules';

describe('group extension filters', () => {
  it('normalizes literal suffixes, removes duplicates and ignores malformed values', () => {
    expect(normalizeExtensions([' PDF ', '.pdf', '..EPUB', '', '.', '*', 'p/ng', 'x\\y', 'a,b', 1, 'two words']))
      .toEqual(['.pdf', '.epub']);
    expect(normalizeExtensions(null)).toEqual([]);
  });

  it('retains existing allowlists and defaults new blocklists safely', () => {
    const group = normalizeSettings({ groups: [{ resourceFolder: 'Files', noteFolder: 'Notes',
      watchedExtensions: ['.PDF', '.epub'] }] }).groups[0];
    expect(group.extensionMode).toBe('allowlist');
    expect(group.watchedExtensions).toEqual(['.pdf', '.epub']);
    expect(group.excludedExtensions).toEqual(['.md', '.canvas', '.base']);
    expect(matchesGroupExtension(group, 'PDF')).toBe(true);
    expect(matchesGroupExtension(group, 'mp4')).toBe(false);
    expect(matchesGroupExtension(createGroup({ watchedExtensions: [] }), 'pdf')).toBe(false);
  });

  it('processes unknown suffixes except the independently saved blocklist', () => {
    const group = createGroup({ extensionMode: 'blocklist', watchedExtensions: ['.pdf'],
      excludedExtensions: ['.ZIP'] });
    expect(matchesGroupExtension(group, '.zip')).toBe(false);
    expect(matchesGroupExtension(group, 'pdf')).toBe(true);
    expect(matchesGroupExtension(group, 'epub')).toBe(true);
    expect(matchesGroupExtension(group, 'new-format')).toBe(true);
    expect(matchesGroupExtension(group, '')).toBe(true);
  });

  it('lets users opt Canvas and Base in but never Markdown', () => {
    const blocked = createGroup({ extensionMode: 'blocklist' });
    expect(matchesGroupExtension(blocked, 'canvas')).toBe(false);
    expect(matchesGroupExtension(blocked, 'base')).toBe(false);
    setActiveExtensions(blocked, []);
    for (const extension of ['pdf', 'canvas', 'base', '']) {
      expect(matchesGroupExtension(blocked, extension)).toBe(true);
    }
    expect(matchesGroupExtension(blocked, 'MD')).toBe(false);
    const allowed = createGroup({ watchedExtensions: ['.md', '.canvas', '.base'] });
    expect(matchesGroupExtension(allowed, 'md')).toBe(false);
    expect(matchesGroupExtension(allowed, 'canvas')).toBe(true);
    expect(matchesGroupExtension(allowed, 'base')).toBe(true);
  });

  it('retains both lists across switches, edits and reloads', () => {
    const group = createGroup({ resourceFolder: 'Files', noteFolder: 'Notes' });
    setActiveExtensions(group, ['pdf', 'epub']);
    group.extensionMode = 'blocklist';
    expect(activeExtensions(group)).toEqual(['.md', '.canvas', '.base']);
    setActiveExtensions(group, ['zip']);
    group.extensionMode = 'allowlist';
    expect(activeExtensions(group)).toEqual(['.pdf', '.epub']);
    const saved = normalizeSettings(JSON.parse(JSON.stringify({ groups: [group] }))).groups[0];
    expect(saved.watchedExtensions).toEqual(['.pdf', '.epub']);
    saved.extensionMode = 'blocklist';
    expect(activeExtensions(saved)).toEqual(['.zip']);
    expect(group.excludedExtensions).toEqual(['.zip']);
  });

  it('preserves explicit empty lists on reload and fails safely on invalid configuration', () => {
    const settings = normalizeSettings({ groups: [{ layout: 'folder', collectionFolder: 'Library',
      extensionMode: 'blocklist', watchedExtensions: [], excludedExtensions: [] }] });
    expect(settings.groups[0]).toMatchObject({ extensionMode: 'blocklist',
      watchedExtensions: [], excludedExtensions: [] });
    const invalid = normalizeSettings({ groups: [{ resourceFolder: 'Files', noteFolder: 'Notes',
      extensionMode: 'whatever', excludedExtensions: 'not a list' }] }).groups[0];
    expect(invalid.extensionMode).toBe('allowlist');
    expect(invalid.excludedExtensions).toEqual(['.md', '.canvas', '.base']);
    const other = createGroup();
    other.excludedExtensions.push('.zip');
    expect(createGroup().excludedExtensions).not.toContain('.zip');
  });

  it('keeps right-click routing, depth and root protection consistent', () => {
    const group = createGroup({ layout: 'folder', collectionFolder: 'Library',
      attachmentDepth: 1, includeSubfolders: true, extensionMode: 'blocklist', excludedExtensions: ['.zip'] });
    for (const path of ['Library/Topic/a.epub', 'Library/Topic/Sub/a.epub']) {
      expect(groupForAttachment([group], path, 'epub')).toBe(group);
      expect(routeAttachment([group], path, 'epub')).toEqual({ kind: 'mapping', group });
    }
    for (const [path, ext] of [['Library/a.epub', 'epub'], ['Library/Topic/a.zip', 'zip'],
      ['Library/Topic/a.md', 'md']]) {
      expect(groupForAttachment([group], path, ext)).toBeNull();
      expect(routeAttachment([group], path, ext)).toEqual({ kind: 'protected', group });
    }
    expect(routeAttachment([group], 'Elsewhere/a.epub', 'epub')).toEqual({ kind: 'generic' });
  });

  it('retains the most specific matching group and never guesses from an inactive allowlist', () => {
    const outer = createGroup({ resourceFolder: 'Files', noteFolder: 'Notes', extensionMode: 'blocklist' });
    const inner = createGroup({ resourceFolder: 'Files/Special', noteFolder: 'Notes', watchedExtensions: ['.epub'] });
    expect(groupForAttachment([outer, inner], 'Files/Special/a.epub', 'epub')).toBe(inner);
    expect(groupForAttachment([inner, outer], 'Files/Special/a.pdf', 'pdf')).toBe(outer);
    expect(attachmentCandidates(outer, 'Notes/a.md')).toEqual([]);
    expect(attachmentCandidates(createGroup({ watchedExtensions: ['.md', '.pdf'] }), 'Library/a.md'))
      .toEqual(['Attachments/a.pdf']);
  });
});
