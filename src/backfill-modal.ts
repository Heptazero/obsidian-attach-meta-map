import { App, Modal, Setting } from 'obsidian';
import type { CreatePlan } from './creation-plan';
import { t } from './i18n/i18n';
import { buildChangeTree } from './change-tree';
import { renderTree } from './change-tree-view';
import { runInBackground } from './background-task';

export class BackfillPreviewModal extends Modal {
  constructor(
    app: App,
    private plans: CreatePlan[],
    private onConfirm: () => Promise<void>,
    private onCancel: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('amm-backfill-modal');
    contentEl.addClass('amm-backfill-content');
    contentEl.createEl('h3', { text: t('backfill.previewTitle') });
    const changeCount = this.plans.reduce((sum, plan) => sum + plan.changes.length, 0);
    contentEl.createEl('p', {
      text: t('backfill.previewSubtitle', { items: this.plans.length, changes: changeCount }),
    });
    const legend = contentEl.createDiv({ cls: 'amm-change-legend' });
    legend.createSpan({ text: t('backfill.legend.removed'), cls: 'is-removed' });
    legend.createSpan({ text: t('backfill.legend.added'), cls: 'is-added' });

    const tree = buildChangeTree(this.plans.flatMap(plan => plan.changes));
    const treeViewport = contentEl.createDiv({ cls: 'amm-change-tree-viewport' });
    renderTree(treeViewport, tree.children);

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText(t('common.cancel'))
        .onClick(() => this.close()))
      .addButton(button => button
        .setButtonText(t('backfill.confirm'))
        .setCta()
        .onClick(() => {
          this.confirmed = true;
          this.close();
          runInBackground(() => this.onConfirm(), 'Could not apply backfill plan');
        }));
  }

  private confirmed = false;

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.onCancel();
  }
}
