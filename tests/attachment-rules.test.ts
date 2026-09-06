import { describe, expect, it } from 'vitest';
import {
  createAttachmentRule, isCatchAllRule, matchesAttachmentRule, owningGroup, planAttachmentMoves,
  routeAttachment,
} from '../src/attachment-rules';
import { createGroup } from '../src/settings-model';

const papers = createGroup({
  id: 'papers', name: 'Papers', layout: 'folder', collectionFolder: 'Library',
  watchedExtensions: ['.pdf'],
});

describe('attachment rule matching', () => {
  it('combines populated fields with AND and values within a field with OR', () => {
    const rule = createAttachmentRule({
      sourceFolders: ['Inbox', 'Downloads'],
      extensions: ['pdf', '.epub'],
    });
    expect(matchesAttachmentRule(rule, 'Inbox/a.pdf')).toBe(true);
    expect(matchesAttachmentRule(rule, 'Downloads/a.epub')).toBe(true);
    expect(matchesAttachmentRule(rule, 'Elsewhere/a.pdf')).toBe(false);
    expect(matchesAttachmentRule(rule, 'Inbox/a.png')).toBe(false);
  });

  it('matches direct children by default and descendants only when enabled', () => {
    const direct = createAttachmentRule({ sourceFolders: ['Inbox'] });
    const recursive = createAttachmentRule({ sourceFolders: ['Inbox'], includeSubfolders: true });
    expect(matchesAttachmentRule(direct, 'Inbox/topic/a.pdf')).toBe(false);
    expect(matchesAttachmentRule(recursive, 'Inbox/topic/a.pdf')).toBe(true);
  });

  it('applies folder and extension exclusions', () => {
    const rule = createAttachmentRule({
      includeSubfolders: true,
      sourceFolders: ['Inbox'],
      excludedFolders: ['Inbox/keep'],
      excludedExtensions: ['md'],
    });
    expect(matchesAttachmentRule(rule, 'Inbox/a.pdf')).toBe(true);
    expect(matchesAttachmentRule(rule, 'Inbox/keep/a.pdf')).toBe(false);
    expect(matchesAttachmentRule(rule, 'Inbox/a.md')).toBe(false);
  });

  it('recognizes only enabled rules with no conditions as catch-all', () => {
    expect(isCatchAllRule(createAttachmentRule())).toBe(true);
    expect(isCatchAllRule(createAttachmentRule({ enabled: false }))).toBe(false);
    expect(isCatchAllRule(createAttachmentRule({ extensions: ['pdf'] }))).toBe(false);
  });
});

describe('mapping-group ownership', () => {
  it('protects the whole group root regardless of extension or nesting', () => {
    expect(owningGroup([papers], 'Library/a.pdf')).toBe(papers);
    expect(owningGroup([papers], 'Library/Item/a.png')).toBe(papers);
    expect(owningGroup([papers], 'Elsewhere/a.pdf')).toBeNull();
  });

  it('selects the most specific root', () => {
    const nested = createGroup({
      id: 'nested', name: 'Nested', resourceFolder: 'Library/Special', noteFolder: 'Notes',
    });
    expect(owningGroup([papers, nested], 'Library/Special/a.pdf')).toBe(nested);
  });

  it('routes eligible files to their mapping group and keeps the whole root protected', () => {
    expect(routeAttachment([papers], 'Library/a.pdf', 'pdf'))
      .toEqual({ kind: 'mapping', group: papers });
    expect(routeAttachment([papers], 'Library/Item/a.pdf', 'pdf'))
      .toEqual({ kind: 'protected', group: papers });
    expect(routeAttachment([papers], 'Library/a.png', 'png'))
      .toEqual({ kind: 'protected', group: papers });
    expect(routeAttachment([papers], 'Inbox/a.pdf', 'pdf')).toEqual({ kind: 'generic' });
  });
});

