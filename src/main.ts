import { Notice, Plugin, TAbstractFile, TFile, TFolder } from 'obsidian';
import { AttMetaMapSettings, MappingGroup } from './types';
import { normalizeSettings } from './sources';
import { NoteManager } from './note-manager';
import { TemplateRegistry } from './template-registry';
import { BackfillManager } from './backfill';
import { UpgradeManager } from './upgrade';
import { PairOpener } from './pair-opener';
import { RefreshModal, buildDiffRows } from './refresh-modal';
import { UnbindModal } from './unbind-modal';
import { AttMetaMapSettingTab } from './settings';
import { groupForAttachment } from './paths';
import { initI18n, t } from './i18n/i18n';
import { RESOURCE_RELATIONS_VIEW, ResourceRelationsView } from './relations-view';
import { AttachmentOrganizer } from './attachment-organizer';

export default class AttMetaMapPlugin extends Plugin {
  settings: AttMetaMapSettings;
  registry: TemplateRegistry;
  noteManager: NoteManager;
  backfillManager: BackfillManager;
  upgradeManager: UpgradeManager;
  pairOpener: PairOpener;
  attachmentOrganizer: AttachmentOrganizer;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.applyLanguage();

    this.registry = new TemplateRegistry(this.app, () => this.settings);
    this.noteManager = new NoteManager(this.app, () => this.settings, this.registry);
    this.backfillManager = new BackfillManager(this.app, this.noteManager);
    this.upgradeManager = new UpgradeManager(this.app, this.noteManager);
    this.pairOpener = new PairOpener(this.app, this.noteManager);
    this.attachmentOrganizer = new AttachmentOrganizer(this.app, () => this.settings);

