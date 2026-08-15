import {
  AttMetaMapSettings, FieldConfig, FieldDefinition, MappingGroup,
  SETTINGS_VERSION, SourceValues,
} from './types';

/**
 * The full catalogue. Defaults are deliberately lean — five fields on, the
 * rest available but silent until you switch them on.
 */
export const FIELD_DEFS: FieldDefinition[] = [
  // --- mapped from the vault / file system -------------------------------
  { id: 'link',        source: 'vault', kind: 'link',   property: 'attachment', enabled: true },
  { id: 'path',        source: 'vault', kind: 'text',   property: 'filePath',   enabled: false },
  { id: 'fileName',    source: 'vault', kind: 'text',   property: 'fileName',   enabled: false },
  { id: 'fileType',    source: 'vault', kind: 'text',   property: 'fileType',   enabled: false },
  { id: 'fileSize',    source: 'vault', kind: 'number', property: 'fileSize',   enabled: false },
  { id: 'fileCreated', source: 'vault', kind: 'date',   property: 'created',    enabled: true },
  { id: 'fileUpdated', source: 'vault', kind: 'date',   property: 'updated',    enabled: true },

  // --- read out of the PDF itself ----------------------------------------
  { id: 'pdfTitle',    source: 'pdf', kind: 'text',   property: 'title',       enabled: true },
  { id: 'pdfAuthor',   source: 'pdf', kind: 'text',   property: 'author',      enabled: true },
  { id: 'pdfSubject',  source: 'pdf', kind: 'text',   property: 'subject',     enabled: false },
  { id: 'pdfKeywords', source: 'pdf', kind: 'list',   property: 'keywords',    enabled: false },
  { id: 'pdfCreated',  source: 'pdf', kind: 'date',   property: 'pdfCreated',  enabled: false },
  { id: 'pdfModified', source: 'pdf', kind: 'date',   property: 'pdfModified', enabled: false },
  { id: 'pdfCreator',  source: 'pdf', kind: 'text',   property: 'pdfCreator',  enabled: false },
  { id: 'pdfProducer', source: 'pdf', kind: 'text',   property: 'pdfProducer', enabled: false },
  { id: 'pdfPages',    source: 'pdf', kind: 'number', property: 'pages',       enabled: false },

  // --- resolved online from a DOI / ISBN found in the file ---------------
  { id: 'doi',          source: 'lookup', kind: 'text', property: 'doi',    enabled: false },
  { id: 'isbn',         source: 'lookup', kind: 'text', property: 'isbn',   enabled: false },
  { id: 'lookupTitle',  source: 'lookup', kind: 'text', property: 'title',  enabled: false },
  { id: 'lookupAuthor', source: 'lookup', kind: 'text', property: 'author', enabled: false },
  { id: 'lookupYear',   source: 'lookup', kind: 'text', property: 'year',   enabled: false },

  // --- placeholders you fill in by hand ----------------------------------
  { id: 'status', source: 'manual', kind: 'text', property: 'status', enabled: false, defaultValue: 'unread' },
  { id: 'genre',  source: 'manual', kind: 'text', property: 'genre',  enabled: false, defaultValue: '' },
  { id: 'source', source: 'manual', kind: 'text', property: 'source', enabled: false, defaultValue: '' },
  { id: 'notes',  source: 'manual', kind: 'text', property: 'notes',  enabled: false, defaultValue: '' },
];

export const FIELD_DEF_BY_ID: Record<string, FieldDefinition> =
  Object.fromEntries(FIELD_DEFS.map(d => [d.id, d]));

export function defaultFieldConfigs(): Record<string, FieldConfig> {
  const out: Record<string, FieldConfig> = {};
  for (const def of FIELD_DEFS) {
    out[def.id] = {
      enabled: def.enabled,
      property: def.property,
      ...(def.defaultValue !== undefined ? { defaultValue: def.defaultValue } : {}),
    };
  }
  return out;
}

/** Fill in fields added by a later version without touching the user's edits. */
export function withMissingFields(fields: Record<string, FieldConfig>): Record<string, FieldConfig> {
  const defaults = defaultFieldConfigs();
  return { ...defaults, ...fields };
}

let groupCounter = 0;

export function createGroup(partial: Partial<MappingGroup> = {}): MappingGroup {
  groupCounter++;
  return {
    id: `g${Date.now().toString(36)}${groupCounter.toString(36)}`,
    name: 'New group',
    attachmentsFolder: 'Attachments',
    notesFolder: 'Library',
    watchedExtensions: ['.pdf'],
    mirrorFolderStructure: true,
    noteNameTemplate: '{{basename}}',
    linkTemplate: '[[{{basename}}]]',
    embedAttachment: true,
    includeHeading: false,
    autoCreateOnNew: true,
    autoDeleteOnRemove: true,
    syncUpdatedOnModify: true,
    enablePdfMetadataExtraction: true,
    enableDoiIsbnLookup: false,
    sanitizeListValues: true,
    autoCreateBaseFile: false,
    baseFolderPath: '',
    fields: defaultFieldConfigs(),
    ...partial,
  };
}

export function defaultSettings(): AttMetaMapSettings {
  return { version: SETTINGS_VERSION, groups: [createGroup({ name: 'Attachments' })] };
}

