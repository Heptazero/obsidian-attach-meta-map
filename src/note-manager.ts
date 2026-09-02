import { App, Notice, TFile, normalizePath } from 'obsidian';
import { AttMetaMapSettings, MappingGroup, SourceValues } from './types';
import { BUILTIN_TEMPLATE_KEYS, FieldValue, ResolvedField, resolveFields } from './sources';
import {
  cleanFolder, folderItemCandidates, isFolderItemPath, isInFolder, linkFor,
  normalizeForMatch, notePathCandidates, templateVars,
} from './paths';
import { ParsedTemplate, RenderedNote, builtinTemplate, renderNote } from './template';
import { TemplateRegistry } from './template-registry';
import { autoFillableRows, buildDiffRows } from './refresh-modal';
import {
  EMPTY_LOOKUP, EMPTY_PDF_METADATA, LookupResult, PdfMetadataExtractor,
  lookupDoi, lookupIsbn,
} from './pdf-extractor';
import { t } from './i18n/i18n';
import {
  appendSourceLink, removeSourceLinks, SOURCE_PROPERTY, sourceLinkTargets, stripAuxiliaryPrefix,
} from './resource-links';

const toDate = (ms: number): string => new Date(ms).toISOString().split('T')[0];

export type CreateChange =
  | { kind: 'move'; from: string; to: string }
  | { kind: 'create-note'; path: string }
  | { kind: 'update-source'; notePath: string; link: string };

export interface CreatePlan {
  attachment: TFile;
  group: MappingGroup;
  mode: 'create' | 'auxiliary' | 'repair-source';
  changes: CreateChange[];
  note?: TFile;
}

export interface UnbindContext {
  note: TFile;
  targets: string[];
  preselected: string[];
}

export interface SourceRelation {
  target: string;
  file: TFile | null;
}

export interface RelationContext {
  note: TFile;
  relations: SourceRelation[];
}

export class NoteManager {
  private pdfExtractor: PdfMetadataExtractor;

  /**
   * Attachment paths this manager is mid-move for (folder layout only). The
   * move itself fires a vault 'rename' event; main.ts checks this before
   * reacting, so the plugin's own listener does not treat its own move as a
   * user rename and try to "fix" the note it just created.
   */
  private pendingMoves = new Set<string>();

  constructor(
    private app: App,
    private settings: () => AttMetaMapSettings,
    private registry: TemplateRegistry,
  ) {
    this.pdfExtractor = new PdfMetadataExtractor(app);
  }

  isPendingMove(path: string): boolean {
    return this.pendingMoves.has(normalizePath(path));
  }

  // --- mapping -----------------------------------------------------------

  linkFor(group: MappingGroup, attachmentPath: string): string {
    return linkFor(group, attachmentPath);
  }

  /** The property a source writes to, or null when it is not mapped. */
  propertyOf(sourceId: string): string | null {
    return this.settings().mapping[sourceId]?.trim() || null;
  }

  private filesFromProperty(note: TFile, property: string): TFile[] {
    const value: unknown = this.app.metadataCache.getFileCache(note)?.frontmatter?.[property];
    const files: TFile[] = [];
    for (const target of sourceLinkTargets(value)) {
      const file = this.app.metadataCache.getFirstLinkpathDest(target, note.path);
      if (file && !files.some(existing => existing.path === file.path)) files.push(file);
    }
    return files;
  }

  /** Canonical resources, in source-property order; the first is primary. */
  sourceFiles(note: TFile): TFile[] {
    return this.filesFromProperty(note, SOURCE_PROPERTY);
  }

  sourceTargets(note: TFile): string[] {
    const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
    return sourceLinkTargets(frontmatter?.[SOURCE_PROPERTY]);
  }

  sourceRelations(note: TFile): SourceRelation[] {
    return this.sourceTargets(note).map(target => ({
      target,
      file: this.app.metadataCache.getFirstLinkpathDest(target, note.path),
    }));
  }

  private sourceTargetsForAttachment(note: TFile, attachmentPath: string): string[] {
    const normalized = normalizePath(attachmentPath);
    return this.sourceTargets(note).filter(target => {
      const file = this.app.metadataCache.getFirstLinkpathDest(target, note.path);
      return Boolean(file && normalizePath(file.path) === normalized);
    });
  }

