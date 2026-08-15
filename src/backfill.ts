import { App, Notice, TFile } from 'obsidian';
import { MappingGroup } from './types';
import { NoteManager } from './note-manager';
import { cleanFolder, groupForAttachment } from './paths';
import { t } from './i18n/i18n';

export interface BackfillResult {
  created: number;
  skipped: number;
}

export class BackfillManager {
  constructor(private app: App, private noteManager: NoteManager) {}

  attachmentsOf(group: MappingGroup, allGroups: MappingGroup[]): TFile[] {
    const folder = cleanFolder(group.attachmentsFolder);
    if (!folder) return [];
    return this.app.vault.getFiles().filter(file => {
      if (!file.path.startsWith(folder + '/')) return false;
      // Respect group precedence so a nested group does not steal files.
      return groupForAttachment(allGroups, file.path, file.extension)?.id === group.id;
    });
  }

  async runForGroup(group: MappingGroup, allGroups: MappingGroup[]): Promise<BackfillResult> {
    const files = this.attachmentsOf(group, allGroups);
    const total = files.length;

    if (total === 0) {
      new Notice(t('backfill.nothing', { group: group.name }));
      return { created: 0, skipped: 0 };
    }

    new Notice(t('backfill.starting', { total, group: group.name }));

    let created = 0;
    let skipped = 0;
    let processed = 0;

    for (let i = 0; i < files.length; i += 10) {
      const batch = files.slice(i, i + 10);

      await Promise.all(batch.map(async file => {
        if (this.noteManager.findNote(group, file.path)) {
          skipped++;
        } else {
          const note = await this.noteManager.createNote(file, group);
          if (note) created++; else skipped++;
        }
        processed++;
      }));

      if (processed % 50 === 0 && processed !== total) {
        new Notice(t('backfill.progress', { processed, total, created, skipped }));
      }
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }

    new Notice(t('backfill.complete', { created, skipped, group: group.name }));
    return { created, skipped };
  }

  async runForAll(groups: MappingGroup[]): Promise<void> {
    for (const group of groups) {
      await this.runForGroup(group, groups);
    }
  }
}
