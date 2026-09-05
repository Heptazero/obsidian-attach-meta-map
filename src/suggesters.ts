import { AbstractInputSuggest, App, TFile, prepareFuzzySearch } from 'obsidian';
import { runInBackground } from './background-task';

function rank(query: string, items: string[], limit = 20): string[] {
  const trimmed = query.trim();
  if (!trimmed) return items.slice(0, limit);

  const search = prepareFuzzySearch(trimmed);
  return items
    .map(item => ({ item, score: search(item)?.score ?? null }))
    .filter((entry): entry is { item: string; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item);
}

function csvParts(value: string): string[] {
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

abstract class CsvSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private input: HTMLInputElement,
    private onPickList: (value: string) => void | Promise<void>,
  ) {
    super(app, input);
  }

  protected currentQuery(query: string): string {
    return query.split(',').pop()?.trim() ?? '';
  }

  protected choose(value: string): void {
    const parts = csvParts(this.input.value);
    if (this.input.value.trim().endsWith(',') || parts.length === 0) parts.push(value);
    else parts[parts.length - 1] = value;
    const next = Array.from(new Set(parts)).join(', ');
    this.setValue(next);
    runInBackground(() => this.onPickList(next), 'Could not apply suggested list');
    this.close();
  }
}

/** Fuzzy suggestions for a frontmatter property name. */
export class PropertySuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private items: () => Promise<string[]>,
    private onPick: (value: string) => void | Promise<void>,
  ) {
    super(app, input);
  }

  protected async getSuggestions(query: string): Promise<string[]> {
    return rank(query, await this.items());
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    runInBackground(() => this.onPick(value), 'Could not apply suggested property');
    this.close();
  }
}

/** Fuzzy suggestions over vault folders, used for folder path fields. */
export class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private onPick: (path: string) => void | Promise<void>,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    const paths = this.app.vault.getAllFolders(true).map(folder => folder.path || '/');
    return rank(query, paths);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value === '/' ? '' : value);
    runInBackground(
      () => this.onPick(value === '/' ? '' : value),
      'Could not apply suggested folder',
    );
    this.close();
  }
}

/** Fuzzy, comma-separated folder selection for attachment rules. */
export class FolderListSuggest extends CsvSuggest {
  protected getSuggestions(query: string): string[] {
    const paths = this.app.vault.getAllFolders(true).map(folder => folder.path || '/');
    return rank(this.currentQuery(query), paths);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.choose(value === '/' ? '' : value);
  }
}

/** Fuzzy, comma-separated selection over extensions that currently exist in the vault. */
export class ExtensionSuggest extends CsvSuggest {
  protected getSuggestions(query: string): string[] {
    const extensions = Array.from(new Set(this.app.vault.getFiles()
      .map(file => file.extension.toLowerCase())
      .filter(Boolean)
      .map(extension => `.${extension}`)))
      .sort((a, b) => a.localeCompare(b));
    return rank(this.currentQuery(query).replace(/^\./, ''), extensions);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.choose(value);
  }
}

/** Fuzzy suggestions over markdown files, used to pick a template. */
export class TemplateFileSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private files: () => TFile[],
    private onPick: (path: string) => void | Promise<void>,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    return rank(query, this.files().map(file => file.path));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    runInBackground(() => this.onPick(value), 'Could not apply suggested template');
    this.close();
  }
}
