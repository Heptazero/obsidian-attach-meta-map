export const SOURCE_PROPERTY = 'source';

const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

/** Link targets stored in a scalar or list-valued Obsidian property. */
export function sourceLinkTargets(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const targets: string[] = [];

  for (const entry of values) {
    if (typeof entry !== 'string') continue;
    for (const match of entry.matchAll(WIKI_LINK_RE)) {
      const target = match[1]?.trim();
      if (target && !targets.includes(target)) targets.push(target);
    }
  }

  return targets;
}

/** Preserve a single source as a scalar; promote it to a list when more arrive. */
export function appendSourceLink(value: unknown, link: string): string | string[] {
  const target = sourceLinkTargets(link)[0];
  if (target && sourceLinkTargets(value).includes(target)) {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : String(value);
  }

  const existing = (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  if (existing.length === 0) return link;
  return [...existing, link];
}

/** Comma/semicolon/newline separated prefixes; longest wins when they overlap. */
export function auxiliaryPrefixes(value: string): string[] {
  return [...new Set(value.split(/[,，;；\n]+/).map(part => part.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
}

export function stripAuxiliaryPrefix(name: string, configured: string): string | null {
  const prefix = auxiliaryPrefixes(configured).find(candidate => name.startsWith(candidate));
  return prefix ? name.slice(prefix.length) : null;
}