describe('attachment move planning', () => {
  it('never passes a group-owned file to generic rules', () => {
    const rule = createAttachmentRule({ destinationFolder: 'Elsewhere' });
    const result = planAttachmentMoves(
      [{ path: 'Library/a.pdf' }], [rule], [papers], ['Library/a.pdf'],
    );
    expect(result.moves).toEqual([]);
    expect(result.managed).toEqual([{
      path: 'Library/a.pdf', groupId: 'papers', groupName: 'Papers',
    }]);
  });

  it('uses the first matching generic rule only', () => {
    const special = createAttachmentRule({
      id: 'special', name: 'Special', sourceFolders: ['Inbox'], extensions: ['pdf'],
      destinationFolder: 'Papers',
    });
    const fallback = createAttachmentRule({ id: 'fallback', destinationFolder: 'Assets' });
    const result = planAttachmentMoves(
      [{ path: 'Inbox/a.pdf' }], [special, fallback], [], ['Inbox/a.pdf'],
    );
    expect(result.moves[0]).toMatchObject({
      from: 'Inbox/a.pdf', to: 'Papers/a.pdf', ruleId: 'special',
    });
  });

  it('fills the smallest available number instead of max plus one', () => {
    const rule = createAttachmentRule({
      nameTemplate: 'paper-{{index}}', destinationFolder: 'Papers',
    });
    const result = planAttachmentMoves(
      [{ path: 'Inbox/new.pdf' }], [rule], [],
      ['Inbox/new.pdf', 'Papers/paper-1.pdf', 'Papers/paper-82.pdf'],
    );
    expect(result.moves[0].to).toBe('Papers/paper-2.pdf');
  });

  it('compacts gaps when a whole folder is planned in natural order', () => {
    const rule = createAttachmentRule({
      sourceFolders: ['Inbox'], destinationFolder: 'Inbox', nameTemplate: 'paper-{{index}}',
    });
    const result = planAttachmentMoves(
      [{ path: 'Inbox/paper-1.pdf' }, { path: 'Inbox/paper-82.pdf' }],
      [rule], [], ['Inbox/paper-1.pdf', 'Inbox/paper-82.pdf'],
    );
    expect(result.moves).toEqual([{
      from: 'Inbox/paper-82.pdf', to: 'Inbox/paper-2.pdf',
      ruleId: rule.id, ruleName: rule.name,
    }]);
  });

  it('uses the active note name and de-duplicates repeated candidates', () => {
    const rule = createAttachmentRule({ destinationFolder: 'Papers', nameTemplate: '{{note}}-{{index}}' });
    const result = planAttachmentMoves([
      { path: 'Inbox/a.pdf', noteBasename: 'Memory' },
      { path: 'Inbox/a.pdf', noteBasename: 'Memory' },
      { path: 'Inbox/b.pdf', noteBasename: 'Memory' },
    ], [rule], [], ['Inbox/a.pdf', 'Inbox/b.pdf']);
    expect(result.moves.map(move => move.to)).toEqual([
      'Papers/Memory-1.pdf', 'Papers/Memory-2.pdf',
    ]);
  });

  it('falls back to the attachment basename when note is unavailable', () => {
    const rule = createAttachmentRule({ destinationFolder: 'Papers', nameTemplate: '{{note}}-{{index}}' });
    const result = planAttachmentMoves(
      [{ path: 'Inbox/memory.pdf' }], [rule], [], ['Inbox/memory.pdf'],
    );
    expect(result.moves[0].to).toBe('Papers/memory-1.pdf');
  });

  it('reports files that match no rule', () => {
    const pdf = createAttachmentRule({ extensions: ['pdf'], destinationFolder: 'Papers' });
    const result = planAttachmentMoves(
      [{ path: 'Inbox/a.png' }], [pdf], [], ['Inbox/a.png'],
    );
    expect(result).toEqual({ moves: [], managed: [], unmatched: ['Inbox/a.png'] });
  });
});