  /** Canonical source first, followed by old configurable/attachment fields. */
  private linkedResourceFiles(note: TFile): TFile[] {
    const properties = [SOURCE_PROPERTY, this.propertyOf('link'), 'attachment']
      .filter((property): property is string => Boolean(property));
    const files: TFile[] = [];
    for (const property of new Set(properties)) {
      for (const file of this.filesFromProperty(note, property)) {
        if (!files.some(existing => existing.path === file.path)) files.push(file);
      }
    }
    return files;
  }

  private noteReferences(note: TFile, attachmentPath: string): boolean {
    const normalized = normalizePath(attachmentPath);
    const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
    const canonical = sourceLinkTargets(frontmatter?.[SOURCE_PROPERTY]);
    const files = canonical.length > 0 ? this.sourceFiles(note) : this.linkedResourceFiles(note);
    return files.some(file => normalizePath(file.path) === normalized);
  }

  private noteHasSourceLink(note: TFile, link: string): boolean {
    const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
    const target = sourceLinkTargets(link)[0];
    return Boolean(target && sourceLinkTargets(frontmatter?.[SOURCE_PROPERTY]).includes(target));
  }

  private findNoteBySourceInGroup(group: MappingGroup, attachmentPath: string): TFile | null {
    const notesFolder = cleanFolder(group.notesFolder);
    if (!notesFolder) return null;
    return this.app.vault.getMarkdownFiles().find(note =>
      isInFolder(note.path, notesFolder) && this.noteReferences(note, attachmentPath),
    ) ?? null;
  }

  /** Reverse source lookup works even when the resource is outside attachmentsFolder. */
  findNoteBySource(
    groups: MappingGroup[], attachmentPath: string,
  ): { group: MappingGroup; note: TFile } | null {
    const ordered = [...groups].sort((a, b) => cleanFolder(b.notesFolder).length - cleanFolder(a.notesFolder).length);
    for (const group of ordered) {
      const note = this.findNoteBySourceInGroup(group, attachmentPath);
      if (note) return { group, note };
    }
    return null;
  }

  /** An existing relation is valid only when the note's source resolves to the resource. */
  findNote(group: MappingGroup, attachmentPath: string): TFile | null {
    return this.findNoteBySourceInGroup(group, attachmentPath);
  }

  targetNotePath(group: MappingGroup, attachmentPath: string): string {
    const { primary, fallback } = notePathCandidates(group, attachmentPath);
    const existing = this.app.vault.getFileByPath(normalizePath(primary));
    if (!existing) return normalizePath(primary);
    if (this.notePointsAt(existing, group, attachmentPath) === 'yes') return normalizePath(primary);
    return normalizePath(fallback);
  }

  findAttachment(group: MappingGroup, note: TFile): TFile | null {
    void group;
    return this.sourceFiles(note)[0] ?? null;
  }

  resolveUnbindContext(file: TFile, groups: MappingGroup[]): UnbindContext | null {
    if (file.extension === 'md') {
      const targets = this.sourceTargets(file);
      if (targets.length === 0) return null;
      return { note: file, targets, preselected: targets.length === 1 ? targets : [] };
    }

    const linked = this.findNoteBySource(groups, file.path);
    if (!linked) return null;
    const targets = this.sourceTargets(linked.note);
    const preselected = this.sourceTargetsForAttachment(linked.note, file.path);
    if (preselected.length === 0) return null;
    return { note: linked.note, targets, preselected };
  }

  resolveRelationContext(file: TFile, groups: MappingGroup[]): RelationContext | null {
    const note = file.extension === 'md'
      ? file
      : this.findNoteBySource(groups, file.path)?.note;
    if (!note) return null;
    const relations = this.sourceRelations(note);
    return relations.length > 0 ? { note, relations } : null;
  }

  async unbindSources(note: TFile, targets: string[]): Promise<number> {
    const selected = new Set(targets);
    const before = this.sourceTargets(note);
    const removed = before.filter(target => selected.has(target)).length;
    if (removed === 0) return 0;

    await this.app.fileManager.processFrontMatter(note, (frontmatter: Record<string, unknown>) => {
      const remaining = removeSourceLinks(frontmatter[SOURCE_PROPERTY], targets);
      if (remaining === undefined) delete frontmatter[SOURCE_PROPERTY];
      else frontmatter[SOURCE_PROPERTY] = remaining;
    });
    return removed;
  }

