import { App, TFile, normalizePath } from 'obsidian';
import { MappingGroup, SourceValues } from './types';
import { FieldValue, ResolvedField, resolveFields } from './fields';
import {
  attachmentCandidates, notePathCandidates, renderTemplate, templateVars,
} from './paths';
import {
  EMPTY_LOOKUP, EMPTY_PDF_METADATA, LookupResult, PdfMetadataExtractor,
  lookupDoi, lookupIsbn,
} from './pdf-extractor';

const toDate = (ms: number): string => new Date(ms).toISOString().split('T')[0];

export class NoteManager {
  private pdfExtractor: PdfMetadataExtractor;

  constructor(private app: App) {
    this.pdfExtractor = new PdfMetadataExtractor(app);
  }

  // --- mapping -----------------------------------------------------------

  linkFor(group: MappingGroup, attachmentPath: string): string {
    return renderTemplate(group.linkTemplate || '[[{{path}}]]', templateVars(attachmentPath));
  }

  /** The note for this attachment, if one exists. */
  findNote(group: MappingGroup, attachmentPath: string): TFile | null {
    const { primary, fallback } = notePathCandidates(group, attachmentPath);
    for (const candidate of [primary, fallback]) {
      const file = this.app.vault.getFileByPath(normalizePath(candidate));
      if (!file) continue;
      if (this.notePointsAt(file, group, attachmentPath) !== 'no') return file;
    }
    return null;
  }

  /** Where a new note for this attachment should go. */
  targetNotePath(group: MappingGroup, attachmentPath: string): string {
    const { primary, fallback } = notePathCandidates(group, attachmentPath);
    const existing = this.app.vault.getFileByPath(normalizePath(primary));
    if (!existing) return normalizePath(primary);
    if (this.notePointsAt(existing, group, attachmentPath) === 'yes') return normalizePath(primary);
    return normalizePath(fallback);
  }

