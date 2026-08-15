import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEMPLATE_KEYS, SOURCE_DEFS, defaultMapping, normalizeSettings, resolveFields,
  sanitizeListValue,
} from '../src/sources';
import { SourceValues } from '../src/types';

const values: SourceValues = {
  link: '[[a]]',
  path: 'PDF/a.pdf',
  fileName: 'a.pdf',
  basename: 'a',
  fileType: 'pdf',
  fileSize: 1024,
  fileCreated: '2026-01-01',
  fileUpdated: '2026-02-02',
  pdfTitle: '',
  pdfAuthor: 'Hopfield, J.',
  pdfSubject: '',
  pdfKeywords: ['neural nets', 'memory!'],
  pdfCreated: '1982-01-01',
  pdfModified: '',
  pdfCreator: '',
  pdfProducer: '',
  pdfPages: 5,
  doi: '10.1073/pnas.79.8.2554',
  isbn: '',
  lookupTitle: 'Neural networks and physical systems',
  lookupAuthor: '',
  lookupYear: '1982',
};

const allow = (...keys: string[]): { allowedProperties: string[] } => ({ allowedProperties: keys });

describe('resolveFields', () => {
  it('writes nothing for a property the template does not have', () => {
    const rows = resolveFields(defaultMapping(), values, allow('title'));
    expect(rows.map(row => row.property)).toEqual(['title']);
  });

  it('follows the mapping, not the source name', () => {
    const mapping = { ...defaultMapping(), pdfAuthor: 'by' };
    const rows = resolveFields(mapping, values, allow('by', 'author'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'pdfAuthor', property: 'by', value: 'Hopfield, J.' });
  });

  it('skips a source whose mapping is empty', () => {
    const mapping = { ...defaultMapping(), pdfAuthor: '' };
    expect(resolveFields(mapping, values, allow('author')).some(r => r.id === 'pdfAuthor'))
      .toBe(false);
  });

  it('lets an online result fill a property the PDF left empty', () => {
    const rows = resolveFields(defaultMapping(), values, allow('title'));
    expect(rows[0].value).toBe('Neural networks and physical systems');
    expect(rows[0].id).toBe('lookupTitle');
  });

  it('does not let an online result overwrite what the PDF provided', () => {
    const rows = resolveFields(defaultMapping(), { ...values, pdfTitle: 'From the PDF' }, allow('title'));
    expect(rows[0].value).toBe('From the PDF');
    expect(rows[0].id).toBe('pdfTitle');
  });

  it('keeps empty rows for the comparison view', () => {
    const rows = resolveFields(
      { ...defaultMapping(), pdfSubject: 'subject' },
      values,
      { allowedProperties: ['subject'], keepEmpty: true },
    );
    expect(rows[0].value).toBe('');
  });

  it('sanitizes list values unless told otherwise', () => {
    const mapping = { ...defaultMapping(), pdfKeywords: 'keywords' };
    expect(resolveFields(mapping, values, allow('keywords'))[0].value)
      .toEqual(['neural-nets', 'memory']);
    expect(resolveFields(mapping, values, { allowedProperties: ['keywords'], sanitizeLists: false })[0].value)
      .toEqual(['neural nets', 'memory!']);
  });

  it('carries numbers through', () => {
    const mapping = { ...defaultMapping(), pdfPages: 'pages', fileSize: 'size' };
    const rows = resolveFields(mapping, values, allow('pages', 'size'));
    expect(rows.find(r => r.property === 'pages')?.value).toBe(5);
    expect(rows.find(r => r.property === 'size')?.value).toBe(1024);
  });

  it('covers the built-in key set with default mapping', () => {
    const rows = resolveFields(defaultMapping(), { ...values, pdfTitle: 'T' },
      allow(...BUILTIN_TEMPLATE_KEYS));
    expect(rows.map(r => r.property).sort())
      .toEqual(['attachment', 'author', 'created', 'title', 'updated']);
  });

  it('can read every source when each gets its own property', () => {
    const mapping = Object.fromEntries(SOURCE_DEFS.map(def => [def.id, def.id]));
    const rows = resolveFields(mapping, { ...values, pdfTitle: 'T' }, {
      allowedProperties: SOURCE_DEFS.map(def => def.id),
      keepEmpty: true,
    });

    expect(rows).toHaveLength(SOURCE_DEFS.length);
    expect(rows.find(r => r.property === 'path')?.value).toBe('PDF/a.pdf');
    expect(rows.find(r => r.property === 'fileName')?.value).toBe('a.pdf');
    expect(rows.find(r => r.property === 'fileType')?.value).toBe('pdf');
    expect(rows.find(r => r.property === 'pdfCreated')?.value).toBe('1982-01-01');
    expect(rows.find(r => r.property === 'lookupYear')?.value).toBe('1982');
  });

  it('ignores a mapping for a source that no longer exists', () => {
    const rows = resolveFields({ ghost: 'ghost' }, values, allow('ghost'));
    expect(rows).toEqual([]);
  });

  it('keeps CJK characters when sanitizing', () => {
    expect(sanitizeListValue(' 神经 网络 ')).toBe('神经-网络');
  });
});

describe('settings migration', () => {
  it('turns an Attachments Library config into one group', () => {
    const settings = normalizeSettings({
      attachmentsFolder: '70_research/PDF',
      libraryFolder: '70_research',
      watchedExtensions: ['.pdf', '.epub'],
      tagsPropertyName: 'topics',
    });

    expect(settings.groups).toHaveLength(1);
    expect(settings.groups[0].attachmentsFolder).toBe('70_research/PDF');
    expect(settings.groups[0].notesFolder).toBe('70_research');
    expect(settings.groups[0].name).toBe('PDF');
    expect(settings.mapping.pdfKeywords).toBe('topics');
  });

  it('collapses a per-group field table into the global mapping', () => {
    const settings = normalizeSettings({
      version: 2,
      groups: [{
        id: 'g1',
        name: 'Papers',
        attachmentsFolder: 'A',
        notesFolder: 'B',
        fields: {
          pdfAuthor: { enabled: true, property: 'by' },
          pdfSubject: { enabled: false, property: 'subject' },
        },
      }],
    });

    expect(settings.mapping.pdfAuthor).toBe('by');
    // Explicitly switched off in v2 -> unmapped now, rather than silently back on.
    expect(settings.mapping.pdfSubject).toBe('');
    // Sources the v2 table never mentioned keep their default mapping.
    expect(settings.mapping.pdfTitle).toBe('title');
    expect(settings.groups[0]).not.toHaveProperty('fields');
    expect(settings.groups[0].templatePath).toBe('');
  });

  it('keeps a v3 config as it is', () => {
    const settings = normalizeSettings({
      version: 3,
      language: 'zh',
      mapping: { pdfTitle: '标题' },
      extraTemplateFolders: ['99_assets/template'],
      groups: [{ id: 'g1', name: 'P', attachmentsFolder: 'A', notesFolder: 'B', templatePath: 'T.md' }],
    });

    expect(settings.language).toBe('zh');
    expect(settings.mapping.pdfTitle).toBe('标题');
    expect(settings.mapping.pdfAuthor).toBe('author');
    expect(settings.extraTemplateFolders).toEqual(['99_assets/template']);
    expect(settings.groups[0].templatePath).toBe('T.md');
  });

  it('falls back to defaults for empty or unusable data', () => {
    expect(normalizeSettings(null).groups).toHaveLength(1);
    expect(normalizeSettings({}).mapping).toEqual(defaultMapping());
  });
});
