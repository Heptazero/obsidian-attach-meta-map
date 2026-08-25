import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type AttMetaMapPlugin from './main';
import { SOURCE_DEFS, createGroup } from './sources';
import { MappingGroup, SourceKind, UiLanguage } from './types';
import { PropertySuggest, TemplateFileSuggest } from './suggesters';
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

const KIND_ORDER: SourceKind[] = ['vault', 'pdf', 'lookup'];

export class AttMetaMapSettingTab extends PluginSettingTab {
  private expanded = new Set<string>();

  constructor(app: App, private plugin: AttMetaMapPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('amm-settings');
    this.plugin.registry.invalidate();

    this.renderGeneral(containerEl);
    this.renderMapping(containerEl);
    this.renderGroups(containerEl);
  }

  // --- general -----------------------------------------------------------

  private renderGeneral(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('settings.sections.general')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown(drop => drop
        .addOption('auto', t('settings.language.auto'))
        .addOption('zh', '中文')
        .addOption('en', 'English')
        .setValue(this.plugin.settings.language)
        .onChange(async value => {
          this.plugin.settings.language = value as UiLanguage;
          await this.plugin.saveSettings();
          await this.plugin.applyLanguage();
          this.display();
        }));

    const detected = this.plugin.registry.detectedFolders();
    new Setting(containerEl)
      .setName(t('settings.templateFolders.name'))
      .setDesc(detected.length
        ? t('settings.templateFolders.detected', { folders: detected.join('、') })
        : t('settings.templateFolders.none'))
      .addText(text => text
        .setPlaceholder(t('settings.templateFolders.placeholder'))
        .setValue(this.plugin.settings.extraTemplateFolders.join(', '))
        .onChange(async value => {
          this.plugin.settings.extraTemplateFolders = value
            .split(',').map(part => part.trim()).filter(part => part.length > 0);
          this.plugin.registry.invalidate();
          await this.plugin.saveSettings();
        }));
  }

  // --- the one mapping table ---------------------------------------------

  private renderMapping(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('settings.sections.mapping'))
      .setDesc(t('settings.mapping.desc'))
      .setHeading();

