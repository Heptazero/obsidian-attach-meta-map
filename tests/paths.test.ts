import { describe, expect, it } from 'vitest';
import { createGroup } from '../src/sources';
import {
  attachmentCandidates, cleanFolder, groupForAttachment, groupForNote, linkFor,
  notePathCandidates, relativeTo, renderTemplate, templateVars,
} from '../src/paths';

const papers = createGroup({
  name: 'Papers',
  attachmentsFolder: '70_research/PDF',
  notesFolder: '70_research',
  watchedExtensions: ['.pdf'],
});

const clips = createGroup({
  name: 'Clips',
  attachmentsFolder: '98_clip/files',
  notesFolder: '98_clip/notes',
  watchedExtensions: ['.png', '.pdf'],
});

describe('templateVars year/title parsing', () => {
  it('splits real Zotero export names into year and title', () => {
    const cases: [string, string, string][] = [
      ['Hu 等 - 2025 - Nonparametric Modern Hopfield Models.pdf', '2025', 'Nonparametric Modern Hopfield Models'],
      ['Bao和Zhao - 2025 - Binary associative memory networks A review of mathematical framework and capacity analysis.pdf',
       '2025', 'Binary associative memory networks A review of mathematical framework and capacity analysis'],
      ['Hopfield - 1982 - Neural networks and physical systems with emergent collective computational abilities..pdf',
       '1982', 'Neural networks and physical systems with emergent collective computational abilities.'],
      ['Ramsauer 等 - 2021 - Hopfield Networks is All You Need.pdf', '2021', 'Hopfield Networks is All You Need'],
    ];
    for (const [file, year, title] of cases) {
      const vars = templateVars(`70_research/PDF/${file}`);
      expect(vars.year).toBe(year);
      expect(vars.title).toBe(title);
    }
  });

  it('falls back to the full basename when the pattern is absent', () => {
    const vars = templateVars('70_research/PDF/random-notes.pdf');
    expect(vars.year).toBe('');
    expect(vars.title).toBe('random-notes');
  });

  it('takes the first "- YYYY -" when a title also contains the pattern', () => {
    const vars = templateVars('70_research/PDF/A - 2020 - B - 2021 - C.pdf');
    expect(vars.year).toBe('2020');
    expect(vars.title).toBe('B - 2021 - C');
  });

  it('lets a note name template combine them as year-title', () => {
    const group = createGroup({
      attachmentsFolder: '70_research/PDF', notesFolder: '70_research',
      watchedExtensions: ['.pdf'], noteNameTemplate: '{{year}}-{{title}}',
    });
    const { primary } = notePathCandidates(group, '70_research/PDF/Hu 等 - 2025 - Nonparametric Modern Hopfield Models.pdf');
    expect(primary).toBe('70_research/2025-Nonparametric Modern Hopfield Models.md');
  });
});

describe('folder helpers', () => {
  it('strips slashes', () => {
    expect(cleanFolder('/a/b/')).toBe('a/b');
    expect(cleanFolder('a//b')).toBe('a/b');
  });

  it('makes paths relative', () => {
    expect(relativeTo('70_research/PDF/nn/a.pdf', '70_research/PDF')).toBe('nn/a.pdf');
    expect(relativeTo('elsewhere/a.pdf', '70_research/PDF')).toBe('elsewhere/a.pdf');
  });

  it('renders templates and leaves unknown variables empty', () => {
    expect(renderTemplate('[[{{basename}}]]', { basename: 'a' })).toBe('[[a]]');
    expect(renderTemplate('{{nope}}', {})).toBe('');
  });
});

