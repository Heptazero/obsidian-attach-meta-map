import { MappingGroup } from './types';

/** Trailing-slash-free, backslash-free folder path. */
export function cleanFolder(folder: string): string {
  return folder.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').trim();
}

/** Root that contains resources before any folder-layout folding. */
export function resourceRoot(group: MappingGroup): string {
  return cleanFolder(group.layout === 'folder' ? group.collectionFolder : group.resourceFolder);
}

/** Root that contains index notes. Folder layout deliberately shares the resource root. */
export function noteRoot(group: MappingGroup): string {
  return cleanFolder(group.layout === 'folder' ? group.collectionFolder : group.noteFolder);
}

export function isInFolder(path: string, folder: string): boolean {
  const f = cleanFolder(folder);
  if (!f) return true;
  return path === f || path.startsWith(f + '/');
}

export function relativeTo(path: string, folder: string): string {
  const f = cleanFolder(folder);
  if (!f) return path;
  return path.startsWith(f + '/') ? path.slice(f.length + 1) : path;
}

/** True only for a file placed immediately inside the root, never a descendant folder. */
export function isDirectChild(path: string, folder: string): boolean {
  return folderDepth(path, folder) === 0;
}

/** File depth below a root: direct file = 0, one child folder = 1. */
export function folderDepth(path: string, folder: string): number | null {
  if (!isInFolder(path, folder)) return null;
  const relative = relativeTo(path, folder);
  if (!relative) return null;
  return relative.split('/').filter(Boolean).length - 1;
}

/** True only for files at the configured exact depth. */
export function isAtFolderDepth(path: string, folder: string, depth: number): boolean {
  return folderDepth(path, folder) === Math.max(0, Math.floor(depth));
}