    for (const kind of KIND_ORDER) {
      const defs = SOURCE_DEFS.filter(def => def.kind === kind);
      if (defs.length === 0) continue;

      containerEl.createEl('div', { text: t(`settings.kinds.${kind}`), cls: 'amm-field-source' });

      for (const def of defs) {
        new Setting(containerEl)
          .setClass('amm-field-row')
          .setName(t(`sources.${def.id}.name`))
          .setDesc(t(`sources.${def.id}.desc`))
          .addText(text => {
            text
              .setPlaceholder(t('settings.mapping.unmapped'))
              .setValue(this.plugin.settings.mapping[def.id] ?? '')
              .onChange(async value => {
                this.plugin.settings.mapping[def.id] = value.trim();
                await this.plugin.saveSettings();
              });

            new PropertySuggest(
              this.app,
              text.inputEl,
              () => this.plugin.registry.knownKeys(),
              async value => {
                this.plugin.settings.mapping[def.id] = value;
                await this.plugin.saveSettings();
              },
            );
          });
      }
    }
  }

  // --- groups ------------------------------------------------------------

  private renderGroups(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('settings.sections.groups'))
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
      .setName(t('settings.group.name'))
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

    new Setting(body)
      .setName(t('settings.group.layout.name'))
      .setDesc(t(`settings.group.layout.desc.${group.layout}`))
      .addDropdown(drop => drop
        .addOption('sidecar', t('settings.group.layout.sidecar'))
        .addOption('folder', t('settings.group.layout.folder'))
        .setValue(group.layout)
        .onChange(async value => {
          group.layout = value as MappingGroup['layout'];
          await this.plugin.saveSettings();
          this.display();
        }));

    if (group.layout === 'folder') {
      new Setting(body)
        .setName(t('settings.group.auxiliaryPrefix.name'))
        .setDesc(t('settings.group.auxiliaryPrefix.desc'))
        .addText(text => text
          .setValue(group.auxiliaryPrefix)
          .onChange(async value => {
            group.auxiliaryPrefix = value.trim();
            await this.plugin.saveSettings();
          }));
    }

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

    this.renderTemplatePicker(body, group);

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
        .setPlaceholder('[[{{name}}]]')
        .setValue(group.linkTemplate)
        .onChange(async value => {
          group.linkTemplate = value.trim() || '[[{{name}}]]';
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

    this.renderBehavior(body, group);
    this.renderActions(body, group);
  }

  private renderTemplatePicker(body: HTMLElement, group: MappingGroup): void {
    const setting = new Setting(body)
      .setName(t('settings.group.template.name'))
      .setDesc(t('settings.group.template.desc'));

    const preview = body.createEl('div', { cls: 'amm-template-preview' });

    const showKeys = (path: string): void => {
      void (async () => {
        if (!path) {
          preview.setText(t('settings.group.template.builtin'));
          return;
        }
        const parsed = await this.plugin.registry.parse(path);
        if (!parsed) {
          preview.setText(t('settings.group.template.missing'));
          return;
        }
        const mapped = new Set(Object.values(this.plugin.settings.mapping).filter(Boolean));
        const keys = parsed.keys.map(key => (mapped.has(key) ? `${key} ✓` : key));
        preview.setText(keys.length
          ? t('settings.group.template.keys', { keys: keys.join('  ·  ') })
          : t('settings.group.template.noKeys'));
      })();
    };

    setting.addText(text => {
      text
        .setPlaceholder(t('settings.group.template.placeholder'))
        .setValue(group.templatePath)
        .onChange(async value => {
          group.templatePath = value.trim();
          await this.plugin.saveSettings();
          showKeys(group.templatePath);
        });

      new TemplateFileSuggest(
        this.app,
        text.inputEl,
        () => this.plugin.registry.files(),
        async value => {
          group.templatePath = value;
          await this.plugin.saveSettings();
          showKeys(value);
        },
      );
    });

    showKeys(group.templatePath);
  }

  private renderBehavior(body: HTMLElement, group: MappingGroup): void {
    new Setting(body)
      .setName(t(`settings.group.autoCreate.name.${group.layout}`))
      .setDesc(t(`settings.group.autoCreate.desc.${group.layout}`))
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

    new Setting(body)
      .setName(t('settings.group.baseFile.name'))
      .setDesc(t('settings.group.baseFile.desc'))
      .addToggle(toggle => toggle
        .setValue(group.autoCreateBaseFile)
        .onChange(async value => {
          group.autoCreateBaseFile = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.ensureBaseFile(group);
        }));

    let pendingBaseFolder = group.baseFolderPath;
    new Setting(body)
      .setName(t('settings.group.baseFolder.name'))
      .setDesc(t('settings.group.baseFolder.desc'))
      .addText(text => text
        .setPlaceholder(group.notesFolder)
        .setValue(group.baseFolderPath)
        .onChange(value => { pendingBaseFolder = value.trim(); }))
      .addButton(btn => btn
        .setButtonText(t('settings.group.baseFolder.move'))
        .onClick(() => { void (async () => {
          await this.plugin.basesCreator.move(group, group.baseFolderPath, pendingBaseFolder);
          group.baseFolderPath = pendingBaseFolder;
          await this.plugin.saveSettings();
          await this.plugin.ensureBaseFile(group);
          new Notice(t('notices.baseMoved'));
        })(); }));
  }

  private renderActions(body: HTMLElement, group: MappingGroup): void {
    new Setting(body)
      .setName(t('settings.group.backfill.name'))
      .setDesc(t('settings.group.backfill.desc'))
      .addButton(btn => btn
        .setButtonText(t('settings.group.backfill.run'))
        .setCta()
        .onClick(() => {
          void this.plugin.backfillManager.runForGroup(group, this.plugin.settings.groups);
        }));

    new Setting(body)
      .setName(t('settings.group.upgrade.name'))
      .setDesc(t('settings.group.upgrade.desc'))
      .addButton(btn => btn
        .setButtonText(t('settings.group.upgrade.run'))
        .onClick(() => {
          void this.plugin.upgradeManager.runForGroup(group);
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
