import { describe, expect, it } from 'vitest';
import { createGroup } from '../src/sources';
import {
  attachmentCandidates, cleanFolder, groupForAttachment, groupForNote,
  notePathCandidates, relativeTo, renderTemplate,
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
