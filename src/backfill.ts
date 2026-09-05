import { App, Notice, TFile } from 'obsidian';
import { MappingGroup } from './types';
import { NoteManager } from './note-manager';
import type { CreatePlan } from './creation-plan';
import { groupForAttachment, resourceRoot } from './paths';
import { t } from './i18n/i18n';
import { BackfillPreviewModal } from './backfill-modal';

export interface BackfillResult {
  created: number;
  skipped: number;
}

export class BackfillManager {
  constructor(private app: App, private noteManager: NoteManager) {}

  attachmentsOf(group: MappingGroup, allGroups: MappingGroup[]): TFile[] {
    const folder = resourceRoot(group);
    if (!folder) return [];
    return this.app.vault.getFiles().filter(file => {
      if (!file.path.startsWith(folder + '/')) return false;
      // Respect group precedence so a nested group does not steal files.
      return groupForAttachment(allGroups, file.path, file.extension)?.id === group.id;
    });
  }

  plansFor(groups: MappingGroup[], allGroups: MappingGroup[]): CreatePlan[] {
    return groups.flatMap(group => this.attachmentsOf(group, allGroups)
      .map(file => this.noteManager.planCreate(file, group))
      .filter((plan): plan is CreatePlan => plan !== null));
  }

  async runForGroup(group: MappingGroup, allGroups: MappingGroup[]): Promise<BackfillResult> {
    return this.previewAndRun([group], allGroups);
  }

  private async previewAndRun(
    groups: MappingGroup[], allGroups: MappingGroup[],
  ): Promise<BackfillResult> {
    const plans = this.plansFor(groups, allGroups);
    if (plans.length === 0) {
      new Notice(t('backfill.nothingToChange'));
      return { created: 0, skipped: 0 };
    }

    return new Promise(resolve => {
      new BackfillPreviewModal(this.app, plans, async () => {
        resolve(await this.apply(plans));
      }, () => resolve({ created: 0, skipped: 0 })).open();
    });
  }

  private async apply(plans: CreatePlan[]): Promise<BackfillResult> {
    const total = plans.length;
    new Notice(t('backfill.starting', { total }));

    let created = 0;
    let skipped = 0;
    let processed = 0;

    for (let i = 0; i < plans.length; i += 10) {
      const batch = plans.slice(i, i + 10);
      // Filesystem mutations are deliberately sequential. Two resources may
      // target the same generated name; applying in parallel would turn a
      // predictable collision into a rename race.
      for (const plan of batch) {
        try {
          await this.noteManager.applyCreatePlan(plan);
          created++;
        } catch {
          skipped++;
        }
        processed++;
      }

      if (processed % 50 === 0 && processed !== total) {
        new Notice(t('backfill.progress', { processed, total, created, skipped }));
      }
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }

    new Notice(t('backfill.complete', { created, skipped }));
    return { created, skipped };
  }

  async runForAll(groups: MappingGroup[]): Promise<void> {
    await this.previewAndRun(groups, groups);
  }
}
