import type { MappingGroupCommon } from './types';

export const DEFAULT_EXCLUDED_EXTENSIONS = ['.md', '.canvas', '.base'];

/** Literal suffixes only; mode selection, not a wildcard, means all attachments. */
export function normalizeExtensions(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().replace(/^\.+/, '').toLowerCase())
    .filter(value => /^[^.\s,*/\\]+$/u.test(value))
    .map(value => `.${value}`)));
}

export function activeExtensions(group: MappingGroupCommon): string[] {
  return group.extensionMode === 'blocklist' ? group.excludedExtensions : group.watchedExtensions;
}

export function setActiveExtensions(group: MappingGroupCommon, values: string[]): void {
  const list = normalizeExtensions(values);
  if (group.extensionMode === 'blocklist') group.excludedExtensions = list;
  else group.watchedExtensions = list;
}

/** Markdown is never an attachment: generated notes must not spawn more notes. */
export function matchesGroupExtension(group: MappingGroupCommon, extension: string): boolean {
  const ext = extension.trim().replace(/^\.+/, '').toLowerCase();
  if (ext === 'md') return false;
  const listed = activeExtensions(group).includes(`.${ext}`);
  return group.extensionMode === 'blocklist' ? !listed : listed;
}
