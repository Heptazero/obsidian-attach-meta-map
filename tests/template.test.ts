import { describe, expect, it } from 'vitest';
import { builtinTemplate, parseTemplate, renderNote, serializeValue } from '../src/template';
import { ResolvedField } from '../src/sources';

const row = (property: string, value: ResolvedField['value']): ResolvedField =>
  ({ id: property, property, kind: 'pdf', value });

// The vault's own paper template.
const PAPER = `---
aliases: [论文英文标题, 常用缩写]
type: paper
year:
doi:
---
初读印象:(读完摘要立刻写)

## 三问
- 主线:这篇工作真正要解决的问题是什么?
`;

// The vault's book template, which opens with a Templater block.
const BOOK = `<%*
await tp.file.move("20_self/25_record/" + tp.file.title)
%>
---
type: book
aliases: []
by:
status: active
---

## 摘录
`;

describe('parseTemplate', () => {
  it('reads the top-level keys in template order', () => {
    expect(parseTemplate(PAPER).keys).toEqual(['aliases', 'type', 'year', 'doi']);
  });

  it('sees through a leading Templater block and counts it', () => {
    const parsed = parseTemplate(BOOK);
    expect(parsed.keys).toEqual(['type', 'aliases', 'by', 'status']);
    expect(parsed.templaterBlocks).toBe(1);
    expect(parsed.body).toContain('## 摘录');
    expect(parsed.body).not.toContain('tp.file.move');
  });

  it('handles a template with no frontmatter', () => {
    const parsed = parseTemplate('just a body\n');
    expect(parsed.keys).toEqual([]);
    expect(parsed.body).toBe('just a body\n');
  });
});

describe('serializeValue', () => {
  it('quotes what YAML would otherwise misread', () => {
    expect(serializeValue('attachment', '[[a]]')).toEqual(['attachment: "[[a]]"']);
    expect(serializeValue('title', 'Plain title')).toEqual(['title: Plain title']);
    expect(serializeValue('title', 'A: B')).toEqual(['title: "A: B"']);
    expect(serializeValue('pages', 12)).toEqual(['pages: 12']);
  });

  it('writes lists as blocks', () => {
    expect(serializeValue('keywords', ['a', 'b'])).toEqual(['keywords:', '  - a', '  - b']);
    expect(serializeValue('keywords', [])).toEqual(['keywords: []']);
  });
});

describe('renderNote', () => {
  it('fills mapped keys and leaves the rest of the template alone', () => {
    const rendered = renderNote(
      parseTemplate(PAPER),
      [row('year', '1982'), row('doi', '10.1073/pnas.79.8.2554')],
      '![[a.pdf]]',
    );

    expect(rendered.content).toContain('year: 1982');
    expect(rendered.content).toContain('doi: 10.1073/pnas.79.8.2554');
    // Untouched template lines survive verbatim.
    expect(rendered.content).toContain('aliases: [论文英文标题, 常用缩写]');
    expect(rendered.content).toContain('type: paper');
    expect(rendered.content).toContain('## 三问');
    expect(rendered.content.trimEnd().endsWith('![[a.pdf]]')).toBe(true);
  });

  it('ignores values whose property is not in the template', () => {
    const rendered = renderNote(parseTemplate(PAPER), [row('subject', 'Physics')], '');
    expect(rendered.content).not.toContain('subject');
  });

  it('replaces a multi-line value without leaving its old lines behind', () => {
    const template = parseTemplate('---\nkeywords:\n  - old\n  - stale\ntype: x\n---\nbody\n');
    const rendered = renderNote(template, [row('keywords', ['new'])], '');
    expect(rendered.content).toContain('  - new');
    expect(rendered.content).not.toContain('old');
    expect(rendered.content).toContain('type: x');
  });

  it('drops unfilled keys only for the built-in template', () => {
    const builtin = builtinTemplate(['attachment', 'title', 'author']);
    const rendered = renderNote(builtin, [row('title', 'T')], '', { dropUnfilledKeys: true });
    expect(rendered.content).toContain('title: T');
    expect(rendered.content).not.toContain('author');

    const kept = renderNote(builtin, [row('title', 'T')], '');
    expect(kept.content).toContain('author:');
  });

  it('reports the Templater blocks it refused to run', () => {
    expect(renderNote(parseTemplate(BOOK), [], '').templaterBlocks).toBe(1);
  });
});
