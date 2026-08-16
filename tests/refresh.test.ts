import { describe, expect, it } from 'vitest';
import { autoFillableRows, buildDiffRows, formatValue } from '../src/refresh-modal';
import { ResolvedField } from '../src/sources';

const row = (property: string, value: ResolvedField['value']): ResolvedField =>
  ({ id: property, property, kind: 'pdf', value });

describe('buildDiffRows', () => {
  it('marks identical values as unchanged', () => {
    const rows = buildDiffRows([row('title', 'A')], { title: 'A' });
    expect(rows[0].unchanged).toBe(true);
    expect(rows[0].takeIncoming).toBe(false);
  });

  it('defaults to the extracted value only when the note has none', () => {
    const [empty] = buildDiffRows([row('author', 'Hopfield')], {});
    expect(empty.takeIncoming).toBe(true);

    const [filled] = buildDiffRows([row('author', 'Hopfield')], { author: 'Hand written' });
    expect(filled.takeIncoming).toBe(false);
  });

  it('never proposes replacing a value with nothing', () => {
    const [blanked] = buildDiffRows([row('subject', '')], { subject: 'Physics' });
    expect(blanked.takeIncoming).toBe(false);
  });

  it('compares lists by their rendered form', () => {
    const rows = buildDiffRows([row('keywords', ['a', 'b'])], { keywords: ['a', 'b'] });
    expect(rows[0].unchanged).toBe(true);
  });

  it('formats values for display', () => {
    expect(formatValue(undefined)).toBe('');
    expect(formatValue(['a', 'b'])).toBe('a, b');
    expect(formatValue(12)).toBe('12');
  });

  it('proposes a row for a property the note is entirely missing, not just an empty one', () => {
    // frontmatter has no "year" key at all — the gap the batch upgrade targets.
    const [row] = buildDiffRows([{ id: 'fileNameYear', property: 'year', kind: 'vault', value: '2023' }], {});
    expect(row.unchanged).toBe(false);
    expect(row.takeIncoming).toBe(true);
  });
});

describe('autoFillableRows', () => {
  it('keeps only the rows the default selection would already take: empty on the note, non-empty incoming', () => {
    const rows = buildDiffRows([
      row('year', '2023'),      // missing on the note -> fillable
      row('author', 'Hopfield'), // already has a value -> not fillable
      row('subject', ''),        // nothing new to offer -> not fillable
    ], { author: 'Hand written' });

    expect(autoFillableRows(rows).map(r => r.property)).toEqual(['year']);
  });

  it('is what the modal itself starts with, so batch and manual agree', () => {
    const rows = buildDiffRows([row('year', '2023')], {});
    const changed = rows.filter(r => !r.unchanged);
    expect(autoFillableRows(rows)).toEqual(changed.filter(r => r.takeIncoming));
  });
});
