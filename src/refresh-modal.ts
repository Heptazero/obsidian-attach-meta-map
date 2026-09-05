import { App, Modal, Setting, TFile } from 'obsidian';
import { DiffRow, formatValue } from './metadata-diff';
import { t } from './i18n/i18n';
import { runInBackground } from './background-task';

export class RefreshModal extends Modal {
  constructor(
    app: App,
    private note: TFile,
    private rows: DiffRow[],
    private onApply: (accepted: DiffRow[]) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('amm-refresh-modal');
    contentEl.createEl('h3', { text: t('refresh.title') });
    contentEl.createEl('p', { text: t('refresh.subtitle', { note: this.note.basename }) });

    const changed = this.rows.filter(r => !r.unchanged);
    if (changed.length === 0) {
      contentEl.createEl('p', { text: t('refresh.noChanges') });
      new Setting(contentEl).addButton(btn => btn
        .setButtonText(t('common.close')).setCta().onClick(() => this.close()));
      return;
    }

    const table = contentEl.createEl('table', { cls: 'amm-diff-table' });
    const head = table.createEl('thead').createEl('tr');
    head.createEl('th', { text: t('refresh.columns.property') });
    head.createEl('th', { text: t('refresh.columns.current') });
    head.createEl('th', { text: t('refresh.columns.incoming') });

    const body = table.createEl('tbody');
    const radios: { row: DiffRow; keep: HTMLInputElement; take: HTMLInputElement }[] = [];

    changed.forEach((row, index) => {
      const tr = body.createEl('tr');
      tr.createEl('td', { text: row.property, cls: 'amm-diff-property' });

      const keep = this.valueCell(tr, `amm-row-${index}`, formatValue(row.current), !row.takeIncoming);
      const take = this.valueCell(tr, `amm-row-${index}`, formatValue(row.incoming), row.takeIncoming);

      keep.addEventListener('change', () => { row.takeIncoming = false; });
      take.addEventListener('change', () => { row.takeIncoming = true; });
      radios.push({ row, keep, take });
    });

    const setAll = (takeIncoming: boolean): void => {
      for (const { row, keep, take } of radios) {
        row.takeIncoming = takeIncoming;
        keep.checked = !takeIncoming;
        take.checked = takeIncoming;
      }
    };

    new Setting(contentEl)
      .addButton(btn => btn.setButtonText(t('refresh.keepAll')).onClick(() => setAll(false)))
      .addButton(btn => btn.setButtonText(t('refresh.takeAll')).onClick(() => setAll(true)));

    new Setting(contentEl)
      .addButton(btn => btn.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton(btn => btn.setButtonText(t('refresh.apply')).setCta().onClick(() => {
        const accepted = changed.filter(r => r.takeIncoming);
        this.close();
        runInBackground(() => this.onApply(accepted), 'Could not apply metadata changes');
      }));
  }

  private valueCell(
    tr: HTMLElement, name: string, text: string, checked: boolean,
  ): HTMLInputElement {
    const td = tr.createEl('td', { cls: 'amm-diff-value' });
    const label = td.createEl('label');
    const input = label.createEl('input', { attr: { type: 'radio', name } });
    input.checked = checked;
    label.createEl('span', {
      text: text || t('refresh.emptyValue'),
      cls: text ? 'amm-diff-text' : 'amm-diff-text amm-diff-empty',
    });
    return input;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
