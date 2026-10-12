import { App, Modal, Setting } from 'obsidian';
import type { DeletionPlan } from './deletion-policy';
import { buildDeletionTree } from './change-tree';
import { renderTree } from './change-tree-view';
import { t } from './i18n/i18n';

class DeletionModal extends Modal {
  private answered = false;

  constructor(app: App, private plan: DeletionPlan, private answer: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('amm-backfill-modal');
    this.contentEl.addClass('amm-backfill-content');
    this.contentEl.createEl('h3', { text: t('deletion.title') });
    this.contentEl.createEl('p', { text: t('deletion.origin', { path: this.plan.origin }) });
    const legend = this.contentEl.createDiv({ cls: 'amm-change-legend' });
    legend.createSpan({ text: t('deletion.legend'), cls: 'is-removed' });
    if (this.plan.shared.length > 0) {
      this.contentEl.createEl('p', { text: t('deletion.shared') });
    }
    renderTree(this.contentEl.createDiv({ cls: 'amm-change-tree-viewport' }),
      buildDeletionTree(this.plan).children);
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton(button => button.setButtonText(t('deletion.confirm')).setCta().onClick(() => {
        this.answered = true;
        this.answer(true);
        this.close();
      }));
  }

  onClose(): void {
    if (!this.answered) this.answer(false);
    this.contentEl.empty();
  }
}

export function confirmDeletion(app: App, plan: DeletionPlan): Promise<boolean> {
  return new Promise(resolve => new DeletionModal(app, plan, resolve).open());
}