  /** The attachment a sidecar note describes, if it can be found. */
  findAttachment(group: MappingGroup, note: TFile): TFile | null {
    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;

    const pathProp = this.propertyOf(group, 'path');
    const recorded = pathProp ? fm?.[pathProp] : undefined;
    if (typeof recorded === 'string' && recorded.trim()) {
      const direct = this.app.vault.getFileByPath(normalizePath(recorded.trim()));
      if (direct) return direct;
    }

    const linkProp = this.propertyOf(group, 'link');
    const rawLink = linkProp ? fm?.[linkProp] : undefined;
    if (typeof rawLink === 'string') {
      const inner = /\[\[([^\]|#]+)/.exec(rawLink)?.[1]?.trim();
      if (inner) {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(inner, note.path);
        if (resolved) return resolved;
      }
    }

    for (const candidate of attachmentCandidates(group, note.path)) {
      const file = this.app.vault.getFileByPath(normalizePath(candidate));
      if (file) return file;
    }
    return null;
  }

  private propertyOf(group: MappingGroup, fieldId: string): string | null {
    const config = group.fields[fieldId];
    if (!config?.enabled) return null;
    return config.property.trim() || null;
  }

  private notePointsAt(
    note: TFile, group: MappingGroup, attachmentPath: string,
  ): 'yes' | 'no' | 'unknown' {
    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
    if (!fm) return 'unknown';

    const pathProp = this.propertyOf(group, 'path');
    const recordedPath: unknown = pathProp ? fm[pathProp] : undefined;
    if (typeof recordedPath === 'string' && recordedPath.trim()) {
      return normalizePath(recordedPath.trim()) === normalizePath(attachmentPath) ? 'yes' : 'no';
    }

    const linkProp = this.propertyOf(group, 'link');
    const recordedLink: unknown = linkProp ? fm[linkProp] : undefined;
    if (typeof recordedLink === 'string' && recordedLink.trim()) {
      return recordedLink.trim() === this.linkFor(group, attachmentPath) ? 'yes' : 'no';
    }

    return 'unknown';
  }

  // --- metadata ----------------------------------------------------------

  async gather(file: TFile, group: MappingGroup): Promise<SourceValues> {
    const vars = templateVars(file.path);

    const values: SourceValues = {
      link: this.linkFor(group, file.path),
      path: file.path,
      fileName: file.name,
      basename: file.basename,
      fileType: file.extension,
      fileSize: file.stat.size,
      fileCreated: toDate(file.stat.ctime),
      fileUpdated: toDate(file.stat.mtime),
      pdfTitle: vars.basename,
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
    file: TFile, group: MappingGroup, options: { skipEmpty?: boolean } = {},
  ): Promise<ResolvedField[]> {
    const values = await this.gather(file, group);
    return resolveFields(group, values, options);
  }

  // --- writing -----------------------------------------------------------

  async createNote(attachment: TFile, group: MappingGroup): Promise<TFile | null> {
    const existing = this.findNote(group, attachment.path);
    if (existing) return existing;

    const notePath = this.targetNotePath(group, attachment.path);
    if (this.app.vault.getFileByPath(notePath)) return null;

    const folder = notePath.split('/').slice(0, -1).join('/');
    if (folder) await this.app.vault.createFolder(folder).catch(() => { /* exists */ });

    const rows = await this.resolveFor(attachment, group);
    const note = await this.app.vault.create(notePath, this.buildBody(group, attachment, rows));
    await this.writeFields(note, rows);
    return note;
  }

  private buildBody(group: MappingGroup, attachment: TFile, rows: ResolvedField[]): string {
    const lines: string[] = [];

    if (group.includeHeading) {
      const titleRow = rows.find(r => r.id === 'pdfTitle' || r.id === 'lookupTitle');
      const title = typeof titleRow?.value === 'string' && titleRow.value.trim()
        ? titleRow.value.trim()
        : attachment.basename;
      lines.push(`# ${title}`, '');
    }

    if (group.embedAttachment) {
      const link = this.linkFor(group, attachment.path);
      lines.push(link.startsWith('[[') ? `!${link}` : `![[${attachment.path}]]`, '');
    }

    return lines.join('\n');
  }

  /** Writes the given rows, leaving every other property untouched. */
  async writeFields(note: TFile, rows: ResolvedField[]): Promise<void> {
    if (rows.length === 0) return;
    await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
      for (const row of rows) {
        fm[row.property] = row.value;
      }
    });
  }

  async setProperty(note: TFile, property: string, value: FieldValue): Promise<void> {
    await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
      fm[property] = value;
    });
  }

  async touchUpdated(attachment: TFile, group: MappingGroup): Promise<void> {
    const property = this.propertyOf(group, 'fileUpdated');
    if (!property) return;
    const note = this.findNote(group, attachment.path);
    if (!note) return;
    await this.setProperty(note, property, toDate(attachment.stat.mtime));
  }

  async renameNote(group: MappingGroup, oldPath: string, newPath: string): Promise<void> {
    const note = this.findNote(group, oldPath);
    if (!note) return;

    const linkProp = this.propertyOf(group, 'link');
    const pathProp = this.propertyOf(group, 'path');
    const nameProp = this.propertyOf(group, 'fileName');

    await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
      if (linkProp) fm[linkProp] = this.linkFor(group, newPath);
      if (pathProp) fm[pathProp] = newPath;
      if (nameProp) fm[nameProp] = newPath.split('/').pop() ?? newPath;
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

  /** Rename a property across every note of a group. Returns notes touched. */
  async migrateProperty(group: MappingGroup, from: string, to: string): Promise<number> {
    if (!from || !to || from === to) return 0;
    const prefix = group.notesFolder.replace(/\/+$/, '') + '/';
    const notes = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));

    let migrated = 0;
    for (const note of notes) {
      await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
        if (!(from in fm)) return;
        fm[to] = fm[from];
        delete fm[from];
        migrated++;
      });
    }
    return migrated;
  }
}
