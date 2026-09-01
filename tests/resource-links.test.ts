import { describe, expect, it } from 'vitest';
import {
  appendSourceLink, auxiliaryPrefixes, sourceLinkTargets, stripAuxiliaryPrefix,
} from '../src/resource-links';

describe('source relation', () => {
  it('reads scalar and list-valued source links', () => {
    expect(sourceLinkTargets('[[paper-en.pdf]]')).toEqual(['paper-en.pdf']);
    expect(sourceLinkTargets(['[[paper-en.pdf]]', '[[folder/paper-zh.pdf|中文]]']))
      .toEqual(['paper-en.pdf', 'folder/paper-zh.pdf']);
  });

  it('promotes one source to a list and avoids duplicates', () => {
    expect(appendSourceLink('[[paper-en.pdf]]', '[[paper-zh.pdf]]'))
      .toEqual(['[[paper-en.pdf]]', '[[paper-zh.pdf]]']);
    expect(appendSourceLink(['[[paper-en.pdf]]'], '[[paper-en.pdf]]'))
      .toEqual(['[[paper-en.pdf]]']);
  });
});

describe('auxiliary prefixes', () => {
  it('accepts several prefixes and prefers the longest match', () => {
    expect(auxiliaryPrefixes('cn_, zh_；slides_')).toEqual(['slides_', 'cn_', 'zh_']);
    expect(stripAuxiliaryPrefix('cn_paper.pdf', 'c_, cn_')).toBe('paper.pdf');
    expect(stripAuxiliaryPrefix('paper.pdf', 'cn_, zh_')).toBeNull();
  });
});
