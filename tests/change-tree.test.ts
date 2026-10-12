import { describe, expect, it } from 'vitest';
import { buildChangeTree, buildDeletionTree, ChangeTreeNode } from '../src/change-tree';

function find(node: ChangeTreeNode, path: string): ChangeTreeNode | undefined {
  if (node.path === path) return node;
  for (const child of node.children) {
    const match = find(child, path);
    if (match) return match;
  }
  return undefined;
}

describe('batch change tree', () => {
  it('shows trashed files and removed source entries in red, shared resources as retained', () => {
    const tree = buildDeletionTree({
      origin: 'Files/p.pdf', direction: 'resourceToNote',
      changes: [
        { kind: 'trash', path: 'Notes/one.md' },
        { kind: 'unlink', path: 'Notes/two.md', targets: ['p.pdf', 'p-alias.pdf'] },
      ],
      shared: ['Files/shared.pdf'],
    });
    expect(find(tree, 'Notes/one.md')?.tone).toBe('removed');
    expect(find(tree, 'Notes/two.md')?.tone).toBe('neutral');
    expect(find(tree, 'Notes/two.md')?.children).toHaveLength(2);
    expect(find(tree, 'Notes/two.md#source')?.tone).toBe('removed');
    expect(find(tree, 'Files/shared.pdf')?.tone).toBe('neutral');
  });
  it('shows both sides of a move without calling it a file deletion', () => {
    const tree = buildChangeTree([{
      kind: 'move', from: 'Library/paper.pdf', to: 'Library/paper/paper.pdf',
    }]);

    expect(find(tree, 'Library/paper.pdf')?.tone).toBe('removed');
    expect(find(tree, 'Library/paper/paper.pdf')?.tone).toBe('added');
    expect(tree.children.filter(node => node.path === 'Library')).toHaveLength(1);
  });

  it('shows a new note and a source property addition in their filesystem branches', () => {
    const tree = buildChangeTree([
      { kind: 'create-note', path: 'Library/paper/paper.md' },
      { kind: 'update-source', notePath: 'Library/other/other.md', link: '[[cn_other.pdf]]' },
    ]);

    expect(find(tree, 'Library/paper/paper.md')?.tone).toBe('added');
    expect(find(tree, 'Library/other/other.md')?.tone).toBe('neutral');
    expect(find(tree, 'Library/other/other.md#source')).toMatchObject({
      name: 'source + [[cn_other.pdf]]', kind: 'property', tone: 'added',
    });
  });
});
