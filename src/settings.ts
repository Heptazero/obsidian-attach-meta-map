import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import type AttMetaMapPlugin from './main';
import { SOURCE_DEFS } from './sources';
import { createGroup, groupCreatesNotes } from './settings-model';
import { MappingGroup, SourceKind, UiLanguage } from './types';
import { FolderSuggest, PropertySuggest, TemplateFileSuggest } from './suggesters';
import { t } from './i18n/i18n';
import { AttachmentRuleSettings } from './attachment-rule-settings';

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

/** 'general' | 'mapping' | 'rules' | a group's id. */
type TabId = string;

export class AttMetaMapSettingTab extends PluginSettingTab {
  private activeTab: TabId = 'general';
  private tabButtons = new Map<TabId, HTMLButtonElement>();

  constructor(app: App, private plugin: AttMetaMapPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('amm-settings');
    this.plugin.registry.invalidate();

    this.renderTabBar(containerEl);
    const content = containerEl.createEl('div', { cls: 'amm-tab-content' });

    if (this.activeTab === 'general') {
      this.renderGeneral(content);
    } else if (this.activeTab === 'mapping') {
      this.renderMapping(content);
    } else if (this.activeTab === 'rules') {
      new AttachmentRuleSettings(this.app, this.plugin, () => this.redisplay()).render(content);
    } else {
      const group = this.plugin.settings.groups.find(g => g.id === this.activeTab);
      if (group) this.renderGroup(content, group);
      else { this.activeTab = 'general'; this.renderGeneral(content); }
    }
  }

  /** A settings change on the active tab: rebuild but keep the scroll spot. */
  private redisplay(): void {
    const top = this.containerEl.scrollTop;
    this.display();
    window.requestAnimationFrame(() => { this.containerEl.scrollTop = top; });
  }

  private switchTab(id: TabId): void {
    this.activeTab = id;
    this.display();
  }

  /** Renaming a group shouldn't rebuild the whole page and drop focus mid-keystroke. */
  private updateTabLabel(id: TabId, label: string): void {
    const btn = this.tabButtons.get(id);
    if (btn) btn.textContent = label;
  }

  // --- tab bar -------------------------------------------------------------

