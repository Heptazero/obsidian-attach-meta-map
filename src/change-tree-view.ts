import type { ChangeTreeNode } from './change-tree';

export function renderTree(parent: HTMLElement, nodes: ChangeTreeNode[]): void {
  const list = parent.createEl('ul', { cls: 'amm-change-tree' });
  for (const node of nodes) {
    const row = list.createEl('li');
    const line = row.createDiv({ cls: `amm-change-line is-${node.kind} is-${node.tone}` });
    if (node.tone === 'removed') line.createSpan({ text: '−', cls: 'amm-change-marker' });
    if (node.tone === 'added') line.createSpan({ text: '+', cls: 'amm-change-marker' });
    line.createSpan({ text: node.name });
    if (node.children.length > 0) renderTree(row, node.children);
  }
}
