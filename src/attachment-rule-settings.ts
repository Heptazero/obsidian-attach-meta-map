import { App, Modal, Setting, setIcon } from 'obsidian';
import type AttMetaMapPlugin from './main';
import { AttachmentRule } from './types';
import { createAttachmentRule, isCatchAllRule } from './attachment-rules';
import { ExtensionSuggest, FolderListSuggest, FolderSuggest } from './suggesters';
import { t } from './i18n/i18n';

function folders(value: string): string[] {
  return value.split(',').map(part => part.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
}

function extensions(value: string): string[] {
  return value.split(',')
    .map(part => part.trim().replace(/^\.+/, '').toLowerCase())
    .filter(Boolean)
    .map(part => `.${part}`);
}

function confirmRemoval(app: App, name: string): Promise<boolean> {
  return new Promise(resolve => {
    let answered = false;
    class ConfirmModal extends Modal {
      onOpen(): void {
        this.contentEl.createEl('p', { text: t('settings.rules.removeConfirm', { name }) });
        new Setting(this.contentEl)
          .addButton(button => button.setButtonText(t('common.confirm')).setCta()
            .onClick(() => { answered = true; resolve(true); this.close(); }))
          .addButton(button => button.setButtonText(t('common.cancel'))
            .onClick(() => { answered = true; resolve(false); this.close(); }));
      }
      onClose(): void {
        this.contentEl.empty();
        if (!answered) resolve(false);
      }
    }
    new ConfirmModal(app).open();
  });
}

function section(
  body: HTMLElement,
  title: string,
  render: (el: HTMLElement) => void,
  renderActions?: (el: HTMLElement) => void,
): void {
  const details = body.createEl('details', { cls: 'amm-accordion' });
  const summary = details.createEl('summary', { cls: 'amm-accordion-summary' });
  summary.createSpan({ text: title, cls: 'amm-accordion-summary-title' });
  if (renderActions) {
    renderActions(summary.createSpan({ cls: 'amm-accordion-summary-actions' }));
  }
  render(details.createEl('div', { cls: 'amm-accordion-body' }));
}

function summaryButton(
  parent: HTMLElement,
  icon: 'arrow-up' | 'arrow-down' | 'trash',
  tooltip: string,
  disabled: boolean,
  onClick: () => void,
): void {
  const button = parent.createEl('button', {
    cls: 'amm-accordion-summary-action clickable-icon',
    attr: { 'aria-label': tooltip, title: tooltip, type: 'button' },
  });
  setIcon(button, icon);
  button.disabled = disabled;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) onClick();
  });
}

export class AttachmentRuleSettings {
  constructor(
    private app: App,
    private plugin: AttMetaMapPlugin,
    private redisplay: () => void,
  ) {}

  render(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('settings.rules.title'))
      .setDesc(t('settings.rules.desc'))
      .setHeading();

    if (this.plugin.settings.attachmentRules.length === 0) {
      containerEl.createEl('p', { text: t('settings.rules.empty'), cls: 'amm-rules-empty' });
    }

    this.plugin.settings.attachmentRules.forEach((rule, index) => {
      section(containerEl, `${index + 1}. ${rule.name}`, el => {
        if (isCatchAllRule(rule) && index < this.plugin.settings.attachmentRules.length - 1) {
          el.createEl('div', {
            text: t('settings.rules.catchAllWarning'),
            cls: 'amm-rule-warning',
          });
        }
        new Setting(el)
          .setName(t('settings.rules.fields.name'))
          .addText(text => text
            .setValue(rule.name)
            .onChange(async value => {
              rule.name = value.trim() || t('settings.rules.defaultName', { index: index + 1 });
              await this.plugin.saveSettings();
            }))
          .addToggle(toggle => toggle
            .setTooltip(t('settings.rules.fields.enabled'))
            .setValue(rule.enabled)
            .onChange(async value => {
              rule.enabled = value;
              await this.plugin.saveSettings();
            }));

        this.renderConditions(el, rule);
        this.renderActions(el, rule);
      }, summaryActions => {
        summaryButton(summaryActions, 'arrow-up', t('settings.rules.moveUp'), index === 0,
          () => { void this.move(index, -1); });
        summaryButton(summaryActions, 'arrow-down', t('settings.rules.moveDown'),
          index === this.plugin.settings.attachmentRules.length - 1,
          () => { void this.move(index, 1); });
        summaryButton(summaryActions, 'trash', t('settings.rules.remove'), false,
          () => { void this.remove(rule); });
      });
    });

