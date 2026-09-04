import type { CreateChange } from './note-manager';

export type ChangeTone = 'removed' | 'added' | 'neutral';
export type ChangeNodeKind = 'folder' | 'file' | 'property';

export interface ChangeTreeNode {
  name: string;
  path: string;
  kind: ChangeNodeKind;
  tone: ChangeTone;
  children: ChangeTreeNode[];
}

function addPath(
  root: ChangeTreeNode, path: string, tone: ChangeTone, child?: ChangeTreeNode,
): ChangeTreeNode {
  const parts = path.split('/').filter(Boolean);
  let parent = root;
  let currentPath = '';
  parts.forEach((part, index) => {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    let node = parent.children.find(item => item.name === part && item.kind !== 'property');
    if (!node) {
      node = {
        name: part,
        path: currentPath,
        kind: index === parts.length - 1 ? 'file' : 'folder',
        tone: index === parts.length - 1 ? tone : 'neutral',
        children: [],
      };
      parent.children.push(node);
    } else if (index === parts.length - 1 && tone !== 'neutral') {
      node.tone = tone;
    }
    parent = node;
  });
  if (child && !parent.children.some(item => item.name === child.name && item.kind === child.kind)) {
    parent.children.push(child);
  }
  return parent;
}

function sortTree(node: ChangeTreeNode): void {
  node.children.sort((a, b) => {
    if (a.kind === 'folder' && b.kind !== 'folder') return -1;
    if (a.kind !== 'folder' && b.kind === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

/** Builds a compact tree of only the branches affected by the confirmed batch. */
export function buildChangeTree(changes: CreateChange[]): ChangeTreeNode {
  const root: ChangeTreeNode = {
    name: '', path: '', kind: 'folder', tone: 'neutral', children: [],
  };

  for (const change of changes) {
    if (change.kind === 'move') {
      addPath(root, change.from, 'removed');
      addPath(root, change.to, 'added');
    } else if (change.kind === 'create-note') {
      addPath(root, change.path, 'added');
    } else {
      addPath(root, change.notePath, 'neutral', {
        name: `source + ${change.link}`,
        path: `${change.notePath}#source`,
        kind: 'property',
        tone: 'added',
        children: [],
      });
    }
  }

  sortTree(root);
  return root;
}
