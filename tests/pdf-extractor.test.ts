import { describe, expect, it } from 'vitest';
import { parseCrossRefLookup, parseOpenLibraryLookup } from '../src/pdf-extractor';

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