  private renderTabBar(containerEl: HTMLElement): void {
    const bar = containerEl.createEl('div', { cls: 'amm-tab-bar' });
    this.tabButtons.clear();

    const addTab = (id: TabId, label: string): void => {
      const btn = bar.createEl('button', {
        text: label,
        cls: 'amm-tab-btn' + (this.activeTab === id ? ' is-active' : ''),
      });
      btn.addEventListener('click', () => this.switchTab(id));
      this.tabButtons.set(id, btn);
    };

    addTab('general', t('settings.tabs.general'));
    addTab('mapping', t('settings.tabs.mapping'));
    addTab('rules', t('settings.tabs.rules'));
    for (const group of this.plugin.settings.groups) {
      addTab(group.id, group.name || t('settings.groups.newName'));
    }

    const addBtn = bar.createEl('button', {
      text: '+',
      cls: 'amm-tab-add',
      attr: { 'aria-label': t('settings.groups.add') },
    });
    addBtn.addEventListener('click', () => { void (async () => {
      const group = createGroup({ name: t('settings.groups.newName') });
      this.plugin.settings.groups.push(group);
      await this.plugin.saveSettings();
      this.switchTab(group.id);
    })(); });
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
          this.redisplay();
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

  // --- field mappings ----------------------------------------------------

  private renderMapping(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('settings.sections.mapping'))
      .setDesc(t('settings.mapping.desc'))
      .setHeading();

    for (const kind of KIND_ORDER) {
      const defs = SOURCE_DEFS.filter(def => def.kind === kind);
      if (defs.length === 0) continue;

      this.section(containerEl, t(`settings.kinds.${kind}`), false, sectionEl => {
        for (const def of defs) {
          new Setting(sectionEl)
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
      });
    }
  }

  // --- groups ------------------------------------------------------------

  /** A collapsible, titled subsection within a group's tab. */
  private section(body: HTMLElement, title: string, defaultOpen: boolean, render: (el: HTMLElement) => void): void {
    const details = body.createEl('details', { cls: 'amm-accordion' });
    if (defaultOpen) details.setAttr('open', '');
    details.createEl('summary', { text: title, cls: 'amm-accordion-summary' });
    render(details.createEl('div', { cls: 'amm-accordion-body' }));
  }

  private renderGroup(body: HTMLElement, group: MappingGroup): void {
    const createsNotes = groupCreatesNotes(group);
    new Setting(body)
      .setName(t('settings.group.name'))
      .addText(text => text
        .setValue(group.name)
        .onChange(async value => {
          group.name = value;
          await this.plugin.saveSettings();
          this.updateTabLabel(group.id, value || t('settings.groups.newName'));
        }))
      .addExtraButton(btn => btn
        .setIcon('trash')
        .setTooltip(t('settings.group.remove'))
        .onClick(() => { void (async () => {
          const ok = await confirmModal(this.app, t('settings.group.removeConfirm', { name: group.name }));
          if (!ok) return;
          this.plugin.settings.groups = this.plugin.settings.groups.filter(g => g.id !== group.id);
          await this.plugin.saveSettings();
          this.switchTab('general');
        })(); }));

    new Setting(body)
      .setName(t('settings.group.layout.name'))
      .setDesc(t(`settings.group.layout.desc.${group.layout}`))
      .addDropdown(drop => drop
        .addOption('sidecar', t('settings.group.layout.sidecar'))
        .addOption('folder', t('settings.group.layout.folder'))
        .setValue(group.layout)
        .onChange(async value => {
          const next = value === 'folder'
            ? createGroup({
              ...group,
              layout: 'folder',
              collectionFolder: group.layout === 'folder' ? group.collectionFolder : group.noteFolder,
            })
            : createGroup({
              ...group,
              layout: 'sidecar',
              resourceFolder: group.layout === 'sidecar' ? group.resourceFolder : group.collectionFolder,
              noteFolder: group.layout === 'sidecar' ? group.noteFolder : group.collectionFolder,
            });
          this.plugin.settings.groups = this.plugin.settings.groups.map(item =>
            item.id === group.id ? next : item);
          await this.plugin.saveSettings();
          this.redisplay();
        }));

    if (group.layout === 'folder') {
      new Setting(body)
        .setName(t('settings.group.createNoteFile.name'))
        .setDesc(t('settings.group.createNoteFile.desc'))
        .addToggle(toggle => toggle
          .setValue(group.createNoteFile)
          .onChange(async value => {
            group.createNoteFile = value;
            await this.plugin.saveSettings();
            this.redisplay();
          }));
    }

    if (group.layout === 'folder' && group.createNoteFile) {
      new Setting(body)
        .setName(t('settings.group.auxiliaryPrefix.name'))
        .setDesc(t('settings.group.auxiliaryPrefix.desc'))
        .addText(text => text
          .setPlaceholder(t('settings.group.auxiliaryPrefix.placeholder'))
          .setValue(group.auxiliaryPrefix)
          .onChange(async value => {
            group.auxiliaryPrefix = value.trim();
            await this.plugin.saveSettings();
          }));
    }

    this.section(body, t('settings.group.sections.paths'), true, el => {
      if (group.layout === 'folder') {
        new Setting(el)
          .setName(t('settings.group.collectionFolder.name'))
          .setDesc(t('settings.group.collectionFolder.desc'))
          .addText(text => {
            text
              .setPlaceholder('Library')
              .setValue(group.collectionFolder)
              .onChange(async value => {
                group.collectionFolder = value.trim();
                await this.plugin.saveSettings();
              });
            new FolderSuggest(this.app, text.inputEl, async value => {
              group.collectionFolder = value;
              await this.plugin.saveSettings();
            });
          });

        new Setting(el)
          .setName(t('settings.group.attachmentDepth.name'))
          .setDesc(t('settings.group.attachmentDepth.desc'))
          .addText(text => {
            text.inputEl.type = 'number';
            text.inputEl.min = '0';
            text.inputEl.step = '1';
            text.inputEl.addClass('amm-depth-input');
            text.setValue(String(group.attachmentDepth)).onChange(async value => {
              const parsed = Number.parseInt(value, 10);
              group.attachmentDepth = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
              await this.plugin.saveSettings();
            });
          });
      } else {
        new Setting(el)
          .setName(t('settings.group.resourceFolder.name'))
          .setDesc(t('settings.group.resourceFolder.desc'))
          .addText(text => {
            text
              .setPlaceholder('Attachments')
              .setValue(group.resourceFolder)
              .onChange(async value => {
                group.resourceFolder = value.trim();
                await this.plugin.saveSettings();
              });
            new FolderSuggest(this.app, text.inputEl, async value => {
              group.resourceFolder = value;
              await this.plugin.saveSettings();
            });
          });

        new Setting(el)
          .setName(t('settings.group.noteFolder.name'))
          .setDesc(t('settings.group.noteFolder.desc'))
          .addText(text => {
            text
              .setPlaceholder('Library')
              .setValue(group.noteFolder)
              .onChange(async value => {
                group.noteFolder = value.trim();
                await this.plugin.saveSettings();
              });
            new FolderSuggest(this.app, text.inputEl, async value => {
              group.noteFolder = value;
              await this.plugin.saveSettings();
            });
          });
      }

      new Setting(el)
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

      if (createsNotes) this.renderTemplatePicker(el, group);

      if (group.layout === 'sidecar') {
        new Setting(el)
          .setName(t('settings.group.mirror.name'))
          .setDesc(t('settings.group.mirror.desc'))
          .addToggle(toggle => toggle
            .setValue(group.mirrorFolderStructure)
            .onChange(async value => {
              group.mirrorFolderStructure = value;
              await this.plugin.saveSettings();
            }));
      }
    });

    this.section(body, t('settings.group.sections.naming'), false, el => {
      new Setting(el)
        .setName(t('settings.group.noteName.name'))
        .setDesc(t('settings.group.noteName.desc'))
        .addText(text => text
          .setPlaceholder('{{basename}}')
          .setValue(group.noteNameTemplate)
          .onChange(async value => {
            group.noteNameTemplate = value.trim() || '{{basename}}';
            await this.plugin.saveSettings();
          }));

      if (createsNotes) {
        new Setting(el)
          .setName(t('settings.group.linkTemplate.name'))
          .setDesc(t('settings.group.linkTemplate.desc'))
          .addText(text => text
            .setPlaceholder('[[{{name}}]]')
            .setValue(group.linkTemplate)
            .onChange(async value => {
              group.linkTemplate = value.trim() || '[[{{name}}]]';
              await this.plugin.saveSettings();
            }));

        new Setting(el)
          .setName(t('settings.group.embed.name'))
          .setDesc(t('settings.group.embed.desc'))
          .addToggle(toggle => toggle
            .setValue(group.embedAttachment)
            .onChange(async value => {
              group.embedAttachment = value;
              await this.plugin.saveSettings();
            }));
      }
    });

    this.section(body, t('settings.group.sections.automation'), false, el => this.renderBehavior(el, group));
    this.section(body, t('settings.group.sections.actions'), false, el => this.renderActions(el, group));
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

    if (!groupCreatesNotes(group)) return;

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

    if (!groupCreatesNotes(group)) return;

    new Setting(body)
      .setName(t('settings.group.upgrade.name'))
      .setDesc(t('settings.group.upgrade.desc'))
      .addButton(btn => btn
        .setButtonText(t('settings.group.upgrade.run'))
        .onClick(() => {
          void this.plugin.upgradeManager.runForGroup(group);
        }));
  }
}
