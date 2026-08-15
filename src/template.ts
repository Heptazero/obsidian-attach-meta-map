import { FieldValue, ResolvedField } from './sources';

/** `<% ... %>` / `<%* ... %>` — Templater syntax we deliberately do not run. */
const TEMPLATER_BLOCK = /<%[\s\S]*?%>/g;

const TOP_LEVEL_KEY = /^([^\s#:][^:]*):(.*)$/;

export interface ParsedTemplate {
  /** Frontmatter lines, without the --- fences. */
  frontmatterLines: string[];
  /** Top-level property names, in template order. */
  keys: string[];
  body: string;
  /** How many Templater blocks were dropped. */
  templaterBlocks: number;
}

export function parseTemplate(raw: string): ParsedTemplate {
  const blocks = raw.match(TEMPLATER_BLOCK)?.length ?? 0;
  const text = raw.replace(TEMPLATER_BLOCK, '').replace(/^\s*\n/, '');

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) {
    return { frontmatterLines: [], keys: [], body: text.trimStart(), templaterBlocks: blocks };
  }

  const frontmatterLines = match[1].split(/\r?\n/);
  const keys: string[] = [];
  for (const line of frontmatterLines) {
    const key = TOP_LEVEL_KEY.exec(line)?.[1];
    if (key && !key.startsWith(' ')) keys.push(key.trim());
  }

  return {
    frontmatterLines,
    keys,
    body: text.slice(match[0].length),
    templaterBlocks: blocks,
  };
}

/** Property names a template offers, for the mapping suggestions. */
export function templateKeys(raw: string): string[] {
  return parseTemplate(raw).keys;
}

function needsQuotes(value: string): boolean {
  return value === '' || /^[[{>|*&!%@`'"-]|[:#]\s|\s$|^\s/.test(value) || /[\r\n]/.test(value);
}

function serializeScalar(value: string | number): string {
  if (typeof value === 'number') return String(value);
  return needsQuotes(value) ? JSON.stringify(value) : value;
}

export function serializeValue(key: string, value: FieldValue): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []`];
    return [`${key}:`, ...value.map(item => `  - ${serializeScalar(item)}`)];
  }
  return [`${key}: ${serializeScalar(value)}`];
}

/** Lines that belong to the key on `lines[index]` (its indented block). */
function blockLength(lines: string[], index: number): number {
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') { end++; continue; }
    if (/^\s/.test(line)) { end++; continue; }
    break;
  }
  return end - index;
}

export interface RenderedNote {
  content: string;
  /** Properties the template offers. */
  keys: string[];
  templaterBlocks: number;
}

/**
 * Build the note: the template's own frontmatter, with the mapped properties
 * filled in. Values the template already carries (type: paper, status: …) are
 * left exactly as written.
 */
export function renderNote(
  template: ParsedTemplate, rows: ResolvedField[], appendBody: string,
  options: { dropUnfilledKeys?: boolean } = {},
): RenderedNote {
  const byProperty = new Map(rows.map(row => [row.property, row.value]));
  const out: string[] = [];

  for (let i = 0; i < template.frontmatterLines.length; i++) {
    const line = template.frontmatterLines[i];
    const key = TOP_LEVEL_KEY.exec(line)?.[1]?.trim();

    if (!key || !byProperty.has(key)) {
      // The built-in template is just a key list, so an unfilled key there is
      // noise; a real template's own lines are always kept.
      if (key && options.dropUnfilledKeys) {
        i += blockLength(template.frontmatterLines, i) - 1;
        continue;
      }
      out.push(line);
      continue;
    }

    out.push(...serializeValue(key, byProperty.get(key) as FieldValue));
    i += blockLength(template.frontmatterLines, i) - 1;
  }

  const frontmatter = out.length > 0 ? ['---', ...out, '---', ''] : [];
  const body = [template.body.replace(/\s+$/, ''), appendBody]
    .filter(part => part.length > 0)
    .join('\n\n');

  return {
    content: [...frontmatter, body].filter(part => part.length > 0).join('\n')
      .replace(/\n{3,}/g, '\n\n') + '\n',
    keys: template.keys,
    templaterBlocks: template.templaterBlocks,
  };
}

/** Template used when a group points at no template file. */
export function builtinTemplate(keys: string[]): ParsedTemplate {
  return {
    frontmatterLines: keys.map(key => `${key}:`),
    keys,
    body: '',
    templaterBlocks: 0,
  };
}
