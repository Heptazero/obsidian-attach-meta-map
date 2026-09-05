import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { planWithChanges, sameChanges } from '../src/creation-plan';
import { createGroup } from '../src/settings-model';

const attachment = { path: 'Files/paper.pdf' } as TFile;
const group = createGroup({ resourceFolder: 'Files', noteFolder: 'Notes' });

describe('creation plans', () => {
  it('omits plans that would not change anything', () => {
    expect(planWithChanges(attachment, group, 'create', [])).toBeNull();
  });

  it('keeps the attachment, group, mode, and ordered changes together', () => {
    const changes = [{ kind: 'create-note' as const, path: 'Notes/paper.md' }];
    expect(planWithChanges(attachment, group, 'create', changes)).toEqual({
      attachment,
      group,
      mode: 'create',
      changes,
    });
  });

  it('detects any plan change before an approved batch is applied', () => {
    const approved = [{ kind: 'move' as const, from: 'Files/a.pdf', to: 'Library/a/a.pdf' }];
    expect(sameChanges(approved, [...approved])).toBe(true);
    expect(sameChanges(approved, [
      { kind: 'move', from: 'Files/a.pdf', to: 'Library/a-2/a.pdf' },
    ])).toBe(false);
  });
});
