import { describe, expect, it } from 'vitest';
import {
  FIELD_DEFS, createGroup, defaultFieldConfigs, normalizeSettings, resolveFields,
  sanitizeListValue,
} from '../src/fields';
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

describe('defaults', () => {
  it('enables only the five core fields', () => {
    const enabled = Object.entries(defaultFieldConfigs())
      .filter(([, config]) => config.enabled)
      .map(([id]) => id)
      .sort();
    expect(enabled).toEqual(['fileCreated', 'fileUpdated', 'link', 'pdfAuthor', 'pdfTitle']);
  });
});

describe('resolveFields', () => {
  it('writes only enabled fields, under their configured names', () => {
    const group = createGroup();
    group.fields.pdfAuthor.property = 'by';
    group.fields.fileCreated.enabled = false;

    // pdfTitle is empty here, so it contributes no row.
    const rows = resolveFields(group, values);
    expect(rows.map(r => r.property)).toEqual(['attachment', 'updated', 'by']);
  });

  it('lets a later field fill a property the earlier one left empty', () => {
    const group = createGroup();
    group.fields.lookupTitle.enabled = true;

    const rows = resolveFields(group, { ...values, pdfTitle: '' });
    const title = rows.filter(r => r.property === 'title');
    expect(title).toHaveLength(1);
    expect(title[0].value).toBe('Neural networks and physical systems');
  });

  it('does not let an online result overwrite a value found in the PDF', () => {
    const group = createGroup();
    group.fields.lookupTitle.enabled = true;

    const rows = resolveFields(group, { ...values, pdfTitle: 'From the PDF' });
    expect(rows.find(r => r.property === 'title')?.value).toBe('From the PDF');
  });

  it('keeps empty rows when asked, for the comparison view', () => {
    const group = createGroup();
    const rows = resolveFields(group, values, { skipEmpty: false });
    expect(rows.find(r => r.id === 'pdfTitle')?.value).toBe('');
  });

  it('sanitizes list values when the group asks for it', () => {
    const group = createGroup();
    group.fields.pdfKeywords.enabled = true;
    expect(resolveFields(group, values).find(r => r.property === 'keywords')?.value)
      .toEqual(['neural-nets', 'memory']);

    group.sanitizeListValues = false;
    expect(resolveFields(group, values).find(r => r.property === 'keywords')?.value)
      .toEqual(['neural nets', 'memory!']);
  });

  it('writes manual fields even when their value is empty', () => {
    const group = createGroup();
    group.fields.genre.enabled = true;
    expect(resolveFields(group, values).find(r => r.property === 'genre')?.value).toBe('');
  });

  it('can write every field in the catalogue', () => {
    const group = createGroup();
    for (const config of Object.values(group.fields)) config.enabled = true;
    // Give the two "shares a property" pairs their own names for this check.
    group.fields.lookupTitle.property = 'onlineTitle';
    group.fields.lookupAuthor.property = 'onlineAuthor';

    const rows = resolveFields(group, { ...values, pdfTitle: 'T' }, { skipEmpty: false });
    expect(rows).toHaveLength(FIELD_DEFS.length);
    expect(rows.find(r => r.property === 'fileSize')?.value).toBe(1024);
    expect(rows.find(r => r.property === 'pages')?.value).toBe(5);
    expect(rows.find(r => r.property === 'doi')?.value).toBe('10.1073/pnas.79.8.2554');
    expect(rows.find(r => r.property === 'status')?.value).toBe('unread');
  });

  it('skips a field whose property name was cleared', () => {
    const group = createGroup();
    group.fields.link.property = '   ';
    expect(resolveFields(group, values).some(r => r.id === 'link')).toBe(false);
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
      mirrorFolderStructure: true,
    });

    expect(settings.groups).toHaveLength(1);
    const group = settings.groups[0];
    expect(group.attachmentsFolder).toBe('70_research/PDF');
    expect(group.notesFolder).toBe('70_research');
    expect(group.watchedExtensions).toEqual(['.pdf', '.epub']);
    expect(group.fields.pdfKeywords).toEqual({ enabled: true, property: 'topics' });
  });

  it('fills in fields added after the config was written', () => {
    const settings = normalizeSettings({
      version: 2,
      groups: [{ id: 'g1', name: 'old', fields: { link: { enabled: false, property: 'src' } } }],
    });
    expect(settings.groups[0].fields.link).toEqual({ enabled: false, property: 'src' });
    expect(settings.groups[0].fields.pdfTitle.property).toBe('title');
  });

  it('falls back to a default group for empty or unusable data', () => {
    expect(normalizeSettings(null).groups).toHaveLength(1);
    expect(normalizeSettings({}).groups).toHaveLength(1);
  });
});
