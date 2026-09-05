import { SourceDefinition, SourceValues } from './types';
import type { FieldValue, ResolvedField, ResolveOptions } from './metadata-types';

/**
 * Everything this plugin can read. Which of these actually reach a note is
 * decided twice over: the mapping must name a property, and the group's
 * template must contain that property.
 */
export const SOURCE_DEFS: SourceDefinition[] = [
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
export const BUILTIN_TEMPLATE_KEYS = ['source', 'title', 'author', 'created', 'updated'];

export function sanitizeListValue(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_/一-鿿]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function rawValueFor(id: string, values: SourceValues): FieldValue | null {
  switch (id) {
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
