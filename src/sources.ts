import {
  AttMetaMapSettings, MappingGroup, SETTINGS_VERSION, SourceDefinition, SourceKind, SourceValues,
} from './types';
import { renderTemplate, templateVars } from './paths';

/**
 * `[[{{basename}}]]` next to a note named `{{basename}}` points the link at
 * the note itself, because Obsidian resolves an extensionless link to the
 * markdown file first. Rewrite that combination to carry the extension.
 */
export function unambiguousLinkTemplate(group: MappingGroup): string {
  const vars = templateVars('folder/sample.pdf');
  const link = renderTemplate(group.linkTemplate, vars);
  const inner = /\[\[([^\]|#]+)/.exec(link)?.[1]?.trim();
  const noteName = renderTemplate(group.noteNameTemplate, vars).trim();

  if (!inner || inner !== noteName) return group.linkTemplate;
  return group.linkTemplate.replace('{{basename}}', '{{name}}');
}

/**
 * Everything this plugin can read. Which of these actually reach a note is
 * decided twice over: the mapping must name a property, and the group's
 * template must contain that property.
 */
export const SOURCE_DEFS: SourceDefinition[] = [
  { id: 'link',        kind: 'vault', value: 'link',   property: 'attachment' },
  { id: 'path',        kind: 'vault', value: 'text',   property: '' },
  { id: 'fileName',    kind: 'vault', value: 'text',   property: '' },
  { id: 'fileType',    kind: 'vault', value: 'text',   property: '' },
  { id: 'fileSize',    kind: 'vault', value: 'number', property: '' },
  { id: 'fileCreated', kind: 'vault', value: 'date',   property: 'created' },
  { id: 'fileUpdated', kind: 'vault', value: 'date',   property: 'updated' },
  { id: 'fileNameYear',  kind: 'vault', value: 'text', property: 'year' },
  { id: 'fileNameTitle', kind: 'vault', value: 'text', property: '' },

  { id: 'pdfTitle',    kind: 'pdf', value: 'text',   property: 'title' },
  { id: 'pdfAuthor',   kind: 'pdf', value: 'text',   property: 'author' },
  { id: 'pdfSubject',  kind: 'pdf', value: 'text',   property: '' },
  { id: 'pdfKeywords', kind: 'pdf', value: 'list',   property: '' },
  { id: 'pdfCreated',  kind: 'pdf', value: 'date',   property: '' },
  { id: 'pdfModified', kind: 'pdf', value: 'date',   property: '' },
  { id: 'pdfCreator',  kind: 'pdf', value: 'text',   property: '' },
  { id: 'pdfProducer', kind: 'pdf', value: 'text',   property: '' },
  { id: 'pdfPages',    kind: 'pdf', value: 'number', property: '' },

  { id: 'doi',          kind: 'lookup', value: 'text', property: 'doi' },
  { id: 'isbn',         kind: 'lookup', value: 'text', property: '' },
  { id: 'lookupTitle',  kind: 'lookup', value: 'text', property: 'title' },
  { id: 'lookupAuthor', kind: 'lookup', value: 'text', property: 'author' },
  { id: 'lookupYear',   kind: 'lookup', value: 'text', property: 'year' },
];

export const SOURCE_DEF_BY_ID: Record<string, SourceDefinition> =
  Object.fromEntries(SOURCE_DEFS.map(def => [def.id, def]));

/** Properties written when a group has no template of its own. */
export const BUILTIN_TEMPLATE_KEYS = ['attachment', 'title', 'author', 'created', 'updated'];

export function defaultMapping(): Record<string, string> {
  return Object.fromEntries(SOURCE_DEFS.map(def => [def.id, def.property]));
}

let groupCounter = 0;

export function createGroup(partial: Partial<MappingGroup> = {}): MappingGroup {
  groupCounter++;
  return {
    id: `g${Date.now().toString(36)}${groupCounter.toString(36)}`,
    name: 'New group',
    layout: 'sidecar',
    attachmentsFolder: 'Attachments',
    notesFolder: 'Library',
    watchedExtensions: ['.pdf'],
    mirrorFolderStructure: true,
    templatePath: '',
    noteNameTemplate: '{{basename}}',
    linkTemplate: '[[{{name}}]]',
    embedAttachment: false,
    autoCreateOnNew: true,
    autoDeleteOnRemove: true,
    syncUpdatedOnModify: true,
    enablePdfMetadataExtraction: true,
    enableDoiIsbnLookup: false,
    sanitizeListValues: true,
    autoCreateBaseFile: false,
    baseFolderPath: '',
    ...partial,
  };
}

export function defaultSettings(): AttMetaMapSettings {
  return {
    version: SETTINGS_VERSION,
    language: 'auto',
    mapping: defaultMapping(),
    extraTemplateFolders: [],
    groups: [createGroup({ name: 'Attachments' })],
  };
}

interface LegacyV1 {
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

interface LegacyV2Group extends Partial<MappingGroup> {
  fields?: Record<string, { enabled?: boolean; property?: string }>;
}

/**
 * Reads v1 (Attachments Library), v2 (per-group field tables) and v3 configs.
 * A v2 field table collapses into the global mapping: the first group that
 * enabled a source decides where that source lands.
 */
export function normalizeSettings(raw: unknown): AttMetaMapSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings();

  const candidate = raw as Partial<AttMetaMapSettings> & LegacyV1 & {
    groups?: LegacyV2Group[];
  };

  if (Array.isArray(candidate.groups)) {
    const mapping = { ...defaultMapping(), ...(candidate.mapping ?? {}) };

    // A v2 field table said both "where" and "whether". The template now
    // answers "whether", so only the "where" survives — and a source every
    // group had switched off loses its mapping, matching what was intended.
    const seen = new Set<string>();
    const enabled = new Set<string>();
    for (const group of candidate.groups) {
      for (const [id, config] of Object.entries(group.fields ?? {})) {
        if (!SOURCE_DEF_BY_ID[id]) continue;
        seen.add(id);
        if (!config?.enabled) continue;
        enabled.add(id);
        mapping[id] = (config.property ?? mapping[id] ?? '').trim();
      }
    }
    for (const id of seen) {
      if (!enabled.has(id)) mapping[id] = '';
    }

    const groups = candidate.groups.map(group => {
      const clean = { ...createGroup(), ...group };
      delete (clean as LegacyV2Group).fields;
      clean.linkTemplate = unambiguousLinkTemplate(clean);
      return clean;
    });

    return {
      version: SETTINGS_VERSION,
      language: candidate.language ?? 'auto',
      mapping,
      extraTemplateFolders: candidate.extraTemplateFolders ?? [],
      groups: groups.length ? groups : defaultSettings().groups,
    };
  }

  if (!candidate.attachmentsFolder && !candidate.libraryFolder) return defaultSettings();

  const mapping = defaultMapping();
  if (candidate.tagsPropertyName) mapping.pdfKeywords = candidate.tagsPropertyName;

  return {
    version: SETTINGS_VERSION,
    language: 'auto',
    mapping,
    extraTemplateFolders: [],
    groups: [createGroup({
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
    })],
  };
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

export interface ResolvedField {
  /** Source that produced the value. */
  id: string;
  property: string;
  kind: SourceKind;
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
    case 'fileNameYear': return values.fileNameYear;
    case 'fileNameTitle': return values.fileNameTitle;
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

export function isEmptyValue(value: FieldValue | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  return value.trim().length === 0;
}

export interface ResolveOptions {
  /** Only these properties are considered; usually the template's keys. */
  allowedProperties: string[];
  sanitizeLists?: boolean;
  /** Keep rows whose value is empty (the comparison view wants them). */
  keepEmpty?: boolean;
}

/**
 * Turn raw values into the rows to write: mapping decides the name, the
 * template decides whether that name is wanted at all.
 */
export function resolveFields(
  mapping: Record<string, string>,
  values: SourceValues,
  options: ResolveOptions,
): ResolvedField[] {
  const allowed = new Set(options.allowedProperties);
  const rows: ResolvedField[] = [];

  for (const def of SOURCE_DEFS) {
    const property = (mapping[def.id] ?? '').trim();
    if (!property || !allowed.has(property)) continue;

    let value = rawValueFor(def.id, values);
    if (value === null) continue;

    if (Array.isArray(value) && (options.sanitizeLists ?? true)) {
      value = value.map(sanitizeListValue).filter(item => item.length > 0);
    }

    const existing = rows.find(row => row.property === property);
    if (existing) {
      // Several sources may share a property (PDF title, CrossRef title).
      // The first non-empty one in catalogue order wins.
      if (isEmptyValue(existing.value) && !isEmptyValue(value)) {
        existing.value = value;
        existing.id = def.id;
        existing.kind = def.kind;
      }
      continue;
    }

    if (!options.keepEmpty && isEmptyValue(value)) continue;
    rows.push({ id: def.id, property, kind: def.kind, value });
  }

  return rows;
}
