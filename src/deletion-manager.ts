import { App, EventRef, Notice, TFile, getFrontMatterInfo, parseYaml } from 'obsidian';
import type { AttMetaMapSettings } from './types';
import { groupForNote } from './paths';
import { groupCreatesNotes } from './settings-model';
import { removeSourceLinks, SOURCE_PROPERTY, sourceLinkTargets } from './resource-links';
import { DeletionNote, DeletionPlan, planDeletion } from './deletion-policy';
import { t } from './i18n/i18n';

interface CachedNote {
  file: TFile;
  links: { target: string; file: TFile | null }[];
  mtime: number;
  size: number;
}

interface FileStamp {
  file: TFile;
  path: string;
  mtime: number;
  size: number;
}

export class DeletionManager {
  private notes = new Map<TFile, CachedNote>();
  private pending = new Set<TFile>();
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private app: App,
    private settings: () => AttMetaMapSettings,
    private confirm: (plan: DeletionPlan) => Promise<boolean>,
  ) {}

  start(registerEvent: (event: EventRef) => void): void {
    this.refresh();
    registerEvent(this.app.metadataCache.on('changed', file => this.update(file)));
    registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
    registerEvent(this.app.vault.on('rename', () => this.refresh()));
    registerEvent(this.app.vault.on('delete', file => {
      if (file instanceof TFile) this.onDelete(file);
    }));
  }

  stop(): void {
    this.stopped = true;
    this.notes.clear();
  }

  private isLive(file: TFile): boolean {
    return this.app.vault.getFileByPath(file.path) === file;
  }

  private update(file: TFile): void {
    if (file.extension.toLowerCase() !== 'md' || !this.isLive(file)) return;
    const cache = this.app.metadataCache.getFileCache(file);
    // A temporarily unavailable cache must not erase the last known binding.
    if (!cache) return;
    const previous = this.notes.get(file);
    const value: unknown = cache.frontmatter?.[SOURCE_PROPERTY];
    const links = sourceLinkTargets(value).map(target => {
      const resolved = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
      const resource = resolved && !['md', 'canvas'].includes(resolved.extension.toLowerCase())
        ? resolved : null;
      // Keep proven identity after a resource disappears; do not rebind a
      // short link to a different same-named resource after the deletion.
      const old = previous?.links.find(link => link.target === target)?.file;
      return { target, file: old && !this.isLive(old) && resource?.path !== old.path ? old : resource };
    });
    this.notes.set(file, { file, links, mtime: file.stat.mtime, size: file.stat.size });
  }

  private refresh(): void {
    for (const file of this.app.vault.getMarkdownFiles()) this.update(file);
    // Deleted notes are removed by onDelete, which first captures their links.
  }

  private snapshot(note: CachedNote): DeletionNote {
    const group = groupForNote(this.settings().groups, note.file.path);
    return {
      path: note.file.path,
      managed: Boolean(group && groupCreatesNotes(group)),
      links: note.links.map(link => ({ target: link.target, path: link.file?.path ?? null })),
    };
  }

  /** Capture cached identity synchronously, before metadata for a deleted note is discarded. */
  onDelete(file: TFile): void {
    const origin = file.path;
    const cached = this.notes.get(file);
    const deletedNote = cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size
      ? this.snapshot(cached) : undefined;
    if (deletedNote) {
      deletedNote.links = (cached?.links ?? []).map(link => ({
        target: link.target, path: link.file && this.isLive(link.file) ? link.file.path : null,
      }));
    }
    this.notes.delete(file);
    if (this.pending.has(file) || this.stopped || file.extension.toLowerCase() === 'canvas') return;
    const direction = file.extension.toLowerCase() === 'md' ? 'noteToResources' : 'resourceToNote';
    if (!this.settings().deletion[direction]) return;
    const originalResources = new Map((cached?.links ?? []).flatMap(link => link.file
      ? [[link.file.path, { file: link.file, path: link.file.path,
        mtime: link.file.stat.mtime, size: link.file.stat.size }] as const] : []));
    this.queue = this.queue.then(() => this.process(origin, direction, deletedNote, originalResources))
      .catch((error: unknown) => {
        console.error('[Att Meta Map] Linked deletion failed', error);
        new Notice(t('deletion.failed'));
      });
  }

  /** Wait for queued work; also useful for deterministic event tests. */
  async settled(): Promise<void> {
    await this.queue;
  }

  private plan(origin: string, direction: DeletionPlan['direction'], deletedNote?: DeletionNote): DeletionPlan {
    this.refresh();
    const live = [...this.notes.values()].filter(note => this.isLive(note.file)).map(note => this.snapshot(note));
    const group = groupForNote(this.settings().groups, origin);
    const eligible = deletedNote && { ...deletedNote, managed: Boolean(group && groupCreatesNotes(group)) };
    return planDeletion(origin, direction, live, eligible);
  }

  private async process(
    origin: string, direction: DeletionPlan['direction'], deletedNote: DeletionNote | undefined,
    originalResources: Map<string, FileStamp>,
  ): Promise<void> {
    if (this.stopped || !this.settings().deletion[direction] || this.app.vault.getFileByPath(origin)) return;
    const plan = this.plan(origin, direction, deletedNote);
    if (plan.changes.length === 0) return;
    const stamps: FileStamp[] = [];
    for (const change of plan.changes) {
      const file = this.app.vault.getFileByPath(change.path);
      if (!file) return;
      if (direction === 'noteToResources') {
        const original = originalResources.get(change.path);
        if (!original || !this.unchanged(original)) {
          new Notice(t('deletion.changed'));
          return;
        }
      }
      stamps.push({ file, path: file.path, mtime: file.stat.mtime, size: file.stat.size });
    }
    if (!await this.verifySources(plan)) {
      new Notice(t('deletion.changed'));
      return;
    }
    if (this.settings().deletion.confirm && !await this.confirm(plan)) return;
    if (this.stopped || !this.settings().deletion[direction] || this.app.vault.getFileByPath(origin)) return;
    const fresh = this.plan(origin, direction, deletedNote);
    if (JSON.stringify(fresh) !== JSON.stringify(plan) || !await this.verifySources(plan) ||
      !stamps.every(stamp => this.unchanged(stamp))) {
      new Notice(t('deletion.changed'));
      return;
    }
    for (let i = 0; i < plan.changes.length; i++) {
      const change = plan.changes[i];
      const stamp = stamps[i];
      if (this.stopped || !this.settings().deletion[direction] || this.app.vault.getFileByPath(origin) || !this.unchanged(stamp)) {
        new Notice(t('deletion.changed'));
        return;
      }
      // Recheck references after each asynchronous trash operation.
      if (direction === 'noteToResources') {
        this.refresh();
        if (await this.hasOwner(stamp.file)) {
          new Notice(t('deletion.changed'));
          return;
        }
      }
      if (this.stopped || !this.settings().deletion[direction] ||
        this.app.vault.getFileByPath(origin) || !this.unchanged(stamp)) {
        new Notice(t('deletion.changed'));
        return;
      }
      if (change.kind === 'trash') {
        this.pending.add(stamp.file);
        try {
          await this.app.fileManager.trashFile(stamp.file);
        } finally {
          this.pending.delete(stamp.file);
        }
      } else {
        await this.app.fileManager.processFrontMatter(stamp.file, (frontmatter: Record<string, unknown>) => {
          const expected = this.notes.get(stamp.file)?.links.map(link => link.target) ?? [];
          if (JSON.stringify(sourceLinkTargets(frontmatter[SOURCE_PROPERTY])) !== JSON.stringify(expected)) {
            throw new Error('Source changed before unlink');
          }
          const remaining = removeSourceLinks(frontmatter[SOURCE_PROPERTY], change.targets);
          if (remaining === undefined) delete frontmatter[SOURCE_PROPERTY];
          else frontmatter[SOURCE_PROPERTY] = remaining;
        });
        this.update(stamp.file);
      }
    }
    new Notice(t('deletion.complete', { count: plan.changes.length }));
  }

  private unchanged(stamp: FileStamp): boolean {
    return this.app.vault.getFileByPath(stamp.path) === stamp.file && stamp.file.path === stamp.path &&
      stamp.file.stat.mtime === stamp.mtime && stamp.file.stat.size === stamp.size;
  }

  private async diskTargets(file: TFile): Promise<string[]> {
    const info = getFrontMatterInfo(await this.app.vault.read(file));
    if (!info.exists) return [];
    const value: unknown = parseYaml(info.frontmatter);
    const source = value && typeof value === 'object'
      ? (value as Record<string, unknown>)[SOURCE_PROPERTY] : undefined;
    return sourceLinkTargets(source);
  }

  private async hasOwner(resource: TFile): Promise<boolean> {
    for (const note of this.app.vault.getMarkdownFiles()) {
      const targets = await this.diskTargets(note);
      if (targets.some(target => this.app.metadataCache.getFirstLinkpathDest(target, note.path) === resource)) {
        return true;
      }
    }
    return false;
  }

  private async verifySources(plan: DeletionPlan): Promise<boolean> {
    for (const change of plan.changes) {
      const file = this.app.vault.getFileByPath(change.path);
      if (!file) return false;
      if (plan.direction === 'noteToResources') {
        if (await this.hasOwner(file)) return false;
      } else {
        const expected = this.notes.get(file)?.links.map(link => link.target) ?? [];
        if (JSON.stringify(await this.diskTargets(file)) !== JSON.stringify(expected)) return false;
      }
    }
    return true;
  }
}
