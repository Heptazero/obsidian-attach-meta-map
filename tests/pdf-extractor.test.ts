import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { EMPTY_PDF_METADATA, PdfMetadataExtractor, parseCrossRefLookup, parseOpenLibraryLookup } from '../src/pdf-extractor';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('PDF text task lifecycle', () => {
  function harness(options: { loadFailure?: boolean; textFailure?: boolean; releaseFailure?: boolean; documentFallback?: boolean } = {}) {
    const page = { getTextContent: vi.fn(async () => {
      if (options.textFailure) throw new Error('Text unavailable');
      return { items: [{ str: 'DOI 10.1234/paper' }] };
    }) };
    const doc = { numPages: 3, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
    const destroy = vi.fn(async () => { if (options.releaseFailure) throw new Error('Release failed'); });
    const getDocument = vi.fn(() => ({
      promise: options.loadFailure ? Promise.reject(new Error('Load failed')) : Promise.resolve(doc),
      ...(options.documentFallback ? {} : { destroy }),
    }));
    vi.stubGlobal('pdfjsLib', { getDocument });
    const readBinary = vi.fn(async () => new ArrayBuffer(4));
    const extractor = new PdfMetadataExtractor({ vault: { readBinary } } as unknown as App);
    const file = { path: 'Files/p.pdf', basename: 'p' } as TFile;
    return { extractor, file, doc, destroy, page, readBinary, getDocument };
  }

  it('releases only its own loading task after reading the first two pages', async () => {
    const h = harness();
    const result = await h.extractor.findIdentifiers(h.file, { ...EMPTY_PDF_METADATA });
    expect(result.doi).toBe('10.1234/paper');
    expect(h.doc.getPage).toHaveBeenCalledTimes(2);
    expect(h.destroy).toHaveBeenCalledTimes(1);
    expect(h.doc.destroy).not.toHaveBeenCalled();
  });

  it.each(['loadFailure', 'textFailure'] as const)('releases its task even on %s', async failure => {
    const h = harness({ [failure]: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await h.extractor.findIdentifiers(h.file, { ...EMPTY_PDF_METADATA })).toEqual({ doi: '', isbn: '' });
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not lose extracted identifiers when task destruction rejects', async () => {
    const h = harness({ releaseFailure: true });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await h.extractor.findIdentifiers(h.file, { ...EMPTY_PDF_METADATA })).doi).toBe('10.1234/paper');
    expect(log).toHaveBeenCalledWith('[Att Meta Map] Could not release PDF text task', expect.any(Error));
  });

  it('falls back to destroying its own document when no task destroy method is exposed', async () => {
    const h = harness({ documentFallback: true });
    await h.extractor.findIdentifiers(h.file, { ...EMPTY_PDF_METADATA });
    expect(h.doc.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not create or destroy any task when metadata already contains both identifiers', async () => {
    const h = harness();
    const meta = { ...EMPTY_PDF_METADATA, title: '10.1234/paper ISBN 9781234567890' };
    expect(await h.extractor.findIdentifiers(h.file, meta)).toEqual({ doi: '10.1234/paper', isbn: '9781234567890' });
    expect(h.getDocument).not.toHaveBeenCalled();
    expect(h.readBinary).not.toHaveBeenCalled();
    expect(h.destroy).not.toHaveBeenCalled();
  });
});

describe('network lookup response parsing', () => {
  it('parses a valid Crossref work', () => {
    expect(parseCrossRefLookup({
      message: {
        title: ['Memory paper'],
        author: [{ family: 'Hopfield', given: 'John' }, { name: 'Research Group' }],
        issued: { 'date-parts': [[1982, 4]] },
      },
    })).toEqual({
      title: 'Memory paper',
      author: 'Hopfield, John; Research Group',
      year: '1982',
    });
  });

  it('rejects malformed Crossref values without leaking unsafe data', () => {
    expect(parseCrossRefLookup({ message: { title: [42], author: 'unknown' } }))
      .toEqual({ title: '', author: '', year: '' });
    expect(parseCrossRefLookup(null)).toEqual({ title: '', author: '', year: '' });
  });

  it('parses and validates an Open Library book', () => {
    expect(parseOpenLibraryLookup({
      title: 'A Book', by_statement: 'A. Writer', publish_date: 'First published 2004',
    })).toEqual({ title: 'A Book', author: 'A. Writer', year: '2004' });
    expect(parseOpenLibraryLookup({ title: false, publish_date: 2020 }))
      .toEqual({ title: '', author: '', year: '' });
  });
});
