import type { FieldValue, ResolvedField } from './metadata-types';

export interface DiffRow {
  property: string;
  current: FieldValue | undefined;
  incoming: FieldValue;
  /** True when the two sides already agree. */
  unchanged: boolean;
  /** false = keep what the note has, true = take the extracted value. */
  takeIncoming: boolean;
}

export function formatValue(value: FieldValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function sameValue(a: FieldValue | undefined, b: FieldValue): boolean {
  return formatValue(a).trim() === formatValue(b).trim();
}

/**
 * Build the comparison table. Nothing is overwritten blindly: a property the
 * note already fills stays selected on the left, and only genuinely empty
 * slots default to the freshly extracted value.
 */
export function buildDiffRows(
  rows: ResolvedField[], frontmatter: Record<string, unknown> | undefined,
): DiffRow[] {
  return rows.map(row => {
    const current = frontmatter?.[row.property] as FieldValue | undefined;
    const unchanged = sameValue(current, row.value);
    const currentEmpty = formatValue(current).trim().length === 0;
    const incomingEmpty = formatValue(row.value).trim().length === 0;
    return {
      property: row.property,
      current,
      incoming: row.value,
      unchanged,
      takeIncoming: !unchanged && currentEmpty && !incomingEmpty,
    };
  });
}

/** Rows that the default comparison selection may safely fill automatically. */
export function autoFillableRows(rows: DiffRow[]): DiffRow[] {
  return rows.filter(row => !row.unchanged && row.takeIncoming);
}
