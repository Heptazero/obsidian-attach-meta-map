import { App, Notice, TFile } from 'obsidian';
import { MappingGroup } from './types';
import { NoteManager } from './note-manager';
import { cleanFolder } from './paths';
import { t } from './i18n/i18n';

export interface UpgradeResult {
  notesUpdated: number;
  propertiesAdded: number;
}

/** Batch version of NoteManager.upgradeNote — every existing note in a group, not just missing ones. */
export class UpgradeManager {
  constructor(private app: App, private noteManager: NoteManager) {}

  notesOf(group: MappingGroup): TFile[] {
    const folder = cleanFolder(group.notesFolder);
    if (!folder) return [];
    return this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/'));
  }

  async runForGroup(group: MappingGroup): Promise<UpgradeResult> {
    const notes = this.notesOf(group);
    const total = notes.length;

    if (total === 0) {
      new Notice(t('upgrade.nothing', { group: group.name }));
      return { notesUpdated: 0, propertiesAdded: 0 };
    }

    new Notice(t('upgrade.starting', { total, group: group.name }));

    let notesUpdated = 0;
    let propertiesAdded = 0;
    let processed = 0;

    for (let i = 0; i < notes.length; i += 10) {
      const batch = notes.slice(i, i + 10);

      await Promise.all(batch.map(async note => {
        const count = await this.noteManager.upgradeNote(note, group);
        if (count > 0) { notesUpdated++; propertiesAdded += count; }
        processed++;
      }));

      if (processed % 50 === 0 && processed !== total) {
        new Notice(t('upgrade.progress', { processed, total, notesUpdated, propertiesAdded }));
      }
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }

    new Notice(t('upgrade.complete', { notesUpdated, propertiesAdded, group: group.name }));
    return { notesUpdated, propertiesAdded };
  }
}
