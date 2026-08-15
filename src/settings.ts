import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type AttMetaMapPlugin from './main';
import { FIELD_DEFS, createGroup } from './fields';
import { FieldSource, MappingGroup } from './types';
import { t } from './i18n/i18n';

function confirmModal(app: App, message: string): Promise<boolean> {
  return new Promise(resolve => {
    let answered = false;
    class ConfirmModal extends Modal {
      onOpen(): void {
        this.contentEl.createEl('p', { text: message });
        new Setting(this.contentEl)
          .addButton(btn => btn.setButtonText(t('common.confirm')).setCta()
            .onClick(() => { answered = true; resolve(true); this.close(); }))
          .addButton(btn => btn.setButtonText(t('common.cancel'))
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

const SOURCE_ORDER: FieldSource[] = ['vault', 'pdf', 'lookup', 'manual'];

export class AttMetaMapSettingTab extends PluginSettingTab {
  /** Group ids whose card is expanded, kept across re-renders. */
  private expanded = new Set<string>();

  constructor(app: App, private plugin: AttMetaMapPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('amm-settings');

    new Setting(containerEl)
      .setName(t('settings.groups.heading'))
      .setDesc(t('settings.groups.desc'))
      .setHeading()
      .addButton(btn => btn
        .setButtonText(t('settings.groups.add'))
        .setCta()
        .onClick(() => { void (async () => {
          const group = createGroup({ name: t('settings.groups.newName') });
          this.plugin.settings.groups.push(group);
          this.expanded.add(group.id);
          await this.plugin.saveSettings();
          this.display();
        })(); }));

    if (this.plugin.settings.groups.length === 0) {
      containerEl.createEl('p', { text: t('settings.groups.empty') });
      return;
    }

    for (const group of this.plugin.settings.groups) {
      this.renderGroup(containerEl, group);
    }
  }

  private renderGroup(containerEl: HTMLElement, group: MappingGroup): void {
    const card = containerEl.createEl('details', { cls: 'amm-group' });
    card.open = this.expanded.has(group.id);
    card.addEventListener('toggle', () => {
      if (card.open) this.expanded.add(group.id);
      else this.expanded.delete(group.id);
    });

    const summary = card.createEl('summary', { cls: 'amm-group-summary' });
    summary.createEl('span', { text: group.name || t('settings.groups.newName'), cls: 'amm-group-title' });
    summary.createEl('span', {
      text: `${group.attachmentsFolder || '?'} → ${group.notesFolder || '?'}`,
      cls: 'amm-group-path',
    });

    const body = card.createEl('div', { cls: 'amm-group-body' });

    new Setting(body)
      .setName(t('settings.group.name.name'))
      .addText(text => text
        .setValue(group.name)
        .onChange(async value => {
          group.name = value;
          await this.plugin.saveSettings();
        }))
      .addExtraButton(btn => btn
        .setIcon('trash')
        .setTooltip(t('settings.group.remove'))
        .onClick(() => { void (async () => {
          const ok = await confirmModal(this.app, t('settings.group.removeConfirm', { name: group.name }));
          if (!ok) return;
          this.plugin.settings.groups = this.plugin.settings.groups.filter(g => g.id !== group.id);
          await this.plugin.saveSettings();
          this.display();
        })(); }));

    this.renderFolders(body, group);
    this.renderNaming(body, group);
    this.renderBehavior(body, group);
    this.renderExtraction(body, group);
    this.renderFields(body, group);
    this.renderBases(body, group);
    this.renderActions(body, group);
  }

  private renderFolders(body: HTMLElement, group: MappingGroup): void {
    new Setting(body).setName(t('settings.sections.folders')).setHeading();

    new Setting(body)
      .setName(t('settings.group.attachmentsFolder.name'))
      .setDesc(t('settings.group.attachmentsFolder.desc'))
      .addText(text => text
        .setPlaceholder('Attachments')
        .setValue(group.attachmentsFolder)
        .onChange(async value => {
          group.attachmentsFolder = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.notesFolder.name'))
      .setDesc(t('settings.group.notesFolder.desc'))
      .addText(text => text
        .setPlaceholder('Library')
        .setValue(group.notesFolder)
        .onChange(async value => {
          group.notesFolder = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.mirror.name'))
      .setDesc(t('settings.group.mirror.desc'))
      .addToggle(toggle => toggle
        .setValue(group.mirrorFolderStructure)
        .onChange(async value => {
          group.mirrorFolderStructure = value;
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.extensions.name'))
      .setDesc(t('settings.group.extensions.desc'))
      .addText(text => text
        .setPlaceholder('.pdf, .epub')
        .setValue(group.watchedExtensions.join(', '))
        .onChange(async value => {
          group.watchedExtensions = value
            .split(',')
            .map(part => part.trim().toLowerCase())
            .filter(part => part.length > 0)
            .map(part => (part.startsWith('.') ? part : `.${part}`));
          await this.plugin.saveSettings();
        }));
  }

  private renderNaming(body: HTMLElement, group: MappingGroup): void {
    new Setting(body).setName(t('settings.sections.naming')).setHeading();

    new Setting(body)
      .setName(t('settings.group.noteName.name'))
      .setDesc(t('settings.group.noteName.desc'))
      .addText(text => text
        .setPlaceholder('{{basename}}')
        .setValue(group.noteNameTemplate)
        .onChange(async value => {
          group.noteNameTemplate = value.trim() || '{{basename}}';
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.linkTemplate.name'))
      .setDesc(t('settings.group.linkTemplate.desc'))
      .addText(text => text
        .setPlaceholder('[[{{basename}}]]')
        .setValue(group.linkTemplate)
        .onChange(async value => {
          group.linkTemplate = value.trim() || '[[{{basename}}]]';
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.embed.name'))
      .setDesc(t('settings.group.embed.desc'))
      .addToggle(toggle => toggle
        .setValue(group.embedAttachment)
        .onChange(async value => {
          group.embedAttachment = value;
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.heading.name'))
      .setDesc(t('settings.group.heading.desc'))
      .addToggle(toggle => toggle
        .setValue(group.includeHeading)
        .onChange(async value => {
          group.includeHeading = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderBehavior(body: HTMLElement, group: MappingGroup): void {
    new Setting(body).setName(t('settings.sections.behavior')).setHeading();

    new Setting(body)
      .setName(t('settings.group.autoCreate.name'))
      .addToggle(toggle => toggle
        .setValue(group.autoCreateOnNew)
        .onChange(async value => {
          group.autoCreateOnNew = value;
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.autoDelete.name'))
      .setDesc(t('settings.group.autoDelete.desc'))
      .addToggle(toggle => toggle
        .setValue(group.autoDeleteOnRemove)
        .onChange(async value => {
          group.autoDeleteOnRemove = value;
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.syncUpdated.name'))
      .setDesc(t('settings.group.syncUpdated.desc'))
      .addToggle(toggle => toggle
        .setValue(group.syncUpdatedOnModify)
        .onChange(async value => {
          group.syncUpdatedOnModify = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderExtraction(body: HTMLElement, group: MappingGroup): void {
    new Setting(body).setName(t('settings.sections.extraction')).setHeading();

    new Setting(body)
      .setName(t('settings.group.pdfExtraction.name'))
      .setDesc(t('settings.group.pdfExtraction.desc'))
      .addToggle(toggle => toggle
        .setValue(group.enablePdfMetadataExtraction)
        .onChange(async value => {
          group.enablePdfMetadataExtraction = value;
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.doiLookup.name'))
      .setDesc(t('settings.group.doiLookup.desc'))
      .addToggle(toggle => toggle
        .setValue(group.enableDoiIsbnLookup)
        .onChange(async value => {
          group.enableDoiIsbnLookup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(body)
      .setName(t('settings.group.sanitize.name'))
      .setDesc(t('settings.group.sanitize.desc'))
      .addToggle(toggle => toggle
        .setValue(group.sanitizeListValues)
        .onChange(async value => {
          group.sanitizeListValues = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderFields(body: HTMLElement, group: MappingGroup): void {
    new Setting(body)
      .setName(t('settings.sections.fields'))
      .setDesc(t('settings.fields.desc'))
      .setHeading();

    for (const source of SOURCE_ORDER) {
      const defs = FIELD_DEFS.filter(def => def.source === source);
      if (defs.length === 0) continue;

      body.createEl('div', {
        text: t(`settings.fieldSources.${source}`),
        cls: 'amm-field-source',
      });

      for (const def of defs) {
        const config = group.fields[def.id] ?? { enabled: def.enabled, property: def.property };
        group.fields[def.id] = config;

        const setting = new Setting(body)
          .setClass('amm-field-row')
          .setName(t(`fields.${def.id}.name`))
          .setDesc(t(`fields.${def.id}.desc`));

        setting.addToggle(toggle => toggle
          .setValue(config.enabled)
          .onChange(async value => {
            config.enabled = value;
            await this.plugin.saveSettings();
          }));

        setting.addText(text => text
          .setPlaceholder(def.property)
          .setValue(config.property)
          .onChange(async value => {
            config.property = value.trim() || def.property;
            await this.plugin.saveSettings();
          }));

        if (def.source === 'manual') {
          setting.addText(text => text
            .setPlaceholder(t('settings.fields.defaultValue'))
            .setValue(config.defaultValue ?? def.defaultValue ?? '')
            .onChange(async value => {
              config.defaultValue = value;
              await this.plugin.saveSettings();
            }));
        }
      }
    }
  }

  private renderBases(body: HTMLElement, group: MappingGroup): void {
    new Setting(body).setName(t('settings.sections.bases')).setHeading();

    new Setting(body)
      .setName(t('settings.group.baseFile.name'))
      .setDesc(t('settings.group.baseFile.desc'))
      .addToggle(toggle => toggle
        .setValue(group.autoCreateBaseFile)
        .onChange(async value => {
          group.autoCreateBaseFile = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.basesCreator.createOrUpdate(group);
        }));

    let pendingFolder = group.baseFolderPath;
    new Setting(body)
      .setName(t('settings.group.baseFolder.name'))
      .setDesc(t('settings.group.baseFolder.desc'))
      .addText(text => text
        .setPlaceholder(group.notesFolder)
        .setValue(group.baseFolderPath)
        .onChange(value => { pendingFolder = value.trim(); }))
      .addButton(btn => btn
        .setButtonText(t('settings.group.baseFolder.move'))
        .onClick(() => { void (async () => {
          const oldFolder = group.baseFolderPath;
          await this.plugin.basesCreator.move(group, oldFolder, pendingFolder);
          group.baseFolderPath = pendingFolder;
          await this.plugin.saveSettings();
          await this.plugin.basesCreator.createOrUpdate(group);
          new Notice(t('notices.baseMoved'));
        })(); }));
  }

  private renderActions(body: HTMLElement, group: MappingGroup): void {
    new Setting(body).setName(t('settings.sections.actions')).setHeading();

    new Setting(body)
      .setName(t('settings.group.backfill.name'))
      .setDesc(t('settings.group.backfill.desc'))
      .addButton(btn => btn
        .setButtonText(t('settings.group.backfill.run'))
        .setCta()
        .onClick(() => {
          void this.plugin.backfillManager.runForGroup(group, this.plugin.settings.groups);
        }));

    let renameFrom = '';
    let renameTo = '';
    new Setting(body)
      .setName(t('settings.group.renameProperty.name'))
      .setDesc(t('settings.group.renameProperty.desc'))
      .addText(text => text
        .setPlaceholder(t('settings.group.renameProperty.from'))
        .onChange(value => { renameFrom = value.trim(); }))
      .addText(text => text
        .setPlaceholder(t('settings.group.renameProperty.to'))
        .onChange(value => { renameTo = value.trim(); }))
      .addButton(btn => btn
        .setButtonText(t('settings.group.renameProperty.run'))
        .onClick(() => { void (async () => {
          if (!renameFrom || !renameTo) {
            new Notice(t('notices.renameNeedsBoth'));
            return;
          }
          const count = await this.plugin.noteManager.migrateProperty(group, renameFrom, renameTo);
          new Notice(t('notices.renamed', { count }));
        })(); }));
  }
}