    new Setting(containerEl)
      .addButton(button => button
        .setButtonText(t('settings.rules.add'))
        .setCta()
        .onClick(() => { void (async () => {
          const index = this.plugin.settings.attachmentRules.length + 1;
          this.plugin.settings.attachmentRules.push(createAttachmentRule({
            name: t('settings.rules.defaultName', { index }),
          }));
          await this.plugin.saveSettings();
          this.redisplay();
        })(); }));
  }

  private renderConditions(body: HTMLElement, rule: AttachmentRule): void {
    const updateSourceFolders = async (value: string, includeSubfoldersSetting: Setting): Promise<void> => {
      rule.sourceFolders = folders(value);
      includeSubfoldersSetting.setDisabled(rule.sourceFolders.length === 0);
      await this.plugin.saveSettings();
    };

    new Setting(body)
      .setName(t('settings.rules.fields.sourceFolders'))
      .setDesc(t('settings.rules.fields.sourceFoldersDesc'))
      .addText(text => {
        text.setValue(rule.sourceFolders.join(', ')).onChange(value => {
          void updateSourceFolders(value, includeSubfoldersSetting);
        });
        new FolderListSuggest(this.app, text.inputEl, value => {
          void updateSourceFolders(value, includeSubfoldersSetting);
        });
      });

    const includeSubfoldersSetting = new Setting(body)
      .setName(t('settings.rules.fields.includeSubfolders'))
      .addToggle(toggle => toggle
        .setValue(rule.includeSubfolders)
        .onChange(async value => {
          rule.includeSubfolders = value;
          await this.plugin.saveSettings();
        }))
      .setDisabled(rule.sourceFolders.length === 0);

    new Setting(body)
      .setName(t('settings.rules.fields.excludedFolders'))
      .addText(text => {
        text.setValue(rule.excludedFolders.join(', ')).onChange(async value => {
          rule.excludedFolders = folders(value);
          await this.plugin.saveSettings();
        });
        new FolderListSuggest(this.app, text.inputEl, value => {
          rule.excludedFolders = folders(value);
          void this.plugin.saveSettings();
        });
      });

    this.renderExtensionField(body, rule, false);
    this.renderExtensionField(body, rule, true);
  }

  private renderExtensionField(body: HTMLElement, rule: AttachmentRule, excluded: boolean): void {
    const key = excluded ? 'excludedExtensions' : 'extensions';
    new Setting(body)
      .setName(t(`settings.rules.fields.${key}`))
      .setDesc(excluded ? '' : t('settings.rules.fields.extensionsDesc'))
      .addText(text => {
        text.setValue(rule[key].join(', ')).onChange(async value => {
          rule[key] = extensions(value);
          await this.plugin.saveSettings();
        });
        new ExtensionSuggest(this.app, text.inputEl, value => {
          rule[key] = extensions(value);
          void this.plugin.saveSettings();
        });
      });
  }

  private renderActions(body: HTMLElement, rule: AttachmentRule): void {
    new Setting(body)
      .setName(t('settings.rules.fields.destinationFolder'))
      .setDesc(t('settings.rules.fields.destinationFolderDesc'))
      .addText(text => {
        text.setValue(rule.destinationFolder).onChange(async value => {
          rule.destinationFolder = value.trim();
          await this.plugin.saveSettings();
        });
        new FolderSuggest(this.app, text.inputEl, async value => {
          rule.destinationFolder = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(body)
      .setName(t('settings.rules.fields.nameTemplate'))
      .setDesc(t('settings.rules.fields.nameTemplateDesc'))
      .addText(text => text
        .setPlaceholder('{{basename}}')
        .setValue(rule.nameTemplate)
        .onChange(async value => {
          rule.nameTemplate = value.trim() || '{{basename}}';
          await this.plugin.saveSettings();
        }));
  }

  private async move(index: number, delta: number): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= this.plugin.settings.attachmentRules.length) return;
    const rules = this.plugin.settings.attachmentRules;
    [rules[index], rules[target]] = [rules[target], rules[index]];
    await this.plugin.saveSettings();
    this.redisplay();
  }

  private async remove(rule: AttachmentRule): Promise<void> {
    if (!await confirmRemoval(this.app, rule.name)) return;
    this.plugin.settings.attachmentRules = this.plugin.settings.attachmentRules
      .filter(item => item.id !== rule.id);
    await this.plugin.saveSettings();
    this.redisplay();
  }
}
