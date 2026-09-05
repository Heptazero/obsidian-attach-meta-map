import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEMPLATE_KEYS, SOURCE_DEFS, createGroup, defaultMapping, groupCreatesNotes,
  normalizeSettings, resolveFields, sanitizeListValue,
} from '../src/sources';
import { SourceValues } from '../src/types';

const values: SourceValues = {
  path: 'PDF/a.pdf',
  fileName: 'a.pdf',
  basename: 'a',
  fileType: 'pdf',
  fileSize: 1024,
  fileCreated: '2026-01-01',
  fileUpdated: '2026-02-02',
  fileNameYear: '',
  fileNameTitle: 'a',
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

  it('prefers the year parsed from the file name over the online lookup', () => {
    const rows = resolveFields(defaultMapping(), { ...values, fileNameYear: '2023' }, allow('year'));
    expect(rows).toEqual([{ id: 'fileNameYear', property: 'year', kind: 'vault', value: '2023' }]);
  });

  it('falls back to the online lookup when the file name has no year', () => {
    // values.fileNameYear is '' in the fixture — the name did not match "A - YYYY - T".
    const rows = resolveFields(defaultMapping(), values, allow('year'));
    expect(rows).toEqual([{ id: 'lookupYear', property: 'year', kind: 'lookup', value: '1982' }]);
  });

  it('covers the mapped built-in metadata keys; source is maintained separately', () => {
    const rows = resolveFields(defaultMapping(), { ...values, pdfTitle: 'T' },
      allow(...BUILTIN_TEMPLATE_KEYS));
    expect(rows.map(r => r.property).sort())
      .toEqual(['author', 'created', 'title', 'updated']);
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

describe('current settings shape', () => {
  it('treats sidecar as note-backed even after folder-only mode was selected', () => {
    expect(groupCreatesNotes(createGroup({ layout: 'sidecar', createNoteFile: false }))).toBe(true);
    expect(groupCreatesNotes(createGroup({ layout: 'folder', createNoteFile: false }))).toBe(false);
    expect(createGroup()).not.toHaveProperty('autoDeleteOnRemove');
  });

  it('keeps a current sidecar group', () => {
    const settings = normalizeSettings({
      version: 4,
      groups: [{
        layout: 'sidecar', resourceFolder: '70_research/PDF', noteFolder: '70_research',
        watchedExtensions: ['.pdf', '.epub'],
      }],
    });

    expect(settings.groups).toHaveLength(1);
    expect(settings.groups[0]).toMatchObject({
      layout: 'sidecar', resourceFolder: '70_research/PDF', noteFolder: '70_research',
      watchedExtensions: ['.pdf', '.epub'],
    });
  });

  it('keeps a folder group with only one collection path', () => {
    const settings = normalizeSettings({
      version: 4,
      groups: [{
        id: 'g1', name: 'Papers', layout: 'folder', collectionFolder: 'Library',
        attachmentDepth: 2,
        attachmentsFolder: 'old-a', notesFolder: 'old-b', autoDeleteOnRemove: true,
      }],
    });

    expect(settings.groups[0]).toMatchObject({
      id: 'g1', layout: 'folder', collectionFolder: 'Library', attachmentDepth: 2,
    });
    expect(settings.groups[0]).not.toHaveProperty('attachmentsFolder');
    expect(settings.groups[0]).not.toHaveProperty('notesFolder');
    expect(settings.groups[0]).not.toHaveProperty('autoDeleteOnRemove');
    expect(settings.groups[0]).not.toHaveProperty('mirrorFolderStructure');
  });

  it('repairs a link template that would point at the note itself', () => {
    const settings = normalizeSettings({
      version: 4,
      groups: [{
        id: 'g1', name: 'P', layout: 'sidecar', resourceFolder: 'A', noteFolder: 'B',
        noteNameTemplate: '{{basename}}', linkTemplate: '[[{{basename}}]]',
      }],
    });
    expect(settings.groups[0].linkTemplate).toBe('[[{{name}}]]');
  });

  it('keeps current language, mapping, template folders and group settings', () => {
    const settings = normalizeSettings({
      version: 4,
      language: 'zh',
      mapping: { pdfTitle: '标题' },
      extraTemplateFolders: ['99_assets/template'],
      groups: [{
        id: 'g1', name: 'P', layout: 'sidecar', resourceFolder: 'A', noteFolder: 'B',
        templatePath: 'T.md',
      }],
      attachmentRules: [{
        id: 'r1', name: 'PDF', extensions: ['PDF'], destinationFolder: '/Papers/',
      }],
    });

    expect(settings.language).toBe('zh');
    expect(settings.mapping.pdfTitle).toBe('标题');
    expect(settings.mapping.pdfAuthor).toBe('author');
    expect(settings.extraTemplateFolders).toEqual(['99_assets/template']);
    expect(settings.groups[0].templatePath).toBe('T.md');
    expect(settings.attachmentRules[0]).toMatchObject({
      id: 'r1', name: 'PDF', extensions: ['.pdf'], destinationFolder: 'Papers',
    });
  });

  it('does not interpret retired settings shapes', () => {
    expect(normalizeSettings(null).groups).toHaveLength(1);
    expect(normalizeSettings({}).mapping).toEqual(defaultMapping());
    expect(normalizeSettings({
      version: 3,
      groups: [{ attachmentsFolder: 'A', notesFolder: 'B' }],
    }).groups[0]).toMatchObject({ layout: 'sidecar', resourceFolder: 'Attachments' });
  });
});
