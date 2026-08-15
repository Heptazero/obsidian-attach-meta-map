import { describe, expect, it } from 'vitest';
import { buildDiffRows, formatValue } from '../src/refresh-modal';
import { ResolvedField } from '../src/fields';

const row = (property: string, value: ResolvedField['value']): ResolvedField =>
  ({ id: property, property, source: 'pdf', value });

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
});
