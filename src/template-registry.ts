import { App, TFile, normalizePath } from 'obsidian';
import { AttMetaMapSettings } from './types';
import { ParsedTemplate, parseTemplate } from './template';

/**
 * Suggests any Markdown file as a template. Property-name suggestions only
 * use templates selected by a mapping group, not every note in the vault.
 */
export class TemplateRegistry {
  private keyCache: string[] | null = null;

  constructor(private app: App, private settings: () => AttMetaMapSettings) {}

  files(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  private selectedFiles(): TFile[] {
    const configured = this.settings().groups
      .map(group => group.templatePath.trim())
      .filter(path => path.length > 0)
      .map(path => this.app.vault.getFileByPath(normalizePath(path)))
      .filter((file): file is TFile => file?.extension.toLowerCase() === 'md');

    const seen = new Set<string>();
    return configured.filter(file => {
      if (seen.has(file.path)) return false;
      seen.add(file.path);
      return true;
    });
  }

  async parse(path: string): Promise<ParsedTemplate | null> {
    const file = this.app.vault.getFileByPath(normalizePath(path.trim()));
    if (!file || file.extension.toLowerCase() !== 'md') return null;
    return parseTemplate(await this.app.vault.cachedRead(file));
  }

  /** Property names across selected templates, most common first. */
  async knownKeys(): Promise<string[]> {
    if (this.keyCache) return this.keyCache;

    const counts = new Map<string, number>();
    for (const file of this.selectedFiles()) {
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
