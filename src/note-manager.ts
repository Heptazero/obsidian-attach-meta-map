import { App, Notice, TFile, normalizePath } from 'obsidian';
import { AttMetaMapSettings, MappingGroup, SourceValues } from './types';
import { BUILTIN_TEMPLATE_KEYS, FieldValue, ResolvedField, resolveFields } from './sources';
import {
  attachmentCandidates, cleanFolder, folderItemCandidates, isInFolder, linkFor, normalizeForMatch,
  notePathCandidates, templateVars,
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
  appendSourceLink, SOURCE_PROPERTY, sourceLinkTargets, stripAuxiliaryPrefix,
} from './resource-links';

const toDate = (ms: number): string => new Date(ms).toISOString().split('T')[0];

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

  /**
   * Tries the group's current layout first, then the other layout as a
   * fallback — so an item folded in the past (or left as a sidecar) is still
   * recognized after the group's layout setting changes, and existing items
   * are never mistaken for "not yet handled".
   */
  findNote(group: MappingGroup, attachmentPath: string): TFile | null {
    const linked = this.findNoteBySourceInGroup(group, attachmentPath);
    if (linked) return linked;

    // Already folded: the attachment no longer sits under attachmentsFolder,
    // so recomputing candidates from it would use a stale relative path. The
    // note is simply the markdown sibling in the same folder.
    if (group.layout === 'folder' && !isInFolder(attachmentPath, group.attachmentsFolder) &&
        isInFolder(attachmentPath, group.notesFolder)) {
      const attachment = this.app.vault.getFileByPath(normalizePath(attachmentPath));
      for (const sibling of attachment?.parent?.children ?? []) {
        if (sibling instanceof TFile && sibling.extension === 'md') return sibling;
      }
      return null;
    }

    const tryPaths = (paths: string[]): TFile | null => {
      for (const candidate of paths) {
        const file = this.app.vault.getFileByPath(normalizePath(candidate));
        if (!file) continue;
        if (this.notePointsAt(file, group, attachmentPath) !== 'no') return file;
      }
      return null;
    };

    const sidecar = notePathCandidates(group, attachmentPath);
    const folder = folderItemCandidates(group, attachmentPath);
    const sidecarPaths = [sidecar.primary, sidecar.fallback];
    const folderPaths = [folder.primary.notePath, folder.fallback.notePath];

    const [firstPaths, secondPaths] = group.layout === 'folder'
      ? [folderPaths, sidecarPaths]
      : [sidecarPaths, folderPaths];

    return tryPaths(firstPaths) ?? tryPaths(secondPaths);
  }

  targetNotePath(group: MappingGroup, attachmentPath: string): string {
    const { primary, fallback } = notePathCandidates(group, attachmentPath);
    const existing = this.app.vault.getFileByPath(normalizePath(primary));
    if (!existing) return normalizePath(primary);
    if (this.notePointsAt(existing, group, attachmentPath) === 'yes') return normalizePath(primary);
    return normalizePath(fallback);
  }

  findAttachment(group: MappingGroup, note: TFile): TFile | null {
    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;

    const source = this.sourceFiles(note)[0];
    if (source) return source;

    const pathProp = this.propertyOf('path');
    const recorded: unknown = pathProp ? fm?.[pathProp] : undefined;
    if (typeof recorded === 'string' && recorded.trim()) {
      const direct = this.app.vault.getFileByPath(normalizePath(recorded.trim()));
      if (direct) return direct;
    }

    const linkProp = this.propertyOf('link');
    const legacyLink = linkProp && linkProp !== SOURCE_PROPERTY
      ? this.filesFromProperty(note, linkProp)[0]
      : this.filesFromProperty(note, 'attachment')[0];
    if (legacyLink) return legacyLink;

    for (const candidate of attachmentCandidates(group, note.path)) {
      const file = this.app.vault.getFileByPath(normalizePath(candidate));
      if (file) return file;
    }

    // Folder layout: the attachment is a sibling with no fixed name relation
    // to the note, so the only way to find it is to look at what's actually
    // sitting next to the note.
    const extensions = group.watchedExtensions.map(ext => ext.slice(1).toLowerCase());
    for (const sibling of note.parent?.children ?? []) {
      if (sibling instanceof TFile && sibling.path !== note.path &&
          extensions.includes(sibling.extension.toLowerCase())) {
        return sibling;
      }
    }
    return null;
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

    if (group.layout === 'folder' && !isInFolder(attachment.path, group.attachmentsFolder)) {
      // Already moved into its own folder (createNoteFile groups never get a
      // note to find above) — nothing left to fold.
      return null;
    }

    return group.layout === 'folder'
      ? this.createFolderItem(attachment, group)
      : this.createSidecarNote(attachment, group);
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
    const { primary, fallback } = folderItemCandidates(group, attachment.path);

    // Only fall back to the differently-named folder when the *specific*
    // note/attachment file names are already taken — a real collision with
    // a different item. An existing folder that merely happens to share the
    // name (created by hand ahead of time, e.g. to drop a translation in)
    // is not a collision: reuse it and land the note/attachment inside it,
    // rather than spinning up a second, differently-named folder next to it.
    const primaryTaken = Boolean(this.app.vault.getFileByPath(normalizePath(primary.notePath))) ||
      Boolean(this.app.vault.getFileByPath(normalizePath(primary.attachmentPath)));
    const item = primaryTaken ? fallback : primary;

    if (this.app.vault.getFileByPath(normalizePath(item.notePath))) return null;
    if (this.app.vault.getFileByPath(normalizePath(item.attachmentPath))) return null;

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

  /**
   * A companion file (translation, etc.) never gets a note of its own: find
   * the item it belongs to by normalized-name match against every note under
   * notesFolder, and move it in beside that note. No match — most likely it
   * arrived before the primary item did, or the names differ too much —
   * leaves it exactly where it is rather than guessing.
   */
  private async foldAuxiliaryFile(file: TFile, group: MappingGroup): Promise<TFile | null> {
    const stripped = stripAuxiliaryPrefix(file.basename, group.auxiliaryPrefix);
    if (stripped === null) return null;
    const key = normalizeForMatch(stripped);
    const notesFolder = cleanFolder(group.notesFolder);

    const match = this.app.vault.getMarkdownFiles().find(note => {
      if (!isInFolder(note.path, notesFolder)) return false;
      const names = [note.basename, ...this.linkedResourceFiles(note).map(resource => {
        return stripAuxiliaryPrefix(resource.basename, group.auxiliaryPrefix) ?? resource.basename;
      })];
      return names.some(name => normalizeForMatch(name) === key);
    });

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

  async deleteNote(group: MappingGroup, attachmentPath: string): Promise<void> {
    const note = this.findNote(group, attachmentPath);
    if (!note) return;
    await this.app.fileManager.trashFile(note);
  }
}