  private notePointsAt(
    note: TFile, group: MappingGroup, attachmentPath: string,
  ): 'yes' | 'no' | 'unknown' {
    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
    if (!fm) return 'unknown';

    const sourceTargets = sourceLinkTargets(fm[SOURCE_PROPERTY]);
    if (sourceTargets.length > 0) {
      const normalized = normalizePath(attachmentPath);
      return this.sourceFiles(note).some(file => normalizePath(file.path) === normalized) ? 'yes' : 'no';
    }

    const pathProp = this.propertyOf('path');
    const recordedPath: unknown = pathProp ? fm[pathProp] : undefined;
    if (typeof recordedPath === 'string' && recordedPath.trim()) {
      return normalizePath(recordedPath.trim()) === normalizePath(attachmentPath) ? 'yes' : 'no';
    }

    const linkProp = this.propertyOf('link');
    const recordedLink: unknown = linkProp ? fm[linkProp] : undefined;
    if (typeof recordedLink === 'string' && recordedLink.trim()) {
      return recordedLink.trim() === this.linkFor(group, attachmentPath) ? 'yes' : 'no';
    }

    return 'unknown';
  }

  // --- template ----------------------------------------------------------

  /** The group's template, or a built-in key list when none is configured. */
  async templateFor(group: MappingGroup): Promise<{ template: ParsedTemplate; builtin: boolean }> {
    const path = group.templatePath.trim();
    if (path) {
      const parsed = await this.registry.parse(path);
      if (parsed) return { template: parsed, builtin: false };
      new Notice(t('notices.templateMissing', { path, group: group.name }));
    }
    return { template: builtinTemplate(BUILTIN_TEMPLATE_KEYS), builtin: true };
  }

  private renderNewNote(
    template: ParsedTemplate, rows: ResolvedField[], group: MappingGroup,
    attachment: TFile, embed: string, builtin: boolean,
  ): RenderedNote {
    const withSource = template.keys.includes(SOURCE_PROPERTY) ? template : {
      ...template,
      frontmatterLines: [`${SOURCE_PROPERTY}:`, ...template.frontmatterLines],
      keys: [SOURCE_PROPERTY, ...template.keys],
    };
    const sourceRow: ResolvedField = {
      id: SOURCE_PROPERTY,
      property: SOURCE_PROPERTY,
      kind: 'vault',
      value: this.linkFor(group, attachment.path),
    };
    return renderNote(withSource, [sourceRow, ...rows], embed, { dropUnfilledKeys: builtin });
  }

  // --- metadata ----------------------------------------------------------

  async gather(file: TFile, group: MappingGroup): Promise<SourceValues> {
    const parsed = templateVars(file.path);
    const values: SourceValues = {
      path: file.path,
      fileName: file.name,
      basename: file.basename,
      fileType: file.extension,
      fileSize: file.stat.size,
      fileCreated: toDate(file.stat.ctime),
      fileUpdated: toDate(file.stat.mtime),
      fileNameYear: parsed.year,
      fileNameTitle: parsed.title,
      pdfTitle: file.basename,
      pdfAuthor: '', pdfSubject: '', pdfKeywords: [],
      pdfCreated: '', pdfModified: '', pdfCreator: '', pdfProducer: '',
      pdfPages: null,
      doi: '', isbn: '', lookupTitle: '', lookupAuthor: '', lookupYear: '',
    };

    const isPdf = file.extension.toLowerCase() === 'pdf';
    if (!isPdf || !group.enablePdfMetadataExtraction) return values;

    const meta = await this.pdfExtractor.extract(file).catch(() => ({ ...EMPTY_PDF_METADATA }));
    values.pdfTitle = meta.title || file.basename;
    values.pdfAuthor = meta.author;
    values.pdfSubject = meta.subject;
    values.pdfKeywords = meta.keywords;
    values.pdfCreated = meta.creationDate ?? '';
    values.pdfModified = meta.modificationDate ?? '';
    values.pdfCreator = meta.creator;
    values.pdfProducer = meta.producer;
    values.pdfPages = meta.pageCount;

    if (group.enableDoiIsbnLookup) {
      const { doi, isbn } = await this.pdfExtractor.findIdentifiers(file, meta);
      values.doi = doi;
      values.isbn = isbn;

      let result: LookupResult = { ...EMPTY_LOOKUP };
      if (doi) result = await lookupDoi(doi);
      else if (isbn) result = await lookupIsbn(isbn);

      values.lookupTitle = result.title;
      values.lookupAuthor = result.author;
      values.lookupYear = result.year;
    }

    return values;
  }

