import {
  AttachmentRule, AttachmentRuleInput, MappingGroup,
} from './types';
import {
  cleanFolder, groupForAttachment, isInFolder, resourceRoot, splitName,
} from './paths';

let ruleCounter = 0;

function list(values: unknown, extension = false): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => extension
      ? `.${value.trim().replace(/^\.+/, '').toLowerCase()}`
      : cleanFolder(value))
    .filter(value => value !== '' && value !== '.')));
}

export function createAttachmentRule(partial: AttachmentRuleInput = {}): AttachmentRule {
  ruleCounter++;
  return {
    id: partial.id ?? `r${Date.now().toString(36)}${ruleCounter.toString(36)}`,
    name: partial.name ?? 'Rule',
    enabled: partial.enabled ?? true,
    sourceFolders: list(partial.sourceFolders),
    includeSubfolders: partial.includeSubfolders ?? false,
    excludedFolders: list(partial.excludedFolders),
    extensions: list(partial.extensions, true),
    excludedExtensions: list(partial.excludedExtensions, true),
    destinationFolder: cleanFolder(partial.destinationFolder ?? ''),
    nameTemplate: partial.nameTemplate?.trim() || '{{basename}}',
  };
}

/** Mapping roots are a hard ownership boundary, independent of watched extension. */
export function owningGroup(groups: MappingGroup[], path: string): MappingGroup | null {
  let owner: MappingGroup | null = null;
  let length = -1;
  for (const group of groups) {
    const root = resourceRoot(group);
    if (!root || !isInFolder(path, root) || root.length <= length) continue;
    owner = group;
    length = root.length;
  }
  return owner;
}

export type AttachmentHandlingRoute =
  | { kind: 'mapping'; group: MappingGroup }
  | { kind: 'protected'; group: MappingGroup }
  | { kind: 'generic' };

/** Route one explicit attachment action without weakening mapping-root protection. */
export function routeAttachment(
  groups: MappingGroup[], path: string, extension: string,
): AttachmentHandlingRoute {
  const group = groupForAttachment(groups, path, extension);
  if (group) return { kind: 'mapping', group };
  const owner = owningGroup(groups, path);
  return owner ? { kind: 'protected', group: owner } : { kind: 'generic' };
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path;
  const { ext } = splitName(name);
  return ext ? `.${ext.toLowerCase()}` : '';
}

function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

function folderMatches(path: string, folder: string, descendants: boolean): boolean {
  return descendants ? isInFolder(path, folder) : parentOf(path) === folder;
}

export function matchesAttachmentRule(rule: AttachmentRule, path: string): boolean {
  if (!rule.enabled) return false;
  const ext = extensionOf(path);

  if (rule.sourceFolders.length > 0 &&
      !rule.sourceFolders.some(folder => folderMatches(path, folder, rule.includeSubfolders))) return false;
  if (rule.excludedFolders.some(folder => isInFolder(path, folder))) return false;
  if (rule.extensions.length > 0 && !rule.extensions.includes(ext)) return false;
  if (rule.excludedExtensions.includes(ext)) return false;
  return true;
}

export function isCatchAllRule(rule: AttachmentRule): boolean {
  return rule.enabled && rule.sourceFolders.length === 0 && rule.excludedFolders.length === 0 &&
    rule.extensions.length === 0 && rule.excludedExtensions.length === 0;
}

export interface AttachmentCandidate {
  path: string;
  /** Available for the active-note command; empty for raw file/folder scopes. */
  noteBasename?: string;
}

export interface AttachmentMovePlan {
  from: string;
  to: string;
  ruleId: string;
  ruleName: string;
}

export interface AttachmentPlanResult {
  moves: AttachmentMovePlan[];
  managed: { path: string; groupId: string; groupName: string }[];
  unmatched: string[];
}

function safeStem(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim();
}

function renderName(rule: AttachmentRule, candidate: AttachmentCandidate, index: number | null): string {
  const name = candidate.path.split('/').pop() ?? candidate.path;
  const { basename } = splitName(name);
  const parent = parentOf(candidate.path).split('/').pop() ?? '';
  const vars: Record<string, string> = {
    basename,
    parent,
    note: candidate.noteBasename ?? basename,
    index: index === null ? '' : String(index),
  };
  const rendered = rule.nameTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? '');
  return safeStem(rendered) || basename;
}

function pathKey(path: string): string {
  return path.toLowerCase();
}

function withSuffix(stem: string, suffix: number, ext: string): string {
  return `${stem}-${suffix}${ext ? `.${ext}` : ''}`;
}

/**
 * Plans from one immutable snapshot. Group roots are removed before matching,
 * and the first enabled generic rule wins. Candidate order defines numbering.
 */
export function planAttachmentMoves(
  candidates: AttachmentCandidate[],
  rules: AttachmentRule[],
  groups: MappingGroup[],
  existingPaths: string[],
): AttachmentPlanResult {
  const managed: AttachmentPlanResult['managed'] = [];
  const unmatched: string[] = [];
  const matched: { candidate: AttachmentCandidate; rule: AttachmentRule }[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const key = pathKey(candidate.path);
    if (seen.has(key)) continue;
    seen.add(key);

    const owner = owningGroup(groups, candidate.path);
    if (owner) {
      managed.push({ path: candidate.path, groupId: owner.id, groupName: owner.name });
      continue;
    }
    const rule = rules.find(item => matchesAttachmentRule(item, candidate.path));
    if (rule) matched.push({ candidate, rule });
    else unmatched.push(candidate.path);
  }

  const occupied = new Set(existingPaths.map(pathKey));
  const reserved = new Set<string>();
  const moves: AttachmentMovePlan[] = [];

  for (const { candidate, rule } of matched) {
    const fromKey = pathKey(candidate.path);
    occupied.delete(fromKey);

    const fileName = candidate.path.split('/').pop() ?? candidate.path;
    const { ext } = splitName(fileName);
    const folder = cleanFolder(rule.destinationFolder) || parentOf(candidate.path);
    const usesIndex = /\{\{\s*index\s*\}\}/.test(rule.nameTemplate);
    let target = '';

    if (usesIndex) {
      for (let index = 1; index <= 99999; index++) {
        const stem = renderName(rule, candidate, index);
        const name = `${stem}${ext ? `.${ext}` : ''}`;
        const proposed = [folder, name].filter(Boolean).join('/');
        const key = pathKey(proposed);
        if (!occupied.has(key) && !reserved.has(key)) { target = proposed; break; }
      }
    } else {
      const stem = renderName(rule, candidate, null);
      const name = `${stem}${ext ? `.${ext}` : ''}`;
      target = [folder, name].filter(Boolean).join('/');
      if (occupied.has(pathKey(target)) || reserved.has(pathKey(target))) {
        for (let suffix = 1; suffix <= 99999; suffix++) {
          const proposed = [folder, withSuffix(stem, suffix, ext)].filter(Boolean).join('/');
          const key = pathKey(proposed);
          if (!occupied.has(key) && !reserved.has(key)) { target = proposed; break; }
        }
      }
    }

    if (!target) {
      unmatched.push(candidate.path);
      occupied.add(fromKey);
      continue;
    }
    reserved.add(pathKey(target));
    if (target !== candidate.path) {
      moves.push({ from: candidate.path, to: target, ruleId: rule.id, ruleName: rule.name });
    }
  }

  return { moves, managed, unmatched };
}
