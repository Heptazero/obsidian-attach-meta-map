import { App, Modal, Setting } from 'obsidian';
import type { CreateChange, CreatePlan } from './note-manager';
import { t } from './i18n/i18n';

function describe(change: CreateChange): string {
  if (change.kind === 'move') return t('backfill.actions.move', change);
  if (change.kind === 'create-note') return t('backfill.actions.createNote', change);
  return t('backfill.actions.updateSource', change);
}

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
    contentEl.addClass('amm-backfill-modal');
    contentEl.createEl('h3', { text: t('backfill.previewTitle') });
    const changeCount = this.plans.reduce((sum, plan) => sum + plan.changes.length, 0);
    contentEl.createEl('p', {
      text: t('backfill.previewSubtitle', { items: this.plans.length, changes: changeCount }),
    });

    const table = contentEl.createEl('table', { cls: 'amm-backfill-table' });
    const head = table.createEl('thead').createEl('tr');
    head.createEl('th', { text: t('backfill.columns.resource') });
    head.createEl('th', { text: t('backfill.columns.changes') });
    const body = table.createEl('tbody');

    for (const plan of this.plans) {
      const row = body.createEl('tr');
      const resource = row.createEl('td');
      resource.createEl('div', { text: plan.attachment.name, cls: 'amm-backfill-resource' });
      resource.createEl('div', { text: plan.group.name, cls: 'amm-backfill-group' });
      const changes = row.createEl('td');
      const list = changes.createEl('ul');
      for (const change of plan.changes) list.createEl('li', { text: describe(change) });
    }

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
          void this.onConfirm();
        }));
  }

  private confirmed = false;

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.onCancel();
  }
}