export function splitName(fileName: string): { basename: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { basename: fileName, ext: '' };
  return { basename: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

/**
 * Zotero (and Better BibTeX) export PDFs as "Author - Year - Title.pdf". Pull
 * the year and the title back out of that pattern so a note name can reorder
 * them, without reading the file itself — this stays a pure string operation,
 * so it works everywhere {{basename}} does (naming, linking, before the note
 * exists). Filenames that do not follow the pattern get an empty {{year}}
 * and {{title}} falls back to the full basename.
 */
const AUTHOR_YEAR_TITLE_RE = /^.+?\s-\s(\d{4})\s-\s(.+)$/;

export function templateVars(attachmentPath: string): Record<string, string> {
  const name = attachmentPath.split('/').pop() ?? attachmentPath;
  const { basename, ext } = splitName(name);
  const match = AUTHOR_YEAR_TITLE_RE.exec(basename);
  return {
    name, basename, ext,
    path: attachmentPath,
    folder: attachmentPath.split('/').slice(0, -1).join('/'),
    year: match?.[1] ?? '',
    title: match?.[2] ?? basename,
  };
}

/**
 * A group owns an attachment when the file sits under its resource root
 * with a watched extension. The most specific folder wins, so nested groups
 * (70_research/PDF inside 70_research) resolve predictably.
 */
export function groupForAttachment(
  groups: MappingGroup[], path: string, extension: string,
): MappingGroup | null {
  let best: MappingGroup | null = null;
  let bestLen = -1;
  for (const group of groups) {
    const folder = resourceRoot(group);
    if (!folder) continue;
    if (!isInFolder(path, folder)) continue;
    if (group.layout === 'folder' && !isAtFolderDepth(path, folder, group.attachmentDepth)) continue;
    if (!group.watchedExtensions.map(e => e.toLowerCase()).includes('.' + extension.toLowerCase())) continue;
    if (folder.length > bestLen) { best = group; bestLen = folder.length; }
  }
  return best;
}

/**
 * Recognizes an attachment that has already been folded (folder layout): it
 * its own folder sits under a folder-layout group's collection root.
 * Extension is not checked here — an
 * already-folded item may sit beside its note regardless of which watched
 * extension it has, and the caller (findAttachment / the pair opener)
 * confirms the pairing by content, not by this lookup alone.
 */
export function groupForFoldedAttachment(groups: MappingGroup[], path: string): MappingGroup | null {
  let best: MappingGroup | null = null;
  let bestLen = -1;
  for (const group of groups) {
    if (group.layout !== 'folder') continue;
    const notes = noteRoot(group);
    if (!notes) continue;
    if (!isInFolder(path, notes)) continue;
    if (notes.length > bestLen) { best = group; bestLen = notes.length; }
  }
  return best;
}

/** The mirror of the above for markdown notes. */
export function groupForNote(groups: MappingGroup[], path: string): MappingGroup | null {
  let best: MappingGroup | null = null;
  let bestLen = -1;
  for (const group of groups) {
    const notes = noteRoot(group);
    if (!notes) continue;
    if (!isInFolder(path, notes)) continue;
    // Only a sidecar resource root excludes notes. Folder-layout collections
    // intentionally keep the note and resources together.
    if (groups.some(g => g.layout === 'sidecar' && resourceRoot(g) &&
        isInFolder(path, resourceRoot(g)))) continue;
    if (notes.length > bestLen) { best = group; bestLen = notes.length; }
  }
  return best;
}

export interface NotePathCandidates {
  /** Preferred path, from the note name template. */
  primary: string;
  /** Used when `primary` is taken by a different attachment. */
  fallback: string;
}

/**
 * {{year}} can fail to parse (see templateVars); every other variable always
 * resolves to something. A template that names {{year}} but gets '' for this
 * attachment would otherwise render a half-filled, delimiter-scarred name
 * (e.g. "{{year}}-{{title}}" -> "-Full File Name") instead of failing loudly
 * or degrading cleanly — so treat that combination as "template not usable
 * for this file" and fall back to the plain file name instead.
 */
const FALLIBLE_VARS = ['year'];

function templateUsable(template: string, vars: Record<string, string>): boolean {
  return !FALLIBLE_VARS.some(name => template.includes(`{{${name}}}`) && !vars[name]);
}

/** The name-template render, filesystem-safe, with the {{year}} guard applied. */
function safeItemName(group: MappingGroup, attachmentPath: string): string {
  const vars = templateVars(attachmentPath);
  const template = group.noteNameTemplate || '{{basename}}';
  const rendered = templateUsable(template, vars) ? renderTemplate(template, vars).trim() : '';
  return (rendered || vars.basename).replace(/[\\/:*?"<>|]/g, '-');
}

/** Names that may legitimately identify one generated item. */
export function folderItemNames(group: MappingGroup, attachmentPath: string): string[] {
  const fileName = attachmentPath.split('/').pop() ?? attachmentPath;
  return Array.from(new Set([safeItemName(group, attachmentPath), fileName]));
}

export function notePathCandidates(group: MappingGroup, attachmentPath: string): NotePathCandidates {
  const relative = relativeTo(attachmentPath, resourceRoot(group));
  const fileName = relative.split('/').pop() ?? relative;
  const subfolder = group.layout === 'sidecar' && group.mirrorFolderStructure
    ? relative.split('/').slice(0, -1).join('/')
    : '';

  const [safe] = folderItemNames(group, attachmentPath);
  const notes = noteRoot(group);
  const dir = [notes, subfolder].filter(Boolean).join('/');

  return {
    primary: [dir, `${safe}.md`].filter(Boolean).join('/'),
    fallback: [dir, `${fileName}.md`].filter(Boolean).join('/'),
  };
}

export interface FolderItem {
  /** The per-item folder. */
  folder: string;
  /** The note inside it. */
  notePath: string;
  /** Final attachment path; unchanged when the configured depth is above 0. */
  attachmentPath: string;
}

export interface FolderItemCandidates {
  /** Preferred, from the name template. */
  primary: FolderItem;
  /** Used when a *different* item already has the preferred folder name. */
  fallback: FolderItem;
}

function buildFolderItem(dir: string, folderName: string, fileName: string): FolderItem {
  const folder = [dir, folderName].filter(Boolean).join('/');
  return { folder, notePath: `${folder}/${folderName}.md`, attachmentPath: `${folder}/${fileName}` };
}

/**
 * Folder layout: attachment and note become siblings inside one new folder,
 * named from the same template as sidecar mode's note name. The attachment
 * keeps its own file name — only its location changes. Mirrors
 * notePathCandidates' primary/fallback shape so a name collision degrades
 * the same way: fall back to the attachment's own file name for the folder.
 */
export function folderItemCandidates(group: MappingGroup, attachmentPath: string): FolderItemCandidates {
  const relative = relativeTo(attachmentPath, resourceRoot(group));
  const fileName = relative.split('/').pop() ?? relative;
  const safe = safeItemName(group, attachmentPath);
  const notes = noteRoot(group);

  if (group.layout === 'folder' && group.attachmentDepth > 0) {
    const folder = attachmentPath.split('/').slice(0, -1).join('/');
    return {
      primary: { folder, notePath: `${folder}/${safe}.md`, attachmentPath },
      fallback: { folder, notePath: `${folder}/${fileName}.md`, attachmentPath },
    };
  }

  return {
    primary: buildFolderItem(notes, safe, fileName),
    fallback: buildFolderItem(notes, fileName, fileName),
  };
}


/**
 * The link value for an attachment.
 *
 * Guards the one case that silently breaks everything: when the note drops the
 * extension, a `[[basename]]` link resolves to the note itself, because
 * Obsidian tries `basename.md` before `basename.pdf`. In that case the link
 * falls back to the file name, and to the full path if even that collides.
 */
export function linkFor(group: MappingGroup, attachmentPath: string): string {
  const rendered = renderTemplate(group.linkTemplate || '[[{{path}}]]', templateVars(attachmentPath));

  const inner = /\[\[([^\]|#]+)/.exec(rendered)?.[1]?.trim();
  if (!inner) return rendered;

  const noteName = (notePathCandidates(group, attachmentPath).primary.split('/').pop() ?? '')
    .replace(/\.md$/, '');
  if (inner !== noteName) return rendered;

  const fileName = attachmentPath.split('/').pop() ?? attachmentPath;
  return rendered.replace(inner, fileName === noteName ? attachmentPath : fileName);
}

/**
 * Reverse mapping: which attachments could this note belong to? Returns paths
 * in priority order — the note name may or may not carry the extension.
 */
export function attachmentCandidates(group: MappingGroup, notePath: string): string[] {
  const relative = relativeTo(notePath, noteRoot(group)).replace(/\.md$/, '');
  const attachments = resourceRoot(group);
  const base = [attachments, relative].filter(Boolean).join('/');

  const out: string[] = [];
  const { ext } = splitName(relative.split('/').pop() ?? relative);
  if (ext && group.watchedExtensions.map(e => e.slice(1).toLowerCase()).includes(ext.toLowerCase())) {
    out.push(base);
  }
  for (const watched of group.watchedExtensions) {
    out.push(base + watched);
  }
  return out;
}

/**
 * Loose equality for matching an auxiliary file (a translation, `cn_`-style)
 * to the primary item it belongs to: strip everything but letters, digits
 * and CJK, lowercase the rest. Punctuation/spacing conventions differ enough
 * between a Zotero export and a hand-named translation ("cn_2021-Hopfield-
 * Networks-is-All-You-Need.pdf" vs "2021-Hopfield Networks is All You Need")
 * that an exact-string match would miss almost everything.
 */
export function normalizeForMatch(name: string): string {
  return name.replace(/[^a-zA-Z0-9一-鿿]+/g, '').toLowerCase();
}

/** Drops a configured prefix (e.g. "cn_") if the name actually starts with it. */
export function stripPrefix(name: string, prefix: string): string {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
}
