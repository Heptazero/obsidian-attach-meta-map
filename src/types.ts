/**
 * Att Meta Map — settings model.
 *
 * The template decides which properties a note has; this plugin only decides
 * where each value comes from. So there is exactly one mapping table for the
 * whole plugin (source -> property name), and a group only says which folders,
 * extensions and template it uses.
 */

export type SourceKind = 'vault' | 'pdf' | 'lookup';

export type ValueKind = 'text' | 'list' | 'date' | 'number' | 'link';

export interface SourceDefinition {
  /** Stable key used in settings. */
  id: string;
  kind: SourceKind;
  value: ValueKind;
  /** Property this source fills until the user maps it elsewhere. */
  property: string;
}

/**
 * sidecar: the attachment stays where it is; the note lives in a mirrored
 *   tree under notesFolder.
 * folder: a new folder (named like the note) is created under notesFolder,
 *   the attachment is moved into it, and the note lives beside it. Once
 *   folded, the item leaves attachmentsFolder for good — the plugin's
 *   watchers stop tracking it and Obsidian's own link-rename handling takes
 *   over from there.
 */
export type GroupLayout = 'sidecar' | 'folder';

export interface MappingGroup {
  id: string;
  name: string;
  layout: GroupLayout;

  attachmentsFolder: string;
  notesFolder: string;
  watchedExtensions: string[];
  mirrorFolderStructure: boolean;

  /**
   * Folder layout only. A file whose name starts with this prefix (e.g.
   * "cn_") is a companion to an existing item, not a new one: it gets moved
   * into the matching item's folder instead of getting its own note. Empty
   * disables this. Matching is by normalized name after stripping the
   * prefix — see normalizeForMatch in paths.ts.
   */
  auxiliaryPrefix: string;

  /** Template note whose frontmatter defines the fields. Empty = built-in. */
  templatePath: string;

  /** Note filename, without ".md". Variables: {{basename}} {{name}} {{ext}} */
  noteNameTemplate: string;
  /** Value written into the link property. Same variables. */
  linkTemplate: string;
  /** Append an embed of the attachment to the note body. */
  embedAttachment: boolean;

  autoCreateOnNew: boolean;
  autoDeleteOnRemove: boolean;
  syncUpdatedOnModify: boolean;

  enablePdfMetadataExtraction: boolean;
  enableDoiIsbnLookup: boolean;
  sanitizeListValues: boolean;

  autoCreateBaseFile: boolean;
  baseFolderPath: string;
}

export type UiLanguage = 'auto' | 'zh' | 'en';

export interface AttMetaMapSettings {
  version: number;
  language: UiLanguage;
  /** source id -> frontmatter property. Empty string means "do not map". */
  mapping: Record<string, string>;
  /** Extra folders to scan for templates, beyond the ones auto-detected. */
  extraTemplateFolders: string[];
  groups: MappingGroup[];
}

export const SETTINGS_VERSION = 3;

/** Values gathered from every source before the mapping decides their names. */
export interface SourceValues {
  link: string;
  path: string;
  fileName: string;
  basename: string;
  fileType: string;
  fileSize: number;
  fileCreated: string;
  fileUpdated: string;
  fileNameYear: string;
  fileNameTitle: string;
  pdfTitle: string;
  pdfAuthor: string;
  pdfSubject: string;
  pdfKeywords: string[];
  pdfCreated: string;
  pdfModified: string;
  pdfCreator: string;
  pdfProducer: string;
  pdfPages: number | null;
  doi: string;
  isbn: string;
  lookupTitle: string;
  lookupAuthor: string;
  lookupYear: string;
}
