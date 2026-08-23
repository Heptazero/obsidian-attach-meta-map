import { App, normalizePath } from 'obsidian';
import { MappingGroup } from './types';
import { cleanFolder } from './paths';
import { t } from './i18n/i18n';

/** Generates a .base index table whose columns follow the group's field table. */
export class BasesCreator {
  constructor(private app: App) {}

  fileNameFor(group: MappingGroup): string {
    const safe = group.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Attachments';
    return `${safe}.base`;
  }

  pathFor(group: MappingGroup, folderOverride?: string): string {
    const folder = cleanFolder(folderOverride ?? group.baseFolderPath ?? '')
      || cleanFolder(group.notesFolder);
    const name = this.fileNameFor(group);
    return normalizePath(folder ? `${folder}/${name}` : name);
  }

  async createOrUpdate(group: MappingGroup, keys: string[]): Promise<void> {
    if (!group.autoCreateBaseFile) return;
    const path = this.pathFor(group);
    if (this.app.vault.getFileByPath(path)) return;

    const folder = path.split('/').slice(0, -1).join('/');
    if (folder) await this.app.vault.createFolder(folder).catch(() => { /* exists */ });

    await this.app.vault.create(path, this.buildContent(group, keys));
  }

  async move(group: MappingGroup, oldFolder: string, newFolder: string): Promise<void> {
    const oldPath = this.pathFor(group, oldFolder);
    const newPath = this.pathFor(group, newFolder);
    if (oldPath === newPath) return;

    const existing = this.app.vault.getFileByPath(oldPath);
    if (!existing) return;
    if (this.app.vault.getFileByPath(newPath)) return;

    const folder = newPath.split('/').slice(0, -1).join('/');
    if (folder) await this.app.vault.createFolder(folder).catch(() => { /* exists */ });
    await this.app.fileManager.renameFile(existing, newPath);
  }

  /** Columns follow the group's template keys. */
  buildContent(group: MappingGroup, keys: string[]): string {
    const order = ['      - file.name', ...keys.map(key => `      - ${key}`)].join('\n');
    const statusProperty = keys.includes('status') ? 'status' : null;

    const lines: string[] = [
      'filters:',
      '  and:',
      // Folder layout puts the attachment beside the note, inside the same
      // notesFolder tree — restrict to markdown so it does not show up as a
      // spurious, property-less row next to the note that describes it.
      `    - file.inFolder("${cleanFolder(group.notesFolder)}")`,
      '    - file.ext == "md"',
      '',
      'views:',
      '  - type: table',
      `    name: "${t('bases.views.all')}"`,
      '    order:',
      order,
    ];

    if (statusProperty) {
      lines.push(
        '',
        '  - type: table',
        `    name: "${t('bases.views.unread')}"`,
        '    order:',
        order,
        '    filters:',
        '      and:',
        `        - ${statusProperty}.equals("unread")`,
      );
    }

    return lines.join('\n') + '\n';
  }
}
