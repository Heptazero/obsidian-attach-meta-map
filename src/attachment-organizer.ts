import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { AttMetaMapSettings } from './types';
import {
  AttachmentCandidate, AttachmentMovePlan, AttachmentPlanResult, planAttachmentMoves,
} from './attachment-rules';
import { OrganizerPreviewModal } from './organizer-modal';
import { t } from './i18n/i18n';

function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

function naturalPaths(files: TFile[]): TFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export class AttachmentOrganizer {
  private pendingMoves = new Set<string>();

  constructor(
    private app: App,
    private settings: () => AttMetaMapSettings,
  ) {}

  isPendingMove(oldPath: string): boolean {
    return this.pendingMoves.has(normalizePath(oldPath));
  }

  organizeAttachment(file: TFile): void {
    this.preview([{ path: file.path }]);
  }

  organizeNote(note: TFile): void {
    const links = this.app.metadataCache.resolvedLinks[note.path] ?? {};
    const candidates: AttachmentCandidate[] = [];
    for (const path of Object.keys(links)) {
      const linked = this.app.vault.getAbstractFileByPath(path);
      if (!(linked instanceof TFile) || linked.extension === 'md' || linked.extension === 'canvas') continue;
      candidates.push({ path: linked.path, noteBasename: note.basename });
    }
    this.preview(candidates);
  }

  organizeFolder(folder: TFolder, recursive: boolean): void {
    const prefix = folder.path ? `${folder.path}/` : '';
    const files = naturalPaths(this.app.vault.getFiles().filter(file => {
      if (file.extension === 'md' || file.extension === 'canvas') return false;
      if (recursive) return !folder.path || file.path.startsWith(prefix);
      return parentOf(file.path) === folder.path;
    }));
    this.preview(files.map(file => ({ path: file.path })));
  }

  private preview(candidates: AttachmentCandidate[]): void {
    if (candidates.length === 0) {
      new Notice(t('organizer.nothingFound'));
      return;
    }
    const result = planAttachmentMoves(
      candidates,
      this.settings().attachmentRules,
      this.settings().groups,
      this.app.vault.getFiles().map(file => file.path),
    );
    if (result.moves.length === 0) {
      new Notice(result.managed.length > 0
        ? t('organizer.onlyManaged', { count: result.managed.length })
        : t('organizer.nothingToChange'));
      return;
    }
    new OrganizerPreviewModal(
      this.app,
      result.moves,
      result.managed.length,
      result.unmatched.length,
      async () => this.apply(result),
    ).open();
  }

  private async apply(result: AttachmentPlanResult): Promise<void> {
    const resolved: { file: TFile; plan: AttachmentMovePlan; original: string; temp: string }[] = [];
    const moving = new Set(result.moves.map(move => move.from.toLowerCase()));

    for (let index = 0; index < result.moves.length; index++) {
      const plan = result.moves[index];
      const file = this.app.vault.getAbstractFileByPath(plan.from);
      if (!(file instanceof TFile)) {
        new Notice(t('organizer.changedSincePreview'));
        return;
      }
      const occupied = this.app.vault.getAbstractFileByPath(plan.to);
      if (occupied && !moving.has(plan.to.toLowerCase())) {
        new Notice(t('organizer.changedSincePreview'));
        return;
      }
      const parent = parentOf(plan.from);
      const tempName = `.amm-tmp-${Date.now()}-${index}-${file.name}`;
      const temp = normalizePath([parent, tempName].filter(Boolean).join('/'));
      if (this.app.vault.getAbstractFileByPath(temp)) {
        new Notice(t('organizer.changedSincePreview'));
        return;
      }
      resolved.push({ file, plan, original: plan.from, temp });
    }

    try {
      for (const item of resolved) await this.move(item.file, item.temp);
      for (const item of resolved) {
        const folder = parentOf(item.plan.to);
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        await this.move(item.file, item.plan.to);
      }
      new Notice(t('organizer.complete', { count: resolved.length }));
    } catch (error) {
      console.error('Att Meta Map: attachment organizer failed', error);
      await this.rollback(resolved);
      new Notice(t('organizer.failed'));
    }
  }

  private async move(file: TFile, to: string): Promise<void> {
    const oldPath = normalizePath(file.path);
    this.pendingMoves.add(oldPath);
    try {
      await this.app.fileManager.renameFile(file, normalizePath(to));
    } finally {
      this.pendingMoves.delete(oldPath);
    }
  }

  private async rollback(items: { file: TFile; original: string }[]): Promise<void> {
    const staged: { file: TFile; original: string; temp: string }[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.file.path === item.original) continue;
      const parent = parentOf(item.file.path);
      const temp = normalizePath([parent, `.amm-rollback-${Date.now()}-${index}-${item.file.name}`]
        .filter(Boolean).join('/'));
      try {
        await this.move(item.file, temp);
        staged.push({ ...item, temp });
      } catch (error) {
        console.error('Att Meta Map: could not stage attachment rollback', error);
      }
    }
    for (const item of staged) {
      try {
        const folder = parentOf(item.original);
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        await this.move(item.file, item.original);
      } catch (error) {
        console.error('Att Meta Map: could not restore attachment', item.original, error);
      }
    }
  }
}
