import { App, Modal, Setting } from 'obsidian';
import { AttachmentMovePlan } from './attachment-rules';
import { buildChangeTree, ChangeTreeNode } from './change-tree';
import { t } from './i18n/i18n';
import { runInBackground } from './background-task';

function renderTree(parent: HTMLElement, nodes: ChangeTreeNode[]): void {
  const list = parent.createEl('ul', { cls: 'amm-change-tree' });
  for (const node of nodes) {
    const row = list.createEl('li');
    const line = row.createDiv({
      cls: `amm-change-line is-${node.kind} is-${node.tone}`,
    });
    if (node.tone === 'removed') line.createSpan({ text: '−', cls: 'amm-change-marker' });
    if (node.tone === 'added') line.createSpan({ text: '+', cls: 'amm-change-marker' });
    line.createSpan({ text: node.name });
    if (node.children.length > 0) renderTree(row, node.children);
  }
}

export class OrganizerPreviewModal extends Modal {
  constructor(
    app: App,
    private moves: AttachmentMovePlan[],
    private managedCount: number,
    private unmatchedCount: number,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('amm-backfill-modal');
    this.contentEl.addClass('amm-backfill-content');
    this.contentEl.createEl('h3', { text: t('organizer.previewTitle') });
    this.contentEl.createEl('p', {
      text: t('organizer.previewSubtitle', {
        changes: this.moves.length,
        managed: this.managedCount,
        unmatched: this.unmatchedCount,
      }),
    });

    const legend = this.contentEl.createDiv({ cls: 'amm-change-legend' });
    legend.createSpan({ text: t('backfill.legend.removed'), cls: 'is-removed' });
    legend.createSpan({ text: t('backfill.legend.added'), cls: 'is-added' });

    const changes = this.moves.map(move => ({ kind: 'move' as const, from: move.from, to: move.to }));
    const tree = buildChangeTree(changes);
    const viewport = this.contentEl.createDiv({ cls: 'amm-change-tree-viewport' });
    renderTree(viewport, tree.children);

    new Setting(this.contentEl)
      .addButton(button => button
        .setButtonText(t('common.cancel'))
        .onClick(() => this.close()))
      .addButton(button => button
        .setButtonText(t('organizer.confirm'))
        .setCta()
        .onClick(() => {
          this.close();
          runInBackground(() => this.onConfirm(), 'Could not apply attachment plan');
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