  async resolveFor(
    file: TFile, group: MappingGroup, keys: string[], options: { keepEmpty?: boolean } = {},
  ): Promise<ResolvedField[]> {
    const values = await this.gather(file, group);
    return resolveFields(this.settings().mapping, values, {
      allowedProperties: keys,
      sanitizeLists: group.sanitizeListValues,
      keepEmpty: options.keepEmpty,
    });
  }

  // --- writing -----------------------------------------------------------

  async createNote(attachment: TFile, group: MappingGroup): Promise<TFile | null> {
    if (this.isAuxiliaryFile(attachment, group)) {
      return this.foldAuxiliaryFile(attachment, group);
    }

    const existing = this.findNote(group, attachment.path);
    if (existing) return existing;

    // The output root may overlap the watched input root. Once a resource is
    // already in the standard item folder, never fold it one level deeper.
    if (group.layout === 'folder' && isFolderItemPath(group, attachment.path)) {
      const note = this.folderIndexNote(attachment);
      if (note && group.createNoteFile && !this.noteReferences(note, attachment.path)) {
        new Notice(t('notices.sourceRepairRequired', { note: note.basename }));
      }
      return note && this.noteReferences(note, attachment.path) ? note : null;
    }

    if (group.layout === 'folder' && !isInFolder(attachment.path, group.attachmentsFolder)) {
      // Already moved into its own folder (createNoteFile groups never get a
      // note to find above) — nothing left to fold.
      return null;
    }

    return group.layout === 'folder'
      ? this.createFolderItem(attachment, group)
      : this.createSidecarNote(attachment, group);
  }

  /** Read-only half of creation, used to preview every batch mutation. */
  planCreate(attachment: TFile, group: MappingGroup): CreatePlan | null {
    if (this.isAuxiliaryFile(attachment, group)) {
      const note = this.findAuxiliaryNote(attachment, group);
      if (!note?.parent) return null;
      const target = normalizePath(`${note.parent.path}/${attachment.name}`);
      const changes: CreateChange[] = [];
      if (normalizePath(attachment.path) !== target) {
        if (this.app.vault.getFileByPath(target)) return null;
        changes.push({ kind: 'move', from: normalizePath(attachment.path), to: target });
      }
      const link = this.linkFor(group, target);
      if (!this.noteHasSourceLink(note, link)) {
        changes.push({ kind: 'update-source', notePath: note.path, link });
      }
      return changes.length > 0
        ? { attachment, group, mode: 'auxiliary', changes, note }
        : null;
    }

    // A source hit is authoritative. Structural fallbacks below are only a
    // guard/repair path; they must not silently pretend the relation exists.
    if (this.findNoteBySourceInGroup(group, attachment.path)) return null;

    if (group.layout === 'folder' && isFolderItemPath(group, attachment.path)) {
      const note = this.folderIndexNote(attachment);
      if (!group.createNoteFile || !note || this.noteReferences(note, attachment.path)) return null;
      return {
        attachment, group, mode: 'repair-source', note,
        changes: [{
          kind: 'update-source', notePath: note.path,
          link: this.linkFor(group, attachment.path),
        }],
      };
    }
    if (this.findNote(group, attachment.path)) return null;

    if (group.layout === 'folder' && !isInFolder(attachment.path, group.attachmentsFolder)) return null;

    if (group.layout === 'sidecar') {
      const notePath = this.targetNotePath(group, attachment.path);
      if (this.app.vault.getFileByPath(notePath)) return null;
      return {
        attachment, group, mode: 'create',
        changes: [{ kind: 'create-note', path: notePath }],
      };
    }

    const item = this.folderItemFor(attachment, group);
    if (!item) return null;
    const changes: CreateChange[] = [{
      kind: 'move', from: normalizePath(attachment.path), to: normalizePath(item.attachmentPath),
    }];
    if (group.createNoteFile) changes.push({ kind: 'create-note', path: normalizePath(item.notePath) });
    return { attachment, group, mode: 'create', changes };
  }

  /** Apply one previously previewed item; the mutating path rechecks safety. */
  async applyCreatePlan(plan: CreatePlan): Promise<void> {
    const fresh = this.planCreate(plan.attachment, plan.group);
    if (!fresh || JSON.stringify(fresh.changes) !== JSON.stringify(plan.changes)) {
      throw new Error('Batch plan changed before apply');
    }
    if (fresh.mode === 'repair-source' && fresh.note) {
      await this.appendSource(fresh.note, fresh.group, fresh.attachment);
      return;
    }
    await this.createNote(fresh.attachment, fresh.group);
  }

