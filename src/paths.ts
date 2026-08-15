import { MappingGroup } from './types';

/** Trailing-slash-free, backslash-free folder path. */
export function cleanFolder(folder: string): string {
  return folder.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').trim();
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

export function splitName(fileName: string): { basename: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { basename: fileName, ext: '' };
  return { basename: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

export function templateVars(attachmentPath: string): Record<string, string> {
  const name = attachmentPath.split('/').pop() ?? attachmentPath;
  const { basename, ext } = splitName(name);
  return { name, basename, ext, path: attachmentPath, folder: attachmentPath.split('/').slice(0, -1).join('/') };
}

/**
 * A group owns an attachment when the file sits under its attachments folder
 * with a watched extension. The most specific folder wins, so nested groups
 * (70_research/PDF inside 70_research) resolve predictably.
 */
export function groupForAttachment(
  groups: MappingGroup[], path: string, extension: string,
): MappingGroup | null {
  let best: MappingGroup | null = null;
  let bestLen = -1;
  for (const group of groups) {
    const folder = cleanFolder(group.attachmentsFolder);
    if (!folder) continue;
    if (!isInFolder(path, folder)) continue;
    if (!group.watchedExtensions.map(e => e.toLowerCase()).includes('.' + extension.toLowerCase())) continue;
    if (folder.length > bestLen) { best = group; bestLen = folder.length; }
  }
  return best;
}

/** The mirror of the above for markdown notes. */
export function groupForNote(groups: MappingGroup[], path: string): MappingGroup | null {
  let best: MappingGroup | null = null;
  let bestLen = -1;
  for (const group of groups) {
    const notes = cleanFolder(group.notesFolder);
    if (!notes) continue;
    if (!isInFolder(path, notes)) continue;
    // A note that lives inside the attachments folder of any group is not a
    // sidecar note; that folder holds sources, not notes about them.
    if (groups.some(g => cleanFolder(g.attachmentsFolder) &&
        isInFolder(path, cleanFolder(g.attachmentsFolder)))) continue;
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

export function notePathCandidates(group: MappingGroup, attachmentPath: string): NotePathCandidates {
  const relative = relativeTo(attachmentPath, group.attachmentsFolder);
  const fileName = relative.split('/').pop() ?? relative;
  const subfolder = group.mirrorFolderStructure
    ? relative.split('/').slice(0, -1).join('/')
    : '';

  const vars = templateVars(attachmentPath);
  const rendered = renderTemplate(group.noteNameTemplate || '{{basename}}', vars).trim();
  const safe = (rendered || vars.basename).replace(/[\\/:*?"<>|]/g, '-');

  const notes = cleanFolder(group.notesFolder);
  const dir = [notes, subfolder].filter(Boolean).join('/');

  return {
    primary: [dir, `${safe}.md`].filter(Boolean).join('/'),
    fallback: [dir, `${fileName}.md`].filter(Boolean).join('/'),
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
  const relative = relativeTo(notePath, group.notesFolder).replace(/\.md$/, '');
  const attachments = cleanFolder(group.attachmentsFolder);
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
