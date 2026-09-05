import { App, ButtonComponent, Modal, Setting, TFile } from 'obsidian';
import { t } from './i18n/i18n';
import { runInBackground } from './background-task';

export class UnbindModal extends Modal {
  private selected: Set<string>;

  constructor(
    app: App,
    private note: TFile,
    private targets: string[],
    preselected: string[],
    private onApply: (targets: string[]) => Promise<void>,
  ) {
    super(app);
    this.selected = new Set(preselected);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('amm-unbind-modal');
    contentEl.createEl('h3', { text: t('unbind.title') });
    contentEl.createEl('p', { text: t('unbind.subtitle', { note: this.note.basename }) });

    let confirmButton: ButtonComponent | null = null;
    const refreshConfirm = (): void => {
      confirmButton?.setDisabled(this.selected.size === 0);
    };

    for (const target of this.targets) {
      new Setting(contentEl)
        .setName(target)
        .addToggle(toggle => toggle
          .setValue(this.selected.has(target))
          .onChange(value => {
            if (value) this.selected.add(target);
            else this.selected.delete(target);
            refreshConfirm();
          }));
    }

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText(t('common.cancel'))
        .onClick(() => this.close()))
      .addButton(button => {
        confirmButton = button;
        button
          .setButtonText(t('unbind.confirm'))
          .setCta()
          .setDisabled(this.selected.size === 0)
          .onClick(() => {
            const selected = [...this.selected];
            runInBackground(
              async () => { await this.onApply(selected); this.close(); },
              'Could not unbind sources',
            );
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
