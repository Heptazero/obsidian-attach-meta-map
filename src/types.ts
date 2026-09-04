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
 * sidecar: resources and notes have separate roots.
 * folder: loose resources and their item folders share one collection root.
 */
export type GroupLayout = 'sidecar' | 'folder';

export interface MappingGroupCommon {
  id: string;
  name: string;
  watchedExtensions: string[];

  /**
   * Folder layout only. Comma-separated prefixes (e.g. "cn_, zh_") mark
   * companion files. A companion joins the matching resource folder and its
   * link is appended to the note's source property.
   */
  auxiliaryPrefix: string;

  /**
   * Folder layout only. When false, folding an attachment still creates the
   * folder and moves the attachment in, but skips creating and maintaining
   * the note — for material that just needs a folder of its own, not
   * metadata. Everything template/metadata-related is irrelevant then.
   */
  createNoteFile: boolean;

  /** Template note whose frontmatter defines the fields. Empty = built-in. */
  templatePath: string;

  /** Note filename, without ".md". Variables: {{basename}} {{name}} {{ext}} */
  noteNameTemplate: string;
  /** Value written into the link property. Same variables. */
  linkTemplate: string;
  /** Append an embed of the attachment to the note body. */
  embedAttachment: boolean;

  autoCreateOnNew: boolean;
  syncUpdatedOnModify: boolean;

  enablePdfMetadataExtraction: boolean;
  enableDoiIsbnLookup: boolean;
  sanitizeListValues: boolean;
}

export interface SidecarGroup extends MappingGroupCommon {
  layout: 'sidecar';
  resourceFolder: string;
  noteFolder: string;
  mirrorFolderStructure: boolean;
}

export interface FolderGroup extends MappingGroupCommon {
  layout: 'folder';
  collectionFolder: string;
}

export type MappingGroup = SidecarGroup | FolderGroup;

export type MappingGroupInput = Partial<MappingGroupCommon> & {
  layout?: GroupLayout;
  resourceFolder?: string;
  noteFolder?: string;
  collectionFolder?: string;
  mirrorFolderStructure?: boolean;
};

export type UiLanguage = 'auto' | 'zh' | 'en';

export interface AttMetaMapSettings {
  version: number;
  language: UiLanguage;
  /** Metadata source id -> frontmatter property. The source relation itself is fixed. */
  mapping: Record<string, string>;
  /** Extra folders to scan for templates, beyond the ones auto-detected. */
  extraTemplateFolders: string[];
  groups: MappingGroup[];
}

export const SETTINGS_VERSION = 4;

/** Values gathered from every source before the mapping decides their names. */
export interface SourceValues {
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