describe('group resolution', () => {
  it('matches on folder and extension', () => {
    expect(groupForAttachment([papers], '70_research/PDF/a.pdf', 'pdf')?.id).toBe(papers.id);
    expect(groupForAttachment([papers], '70_research/PDF/a.epub', 'epub')).toBeNull();
    expect(groupForAttachment([papers], '70_research/a.pdf', 'pdf')).toBeNull();
  });

  it('prefers the most specific attachments folder', () => {
    const outer = createGroup({ attachmentsFolder: '70_research', notesFolder: 'X', watchedExtensions: ['.pdf'] });
    const resolved = groupForAttachment([outer, papers], '70_research/PDF/a.pdf', 'pdf');
    expect(resolved?.id).toBe(papers.id);
  });

  it('never treats a file inside an attachments folder as a note', () => {
    expect(groupForNote([papers], '70_research/nn/a.md')?.id).toBe(papers.id);
    expect(groupForNote([papers], '70_research/PDF/readme.md')).toBeNull();
  });

  it('keeps groups apart', () => {
    expect(groupForAttachment([papers, clips], '98_clip/files/x.png', 'png')?.id).toBe(clips.id);
    expect(groupForNote([papers, clips], '98_clip/notes/x.md')?.id).toBe(clips.id);
  });

  it('ignores groups with an empty folder', () => {
    const broken = createGroup({ attachmentsFolder: '', notesFolder: '' });
    expect(groupForAttachment([broken], 'a.pdf', 'pdf')).toBeNull();
    expect(groupForNote([broken], 'a.md')).toBeNull();
  });
});

describe('note paths', () => {
  it('drops the extension and mirrors subfolders', () => {
    const { primary, fallback } = notePathCandidates(papers, '70_research/PDF/nn/a.pdf');
    expect(primary).toBe('70_research/nn/a.md');
    expect(fallback).toBe('70_research/nn/a.pdf.md');
  });

  it('flattens when mirroring is off', () => {
    const flat = createGroup({ ...papers, mirrorFolderStructure: false });
    expect(notePathCandidates(flat, '70_research/PDF/nn/a.pdf').primary).toBe('70_research/a.md');
  });

  it('honours a custom name template and strips illegal characters', () => {
    const custom = createGroup({ ...papers, noteNameTemplate: '{{basename}}/{{ext}}' });
    expect(notePathCandidates(custom, '70_research/PDF/a.pdf').primary).toBe('70_research/a-pdf.md');
  });

  it('lists reverse candidates in priority order', () => {
    expect(attachmentCandidates(papers, '70_research/nn/a.md')).toEqual([
      '70_research/PDF/nn/a.pdf',
    ]);
    expect(attachmentCandidates(papers, '70_research/nn/a.pdf.md')).toEqual([
      '70_research/PDF/nn/a.pdf',
      '70_research/PDF/nn/a.pdf.pdf',
    ]);
  });
});

describe('linkFor', () => {
  it('never lets the link resolve to the note itself', () => {
    // Note is "a.md", so [[a]] would hit the note, not the PDF.
    const ambiguous = createGroup({ ...papers, linkTemplate: '[[{{basename}}]]' });
    expect(linkFor(ambiguous, '70_research/PDF/a.pdf')).toBe('[[a.pdf]]');
  });

  it('leaves an unambiguous template alone', () => {
    const byName = createGroup({ ...papers, linkTemplate: '[[{{name}}]]' });
    expect(linkFor(byName, '70_research/PDF/nn/a.pdf')).toBe('[[a.pdf]]');

    const byPath = createGroup({ ...papers, linkTemplate: '[[{{path}}]]' });
    expect(linkFor(byPath, '70_research/PDF/nn/a.pdf')).toBe('[[70_research/PDF/nn/a.pdf]]');
  });

  it('falls back to the full path when the file name is the note name too', () => {
    // Note name keeps the extension, so [[a.pdf]] would be ambiguous as well.
    const group = createGroup({
      ...papers, noteNameTemplate: '{{name}}', linkTemplate: '[[{{name}}]]',
    });
    expect(linkFor(group, '70_research/PDF/a.pdf')).toBe('[[70_research/PDF/a.pdf]]');
  });

  it('passes through a template that is not a wikilink', () => {
    const group = createGroup({ ...papers, linkTemplate: '{{path}}' });
    expect(linkFor(group, '70_research/PDF/a.pdf')).toBe('70_research/PDF/a.pdf');
  });
});
