import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { AttMetaMapSettings, MappingGroup } from './types';
import { normalizeSettings } from './sources';
import { NoteManager } from './note-manager';
import { TemplateRegistry } from './template-registry';
import { BackfillManager } from './backfill';
import { BasesCreator } from './bases-creator';
import { PairOpener } from './pair-opener';
import { RefreshModal, buildDiffRows } from './refresh-modal';
import { AttMetaMapSettingTab } from './settings';
import { groupForAttachment } from './paths';
import { initI18n, t } from './i18n/i18n';

export default class AttMetaMapPlugin extends Plugin {
  settings: AttMetaMapSettings;
  registry: TemplateRegistry;
  noteManager: NoteManager;
  backfillManager: BackfillManager;
  basesCreator: BasesCreator;
  pairOpener: PairOpener;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.applyLanguage();

    this.registry = new TemplateRegistry(this.app, () => this.settings);
    this.noteManager = new NoteManager(this.app, () => this.settings, this.registry);
    this.backfillManager = new BackfillManager(this.app, this.noteManager);
    this.basesCreator = new BasesCreator(this.app);
    this.pairOpener = new PairOpener(this.app, this.noteManager);

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      void this.refreshBaseFiles();
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
      id: 'backfill-all',
      name: t('commands.backfill'),
      callback: () => { void this.backfillManager.runForAll(this.settings.groups); },
    });

    this.addSettingTab(new AttMetaMapSettingTab(this.app, this));
  }

  async applyLanguage(): Promise<void> {
    await initI18n(this.settings.language);
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
    if (!note || !pair.attachment) {
      new Notice(t('notices.noAttachment', { file: file.name }));
      return;
    }

    const resolvedNote = note;
    const frontmatter = this.app.metadataCache.getFileCache(resolvedNote)?.frontmatter;

    // The note's own properties are what can be refreshed; the template only
    // decides what a *new* note gets.
    const keys = Object.keys(frontmatter ?? {});
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

  async ensureBaseFile(group: MappingGroup): Promise<void> {
    const { template } = await this.noteManager.templateFor(group);
    await this.basesCreator.createOrUpdate(group, template.keys);
  }

  async refreshBaseFiles(): Promise<void> {
    for (const group of this.settings.groups) {
      await this.ensureBaseFile(group);
    }
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      const group = this.groupFor(file);
      if (!group?.autoCreateOnNew) return;
      // Give Obsidian a moment to finish writing the file before reading it.
      window.setTimeout(() => { void this.noteManager.createNote(file, group); }, 500);
    }));

    this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      const group = this.groupFor(file);
      if (!group?.autoDeleteOnRemove) return;
      void this.noteManager.deleteNote(group, file.path);
    }));

    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile)) return;
      const oldExt = (oldPath.split('/').pop() ?? '').split('.').pop() ?? '';
      const before = groupForAttachment(this.settings.groups, oldPath, oldExt);
      const after = this.groupFor(file);

      void (async () => {
        if (before && after && before.id === after.id) {
          await this.noteManager.renameNote(after, oldPath, file.path);
        } else {
          if (before?.autoDeleteOnRemove) await this.noteManager.deleteNote(before, oldPath);
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
