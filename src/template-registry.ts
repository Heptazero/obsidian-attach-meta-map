import { App, TFile, normalizePath } from 'obsidian';
import { AttMetaMapSettings } from './types';
import { ParsedTemplate, parseTemplate } from './template';
import { cleanFolder, isInFolder } from './paths';

interface TemplaterLike { settings?: { templates_folder?: string } }
interface CorePluginLike { instance?: { options?: { folder?: string } } }
interface AppInternals {
  plugins?: { plugins?: Record<string, TemplaterLike | undefined> };
  internalPlugins?: { getPluginById?: (id: string) => CorePluginLike | undefined };
}

/**
 * Finds the template files this vault already has — Templater's folder, the
 * core Templates folder, anything the user added — and reads the property
 * names out of them so the mapping table can suggest real keys.
 */
export class TemplateRegistry {
  private keyCache: string[] | null = null;

  constructor(private app: App, private settings: () => AttMetaMapSettings) {}

  /** Template folders configured elsewhere in the vault. */
  detectedFolders(): string[] {
    const internals = this.app as unknown as AppInternals;
    const found: string[] = [];

    try {
      const templater = internals.plugins?.plugins?.['templater-obsidian'];
      const folder = templater?.settings?.templates_folder;
      if (folder) found.push(cleanFolder(folder));
    } catch { /* plugin layout changed; suggestions just get shorter */ }

    try {
      const core = internals.internalPlugins?.getPluginById?.('templates');
      const folder = core?.instance?.options?.folder;
      if (folder) found.push(cleanFolder(folder));
    } catch { /* same */ }

    return [...new Set(found.filter(folder => folder.length > 0))];
  }

  folders(): string[] {
    const extra = this.settings().extraTemplateFolders.map(cleanFolder).filter(Boolean);
    return [...new Set([...this.detectedFolders(), ...extra])];
  }

  files(): TFile[] {
    const folders = this.folders();
    const inFolders = this.app.vault.getMarkdownFiles()
      .filter(file => folders.some(folder => isInFolder(file.path, folder)));

    const configured = this.settings().groups
      .map(group => group.templatePath.trim())
      .filter(path => path.length > 0)
      .map(path => this.app.vault.getFileByPath(normalizePath(path)))
      .filter((file): file is TFile => file !== null);

    const seen = new Set<string>();
    return [...inFolders, ...configured].filter(file => {
      if (seen.has(file.path)) return false;
      seen.add(file.path);
      return true;
    });
  }

  async parse(path: string): Promise<ParsedTemplate | null> {
    const file = this.app.vault.getFileByPath(normalizePath(path.trim()));
    if (!file) return null;
    return parseTemplate(await this.app.vault.cachedRead(file));
  }

  /** Property names across all known templates, most common first. */
  async knownKeys(): Promise<string[]> {
    if (this.keyCache) return this.keyCache;

    const counts = new Map<string, number>();
    for (const file of this.files()) {
      const parsed = parseTemplate(await this.app.vault.cachedRead(file));
      for (const key of parsed.keys) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    this.keyCache = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key]) => key);
    return this.keyCache;
  }

  invalidate(): void {
    this.keyCache = null;
  }
}