  private async createSidecarNote(attachment: TFile, group: MappingGroup): Promise<TFile | null> {
    const notePath = this.targetNotePath(group, attachment.path);
    if (this.app.vault.getFileByPath(notePath)) return null;

    const { template, builtin } = await this.templateFor(group);
    const rows = await this.resolveFor(attachment, group, template.keys);

    const embed = group.embedAttachment ? this.embedFor(group, attachment) : '';
    const rendered = this.renderNewNote(template, rows, group, attachment, embed, builtin);

    const folder = notePath.split('/').slice(0, -1).join('/');
    if (folder) await this.app.vault.createFolder(folder).catch(() => { /* exists */ });

    const note = await this.app.vault.create(notePath, rendered.content);
    if (rendered.templaterBlocks > 0) {
      new Notice(t('notices.templaterSkipped', { count: rendered.templaterBlocks }));
    }
    return note;
  }

  /**
   * Creates a new folder, moves the attachment into it, and creates the note
   * beside it. The move happens first — cheap and low-risk — so a failure
   * writing the note leaves the attachment safely organized rather than
   * stranded mid-operation.
   */
  private async createFolderItem(attachment: TFile, group: MappingGroup): Promise<TFile | null> {
    const item = this.folderItemFor(attachment, group);
    if (!item) return null;

    await this.app.vault.createFolder(item.folder).catch(() => { /* exists */ });

    const oldPath = normalizePath(attachment.path);
    this.pendingMoves.add(oldPath);
    try {
      await this.app.fileManager.renameFile(attachment, normalizePath(item.attachmentPath));
    } finally {
      this.pendingMoves.delete(oldPath);
    }

    if (!group.createNoteFile) return null;

    const { template, builtin } = await this.templateFor(group);
    const rows = await this.resolveFor(attachment, group, template.keys);

    const embed = group.embedAttachment ? this.embedFor(group, attachment) : '';
    const rendered = this.renderNewNote(template, rows, group, attachment, embed, builtin);

    const note = await this.app.vault.create(normalizePath(item.notePath), rendered.content);
    if (rendered.templaterBlocks > 0) {
      new Notice(t('notices.templaterSkipped', { count: rendered.templaterBlocks }));
    }
    return note;
  }

  isAuxiliaryFile(file: TFile, group: MappingGroup): boolean {
    return group.layout === 'folder' && group.createNoteFile &&
      stripAuxiliaryPrefix(file.name, group.auxiliaryPrefix) !== null;
  }

  private folderItemFor(attachment: TFile, group: MappingGroup) {
    const { primary, fallback } = folderItemCandidates(group, attachment.path);

    // An existing folder alone is reusable. Only a concrete note/resource
    // target being occupied is a collision that selects the fallback name.
    const primaryTaken = Boolean(this.app.vault.getFileByPath(normalizePath(primary.notePath))) ||
      Boolean(this.app.vault.getFileByPath(normalizePath(primary.attachmentPath)));
    const item = primaryTaken ? fallback : primary;
    if (this.app.vault.getFileByPath(normalizePath(item.notePath))) return null;
    if (this.app.vault.getFileByPath(normalizePath(item.attachmentPath))) return null;
    return item;
  }

  private folderIndexNote(file: TFile): TFile | null {
    const parent = file.parent;
    if (!parent) return null;
    const note = parent.children.find(child =>
      child instanceof TFile && child.extension === 'md' && child.basename === parent.name,
    );
    return note instanceof TFile ? note : null;
  }

  private findAuxiliaryNote(file: TFile, group: MappingGroup): TFile | null {
    const stripped = stripAuxiliaryPrefix(file.basename, group.auxiliaryPrefix);
    if (stripped === null) return null;
    const key = normalizeForMatch(stripped);
    const notesFolder = cleanFolder(group.notesFolder);

    return this.app.vault.getMarkdownFiles().find(note => {
      if (!isInFolder(note.path, notesFolder)) return false;
      const names = [note.basename, ...this.linkedResourceFiles(note).map(resource => {
        return stripAuxiliaryPrefix(resource.basename, group.auxiliaryPrefix) ?? resource.basename;
      })];
      return names.some(name => normalizeForMatch(name) === key);
    }) ?? null;
  }