    this.registerView(RESOURCE_RELATIONS_VIEW, leaf => new ResourceRelationsView(
      leaf,
      this.noteManager,
      () => this.settings.groups,
      (context, target) => this.openUnbind(
        context.note,
        context.relations.map(relation => relation.target),
        [target],
      ),
    ));

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
    });

    this.addCommand({
      id: 'open-pair',
      name: t('commands.openPair'),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return this.pairOpener.resolvePair(file, this.settings.groups) !== null;
        void this.pairOpener.openPair(file, this.settings.groups);
        return true;
      },
    });

    this.addCommand({
      id: 'refresh-metadata',
      name: t('commands.refreshMetadata'),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return this.pairOpener.resolvePair(file, this.settings.groups) !== null;
        void this.refreshMetadata(file);
        return true;
      },
    });

    this.addCommand({
      id: 'unbind-source',
      name: t('commands.unbindSource'),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const context = this.noteManager.resolveUnbindContext(file, this.settings.groups);
        if (!context) return false;
        if (checking) return true;

        this.openUnbind(context.note, context.targets, context.preselected);
        return true;
      },
    });

    this.addCommand({
      id: 'open-relations-panel',
      name: t('commands.openRelationsPanel'),
      callback: () => { void this.openRelationsPanel(); },
    });
    this.addRibbonIcon('links', t('commands.openRelationsPanel'), () => {
      void this.openRelationsPanel();
    });

    this.addCommand({
      id: 'backfill-all',
      name: t('commands.backfill'),
      callback: () => { void this.backfillManager.runForAll(this.settings.groups); },
    });

    this.addCommand({
      id: 'organize-active-note-attachments',
      name: t('commands.organizeActiveNoteAttachments'),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.attachmentOrganizer.organizeNote(file);
        return true;
      },
    });

    this.registerOrganizerMenus();

    this.addSettingTab(new AttMetaMapSettingTab(this.app, this));
  }

  async applyLanguage(): Promise<void> {
    await initI18n(this.settings.language);
  }

  private openUnbind(note: TFile, targets: string[], preselected: string[]): void {
    new UnbindModal(
      this.app, note, targets, preselected,
      async selected => {
        const count = await this.noteManager.unbindSources(note, selected);
        new Notice(t('notices.unbound', { count }));
      },
    ).open();
  }

  private async openRelationsPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(RESOURCE_RELATIONS_VIEW);
    const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: RESOURCE_RELATIONS_VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private registerOrganizerMenus(): void {
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile) {
        if (file.extension === 'md') {
          menu.addItem(item => item
            .setTitle(t('commands.organizeNoteAttachments'))
            .setIcon('folder-input')
            .onClick(() => this.attachmentOrganizer.organizeNote(file)));
        } else if (file.extension !== 'canvas') {
          menu.addItem(item => item
            .setTitle(t('commands.organizeAttachment'))
            .setIcon('folder-input')
            .onClick(() => this.attachmentOrganizer.organizeAttachment(file)));
        }
      } else if (file instanceof TFolder) {
        menu.addItem(item => item
          .setTitle(t('commands.organizeFolder'))
          .setIcon('folder-input')
          .onClick(() => this.attachmentOrganizer.organizeFolder(file, false)));
        menu.addItem(item => item
          .setTitle(t('commands.organizeFolderRecursive'))
          .setIcon('folders')
          .onClick(() => this.attachmentOrganizer.organizeFolder(file, true)));
      }
    }));
  }

  /** Re-extract, then let the user pick a side per property. */
  async refreshMetadata(file: TFile): Promise<void> {
    const pair = this.pairOpener.resolvePair(file, this.settings.groups);
    if (!pair) {
      new Notice(t('notices.noGroup', { file: file.name }));
      return;
    }

    let note = pair.note;
    if (!note && pair.attachment) {
      note = await this.noteManager.createNote(pair.attachment, pair.group);
      if (note) {
        new Notice(t('notices.noteReady', { note: note.basename }));
        return;
      }
    }
    if (!pair.attachment) {
      new Notice(t('notices.noAttachment', { file: file.name }));
      return;
    }
    if (!note) {
      new Notice(t('notices.noNote', { group: pair.group.name }));
      return;
    }

    const resolvedNote = note;
    const frontmatter = this.app.metadataCache.getFileCache(resolvedNote)?.frontmatter;

    // Compare against the note's own properties *and* whatever the group's
    // current template calls for — an old note missing a key the template
    // now has shows up as a row too, not just properties it already carries.
    const { template } = await this.noteManager.templateFor(pair.group);
    const keys = Array.from(new Set([...Object.keys(frontmatter ?? {}), ...template.keys]));
    if (keys.length === 0) {
      new Notice(t('notices.noProperties', { note: resolvedNote.basename }));
      return;
    }

    const rows = await this.noteManager.resolveFor(
      pair.attachment, pair.group, keys, { keepEmpty: true },
    );
    const diff = buildDiffRows(rows, frontmatter);

    new RefreshModal(this.app, resolvedNote, diff, async accepted => {
      if (accepted.length === 0) {
        new Notice(t('notices.nothingApplied'));
        return;
      }
      for (const row of accepted) {
        await this.noteManager.setProperty(resolvedNote, row.property, row.incoming);
      }
      new Notice(t('notices.applied', { count: accepted.length }));
    }).open();
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      const group = this.groupFor(file);
      if (!group?.autoCreateOnNew) return;
      // Give Obsidian a moment to finish writing the file before reading it.
      window.setTimeout(() => { void this.noteManager.createNote(file, group); }, 500);
    }));

    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile)) return;
      // Folder-layout createNote moves the attachment itself, which fires
      // this same event — ignore it, or the handler below would see the
      // resource moving within its collection and disturb the note just created.
      if (this.noteManager.isPendingMove(oldPath) || this.attachmentOrganizer.isPendingMove(oldPath)) return;
      const oldExt = (oldPath.split('/').pop() ?? '').split('.').pop() ?? '';
      const before = groupForAttachment(this.settings.groups, oldPath, oldExt);
      const after = this.groupFor(file);

      void (async () => {
        if (before && after && before.id === after.id) {
          await this.noteManager.renameNote(after, oldPath, file.path);
        } else {
          if (after?.autoCreateOnNew) await this.noteManager.createNote(file, after);
        }
      })();
    }));

    this.registerEvent(this.app.vault.on('modify', (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      const group = this.groupFor(file);
      if (!group?.syncUpdatedOnModify) return;
      void this.noteManager.touchUpdated(file, group);
    }));

    // Templates change; the suggestion list should not go stale.
    this.registerEvent(this.app.metadataCache.on('changed', () => this.registry.invalidate()));
  }

  private groupFor(file: TFile): MappingGroup | null {
    return groupForAttachment(this.settings.groups, file.path, file.extension);
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