interface LegacySettings {
  attachmentsFolder?: string;
  libraryFolder?: string;
  watchedExtensions?: string[];
  autoCreateOnNew?: boolean;
  autoDeleteOnRemove?: boolean;
  mirrorFolderStructure?: boolean;
  baseFolderPath?: string;
  enablePdfMetadataExtraction?: boolean;
  enableDoiIsbnLookup?: boolean;
  autoCreateBaseFile?: boolean;
  tagsPropertyName?: string;
}

/**
 * Accepts either the new shape or an Attachments Library v1 data.json, so
 * pointing this plugin at an existing config keeps working.
 */
export function normalizeSettings(raw: unknown): AttMetaMapSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings();

  const candidate = raw as Partial<AttMetaMapSettings> & LegacySettings;

  if (Array.isArray(candidate.groups)) {
    const groups = candidate.groups.map(g => ({
      ...createGroup(),
      ...g,
      fields: withMissingFields(g.fields ?? {}),
    }));
    return { version: SETTINGS_VERSION, groups: groups.length ? groups : defaultSettings().groups };
  }

  if (!candidate.attachmentsFolder && !candidate.libraryFolder) return defaultSettings();

  const fields = defaultFieldConfigs();
  if (candidate.tagsPropertyName) {
    fields.pdfKeywords = { enabled: true, property: candidate.tagsPropertyName };
  }

  const migrated = createGroup({
    name: candidate.attachmentsFolder?.split('/').filter(Boolean).pop() ?? 'Attachments',
    attachmentsFolder: candidate.attachmentsFolder ?? 'Attachments',
    notesFolder: candidate.libraryFolder ?? 'Library',
    watchedExtensions: candidate.watchedExtensions ?? ['.pdf'],
    mirrorFolderStructure: candidate.mirrorFolderStructure ?? true,
    autoCreateOnNew: candidate.autoCreateOnNew ?? true,
    autoDeleteOnRemove: candidate.autoDeleteOnRemove ?? true,
    enablePdfMetadataExtraction: candidate.enablePdfMetadataExtraction ?? true,
    enableDoiIsbnLookup: candidate.enableDoiIsbnLookup ?? false,
    autoCreateBaseFile: candidate.autoCreateBaseFile ?? false,
    baseFolderPath: candidate.baseFolderPath ?? '',
    fields,
  });

  return { version: SETTINGS_VERSION, groups: [migrated] };
}

export function sanitizeListValue(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_/一-鿿]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

export type FieldValue = string | number | string[];

/** One resolved row: which property gets which value, and where it came from. */
export interface ResolvedField {
  id: string;
  property: string;
  source: FieldDefinition['source'];
  value: FieldValue;
}

function rawValueFor(id: string, values: SourceValues): FieldValue | null {
  switch (id) {
    case 'link': return values.link;
    case 'path': return values.path;
    case 'fileName': return values.fileName;
    case 'fileType': return values.fileType;
    case 'fileSize': return values.fileSize;
    case 'fileCreated': return values.fileCreated;
    case 'fileUpdated': return values.fileUpdated;
    case 'pdfTitle': return values.pdfTitle;
    case 'pdfAuthor': return values.pdfAuthor;
    case 'pdfSubject': return values.pdfSubject;
    case 'pdfKeywords': return values.pdfKeywords;
    case 'pdfCreated': return values.pdfCreated;
    case 'pdfModified': return values.pdfModified;
    case 'pdfCreator': return values.pdfCreator;
    case 'pdfProducer': return values.pdfProducer;
    case 'pdfPages': return values.pdfPages;
    case 'doi': return values.doi;
    case 'isbn': return values.isbn;
    case 'lookupTitle': return values.lookupTitle;
    case 'lookupAuthor': return values.lookupAuthor;
    case 'lookupYear': return values.lookupYear;
    default: return null;
  }
}

function isEmpty(value: FieldValue): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  return value.trim().length === 0;
}

/**
 * Walk the field table in catalogue order and produce the rows to write.
 *
 * `skipEmpty` keeps creation output clean; the refresh flow passes false so
 * an empty extraction still shows up as a comparison row.
 */
export function resolveFields(
  group: MappingGroup,
  values: SourceValues,
  options: { skipEmpty?: boolean } = {},
): ResolvedField[] {
  const skipEmpty = options.skipEmpty ?? true;
  const rows: ResolvedField[] = [];
  const claimed = new Set<string>();

  for (const def of FIELD_DEFS) {
    const config = group.fields[def.id];
    if (!config?.enabled) continue;

    const property = (config.property || def.property).trim();
    if (!property) continue;

    let value: FieldValue;
    if (def.source === 'manual') {
      value = config.defaultValue ?? def.defaultValue ?? '';
    } else {
      const raw = rawValueFor(def.id, values);
      if (raw === null) continue;
      value = raw;
    }

    if (Array.isArray(value) && group.sanitizeListValues) {
      value = value.map(sanitizeListValue).filter(v => v.length > 0);
    }

    // Two fields can point at the same property (title from PDF, title from
    // CrossRef). First non-empty in catalogue order wins.
    if (claimed.has(property)) {
      const existing = rows.find(r => r.property === property);
      if (existing && !isEmpty(existing.value)) continue;
      if (isEmpty(value)) continue;
      if (existing) {
        existing.value = value;
        existing.id = def.id;
        existing.source = def.source;
      }
      continue;
    }

    if (skipEmpty && def.source !== 'manual' && isEmpty(value)) continue;

    claimed.add(property);
    rows.push({ id: def.id, property, source: def.source, value });
  }

  return rows;
}