  /**
   * A companion file (translation, etc.) never gets a note of its own: find
   * the item it belongs to by normalized-name match against every note under
   * notesFolder, and move it in beside that note. No match — most likely it
   * arrived before the primary item did, or the names differ too much —
   * leaves it exactly where it is rather than guessing.
   */
  private async foldAuxiliaryFile(file: TFile, group: MappingGroup): Promise<TFile | null> {
    const match = this.findAuxiliaryNote(file, group);

    if (!match?.parent) {
      new Notice(t('notices.auxiliaryUnmatched', { file: file.name }));
      return null;
    }

    const targetPath = normalizePath(`${match.parent.path}/${file.name}`);
    const existing = this.app.vault.getFileByPath(targetPath);
    if (existing instanceof TFile) {
      await this.appendSource(match, group, existing);
      return match;
    }

    const oldPath = normalizePath(file.path);
    this.pendingMoves.add(oldPath);
    try {
      await this.app.fileManager.renameFile(file, targetPath);
    } finally {
      this.pendingMoves.delete(oldPath);
    }

    await this.appendSource(match, group, file);
    new Notice(t('notices.auxiliaryMatched', { file: file.name, note: match.basename }));
    return match;
  }

  private async appendSource(note: TFile, group: MappingGroup, file: TFile): Promise<void> {
    const link = this.linkFor(group, file.path);
    await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
      fm[SOURCE_PROPERTY] = appendSourceLink(fm[SOURCE_PROPERTY], link);
    });
  }

  private embedFor(group: MappingGroup, attachment: TFile): string {
    const link = this.linkFor(group, attachment.path);
    return link.startsWith('[[') ? `!${link}` : `![[${attachment.path}]]`;
  }

  async setProperty(note: TFile, property: string, value: FieldValue): Promise<void> {
    await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
      fm[property] = value;
    });
  }

  /**
   * Brings a note up to the group's current template: keys the template
   * defines that the note lacks get filled from the current mapping,
   * matching the safe-default rule the refresh modal already uses — never
   * touches a property that already has a value, never removes a property
   * the template doesn't know about. Returns how many properties it added.
   */
  async upgradeNote(note: TFile, group: MappingGroup): Promise<number> {
    const attachment = this.findAttachment(group, note);
    if (!attachment) return 0;

    const { template } = await this.templateFor(group);
    const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
    const keys = Array.from(new Set([...Object.keys(frontmatter ?? {}), ...template.keys]));
    if (keys.length === 0) return 0;

    const rows = await this.resolveFor(attachment, group, keys, { keepEmpty: true });
    const fillable = autoFillableRows(buildDiffRows(rows, frontmatter));
    if (fillable.length === 0) return 0;

    await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
      for (const row of fillable) fm[row.property] = row.incoming;
    });
    return fillable.length;
  }

  /** Only refreshes a property the note already carries — the template rules. */
  async touchUpdated(attachment: TFile, group: MappingGroup): Promise<void> {
    const property = this.propertyOf('fileUpdated');
    if (!property) return;
    const note = this.findNote(group, attachment.path);
    if (!note) return;
    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
    if (!fm || !(property in fm)) return;
    await this.setProperty(note, property, toDate(attachment.stat.mtime));
  }

  async renameNote(group: MappingGroup, oldPath: string, newPath: string): Promise<void> {
    const note = this.findNote(group, oldPath);
    if (!note) return;

    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
    const linkProp = this.propertyOf('link');
    const pathProp = this.propertyOf('path');
    const nameProp = this.propertyOf('fileName');

    await this.app.fileManager.processFrontMatter(note, (frontmatter: Record<string, unknown>) => {
      if (linkProp && fm && linkProp in fm) frontmatter[linkProp] = this.linkFor(group, newPath);
      if (pathProp && fm && pathProp in fm) frontmatter[pathProp] = newPath;
      if (nameProp && fm && nameProp in fm) {
        frontmatter[nameProp] = newPath.split('/').pop() ?? newPath;
      }
    });

    const target = this.targetNotePath(group, newPath);
    if (normalizePath(note.path) === target) return;
    if (this.app.vault.getFileByPath(target)) return;

    const folder = target.split('/').slice(0, -1).join('/');
    if (folder) await this.app.vault.createFolder(folder).catch(() => { /* exists */ });
    await this.app.fileManager.renameFile(note, target);
  }

}
