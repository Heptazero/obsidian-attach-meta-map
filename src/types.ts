/**
 * Att Meta Map — settings model.
 *
 * Two ideas the upstream plugin did not have:
 *   1. Every frontmatter field is opt-in and can be renamed (see fields.ts).
 *   2. A vault can hold several independent attachment -> note mappings
 *      ("groups"), each with its own folders, extensions and field table.
 */

export type FieldSource = 'vault' | 'pdf' | 'lookup' | 'manual';

export type FieldKind = 'text' | 'list' | 'date' | 'number' | 'link';

export interface FieldDefinition {
  /** Stable key used in settings; never shown raw to the user. */
  id: string;
  source: FieldSource;
  kind: FieldKind;
  /** Frontmatter property name used until the user renames it. */
  property: string;
  enabled: boolean;
  /** Manual fields only: value written on creation. */
  defaultValue?: string;
}

export interface FieldConfig {
  enabled: boolean;
  property: string;
  defaultValue?: string;
}

export interface MappingGroup {
  id: string;
  name: string;

  /** Where the attachments live. */
  attachmentsFolder: string;
  /** Where the sidecar notes live. */
  notesFolder: string;
  watchedExtensions: string[];
  /** Recreate the attachment subfolder tree under notesFolder. */
  mirrorFolderStructure: boolean;

  /** Note filename, without ".md". Variables: {{basename}} {{name}} {{ext}} */
  noteNameTemplate: string;
  /** Value written into the link field. Same variables. */
  linkTemplate: string;
  /** Embed the attachment in the note body. */
  embedAttachment: boolean;
  /** Write an H1 into the note body (off: the filename is the title). */
  includeHeading: boolean;

  autoCreateOnNew: boolean;
  autoDeleteOnRemove: boolean;
  /** Keep the "updated" field in sync when the attachment changes. */
  syncUpdatedOnModify: boolean;

  enablePdfMetadataExtraction: boolean;
  enableDoiIsbnLookup: boolean;
  /** Strip characters Obsidian would reject in a tag from list values. */
  sanitizeListValues: boolean;

  autoCreateBaseFile: boolean;
  baseFolderPath: string;

  /** Keyed by FieldDefinition.id. */
  fields: Record<string, FieldConfig>;
}

export interface AttMetaMapSettings {
  version: number;
  groups: MappingGroup[];
}

export const SETTINGS_VERSION = 2;

/** Values gathered from every source before the field table filters them. */
export interface SourceValues {
  /** vault */
  link: string;
  path: string;
  fileName: string;
  basename: string;
  fileType: string;
  fileSize: number;
  fileCreated: string;
  fileUpdated: string;
  /** pdf */
  pdfTitle: string;
  pdfAuthor: string;
  pdfSubject: string;
  pdfKeywords: string[];
  pdfCreated: string;
  pdfModified: string;
  pdfCreator: string;
  pdfProducer: string;
  pdfPages: number | null;
  /** lookup */
  doi: string;
  isbn: string;
  lookupTitle: string;
  lookupAuthor: string;
  lookupYear: string;
}
