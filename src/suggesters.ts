import { AbstractInputSuggest, App, TFile, prepareFuzzySearch } from 'obsidian';

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

/** Fuzzy suggestions for a frontmatter property name. */
export class PropertySuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private items: () => Promise<string[]>,
    private onPick: (value: string) => void,
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
    this.onPick(value);
    this.close();
  }
}

/** Fuzzy suggestions over markdown files, used to pick a template. */
export class TemplateFileSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private files: () => TFile[],
    private onPick: (path: string) => void,
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
    this.onPick(value);
    this.close();
  }
}
