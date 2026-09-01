import { describe, expect, it } from 'vitest';
import { App, TFile } from 'obsidian';
import { NoteManager } from '../src/note-manager';
import { createGroup, defaultSettings } from '../src/sources';
import { TemplateRegistry } from '../src/template-registry';

function makeFile(path: string): TFile {
  const file = new TFile();
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  Object.assign(file, {
    path,
    name,
    basename: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot + 1) : '',
    parent: null,
    stat: { ctime: 0, mtime: 0, size: 1 },
  });
  return file;
}

function harness(files: TFile[], frontmatter: Record<string, Record<string, unknown>>) {
  const created = new Map<string, string>();
  const app = {
    vault: {
      getMarkdownFiles: () => files.filter(file => file.extension === 'md'),
      getFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
      createFolder: async () => {},
      create: async (path: string, content: string) => {
        const file = makeFile(path);
        files.push(file);
        created.set(path, content);
        return file;
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }),
      getFirstLinkpathDest: (target: string) => files.find(file =>
        file.path === target || file.name === target || file.basename === target,
      ) ?? null,
    },
    fileManager: {
      renameFile: async (file: TFile, path: string) => { file.path = path; },
      processFrontMatter: async (note: TFile, update: (fm: Record<string, unknown>) => void) => {
        frontmatter[note.path] ??= {};
        update(frontmatter[note.path]);
      },
    },
  } as unknown as App;

  const settings = defaultSettings();
  const manager = new NoteManager(app, () => settings, {} as TemplateRegistry);
  return { created, manager, settings };
}

describe('source-based resource relation', () => {
  it('always writes source when it creates an index note', async () => {
    const attachment = makeFile('Files/paper.pdf');
    const { created, manager } = harness([attachment], {});
    const group = createGroup({
      notesFolder: 'Library', attachmentsFolder: 'Files', enablePdfMetadataExtraction: false,
    });

    await manager.createNote(attachment, group);

    expect(created.get('Library/paper.md')).toContain('source: "[[paper.pdf]]"');
  });

  it('resolves every source-list member back to the same note and keeps the first primary', () => {
    const note = makeFile('Library/Paper/Paper.md');
    const original = makeFile('Files/paper-en.pdf');
    const translation = makeFile('Files/paper-zh.pdf');
    const fm = { [note.path]: { source: ['[[paper-en.pdf]]', '[[paper-zh.pdf]]'] } };
    const { manager } = harness([note, original, translation], fm);
    const group = createGroup({ notesFolder: 'Library', attachmentsFolder: 'Files' });

    expect(manager.findNoteBySource([group], translation.path)?.note).toBe(note);
    expect(manager.findAttachment(group, note)).toBe(original);
  });

  it('folds several prefixed files into one folder and appends each to source', async () => {
    const note = makeFile('Library/Paper/Paper.md');
    const folder = { path: 'Library/Paper', children: [note] };
    Object.assign(note, { parent: folder });
    const original = makeFile('Library/Paper/paper.pdf');
    const chinese = makeFile('Inbox/cn_paper.pdf');
    const slides = makeFile('Inbox/slides_paper.pdf');
    const files = [note, original, chinese, slides];
    const fm = { [note.path]: { source: '[[paper.pdf]]' } };
    const { manager } = harness(files, fm);
    const group = createGroup({
      layout: 'folder',
      notesFolder: 'Library',
      attachmentsFolder: 'Inbox',
      auxiliaryPrefix: 'cn_, slides_',
      createNoteFile: true,
    });

    await manager.createNote(chinese, group);
    await manager.createNote(slides, group);

    expect(chinese.path).toBe('Library/Paper/cn_paper.pdf');
    expect(slides.path).toBe('Library/Paper/slides_paper.pdf');
    expect(fm[note.path].source).toEqual([
      '[[paper.pdf]]', '[[cn_paper.pdf]]', '[[slides_paper.pdf]]',
    ]);
  });

  it('plans no change for a source-linked resource', () => {
    const note = makeFile('Library/Paper/Paper.md');
    const attachment = makeFile('Library/Paper/paper.pdf');
    const fm = { [note.path]: { source: '[[paper.pdf]]' } };
    const { manager } = harness([note, attachment], fm);
    const group = createGroup({
      layout: 'folder', notesFolder: 'Library', attachmentsFolder: 'Library',
    });

    expect(manager.planCreate(attachment, group)).toBeNull();
  });

  it('repairs source instead of nesting an already folded resource again', () => {
    const note = makeFile('Library/Paper/Paper.md');
    const attachment = makeFile('Library/Paper/Paper.pdf');
    const folder = { path: 'Library/Paper', name: 'Paper', children: [note, attachment] };
    Object.assign(note, { parent: folder });
    Object.assign(attachment, { parent: folder });
    const { manager } = harness([note, attachment], { [note.path]: {} });
    const group = createGroup({
      layout: 'folder', notesFolder: 'Library', attachmentsFolder: 'Library',
      noteNameTemplate: '{{basename}}',
    });

    expect(manager.planCreate(attachment, group)?.changes).toEqual([
      { kind: 'update-source', notePath: note.path, link: '[[Paper.pdf]]' },
    ]);
  });

  it('skips an already folded resource when note creation is disabled', () => {
    const attachment = makeFile('Library/Paper/Paper.pdf');
    const folder = { path: 'Library/Paper', name: 'Paper', children: [attachment] };
    Object.assign(attachment, { parent: folder });
    const { manager } = harness([attachment], {});
    const group = createGroup({
      layout: 'folder', notesFolder: 'Library', attachmentsFolder: 'Library',
      createNoteFile: false,
    });

    expect(manager.planCreate(attachment, group)).toBeNull();
  });

  it('does not nest an already folded resource through the direct create path', async () => {
    const attachment = makeFile('Library/Paper/Paper.pdf');
    const folder = { path: 'Library/Paper', name: 'Paper', children: [attachment] };
    Object.assign(attachment, { parent: folder });
    const { manager } = harness([attachment], {});
    const group = createGroup({
      layout: 'folder', notesFolder: 'Library', attachmentsFolder: 'Library',
      createNoteFile: false,
    });

    await manager.createNote(attachment, group);
    expect(attachment.path).toBe('Library/Paper/Paper.pdf');
  });
});
