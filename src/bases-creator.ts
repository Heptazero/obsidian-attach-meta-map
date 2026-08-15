import { App, normalizePath } from 'obsidian';
import { MappingGroup } from './types';
import { FIELD_DEFS } from './fields';
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

  private enabledProperties(group: MappingGroup): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const def of FIELD_DEFS) {
      const config = group.fields[def.id];
      if (!config?.enabled) continue;
      const property = (config.property || def.property).trim();
      if (!property || seen.has(property)) continue;
      seen.add(property);
      out.push(property);
    }
    return out;
  }

  async createOrUpdate(group: MappingGroup): Promise<void> {
    if (!group.autoCreateBaseFile) return;
    const path = this.pathFor(group);
    if (this.app.vault.getFileByPath(path)) return;

    const folder = path.split('/').slice(0, -1).join('/');
    if (folder) await this.app.vault.createFolder(folder).catch(() => { /* exists */ });

    await this.app.vault.create(path, this.buildContent(group));
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

  buildContent(group: MappingGroup): string {
    const properties = this.enabledProperties(group);
    const order = ['      - file.name', ...properties.map(p => `      - ${p}`)].join('\n');
    const statusProperty = group.fields.status?.enabled
      ? (group.fields.status.property || 'status').trim()
      : null;

    const lines: string[] = [
      'filters:',
      `  file.inFolder("${cleanFolder(group.notesFolder)}")`,
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
