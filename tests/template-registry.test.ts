import { describe, expect, it } from 'vitest';
import { App, TFile } from 'obsidian';
import { createGroup, defaultSettings } from '../src/settings-model';
import { TemplateRegistry } from '../src/template-registry';

function file(path: string): TFile {
  return Object.assign(new TFile(), { path, extension: path.split('.').pop() ?? '' });
}

describe('template search', () => {
  it('offers Markdown anywhere in the vault without requiring source or a template folder', async () => {
    const art = file('作品/绘画模板.md');
    const note = file('日记/随笔.md');
    const files = [art, note];
    const app = {
      vault: {
        getMarkdownFiles: () => files,
        getFileByPath: (path: string) => files.find(item => item.path === path) ?? null,
        cachedRead: async (item: TFile) => item === art
          ? '---\ntype: artwork\ntags: []\n---\n' : '---\nmood: calm\n---\n',
      },
    } as unknown as App;
    const settings = defaultSettings();
    settings.groups = [createGroup({ templatePath: art.path })];
    const registry = new TemplateRegistry(app, () => settings);

    expect(registry.files()).toEqual(files);
    expect((await registry.parse(art.path))?.keys).toEqual(['type', 'tags']);
    expect(await registry.knownKeys()).toEqual(['tags', 'type']);
  });
});
