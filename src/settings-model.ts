import {
  AttMetaMapSettings, MappingGroup, MappingGroupInput, SETTINGS_VERSION,
} from './types';
import { SOURCE_DEFS } from './sources';
import { renderTemplate, templateVars } from './paths';
import { createAttachmentRule } from './attachment-rules';
import { DEFAULT_EXCLUDED_EXTENSIONS, normalizeExtensions } from './extension-filter';

/** Prevent an extensionless source link from resolving to the note itself. */
export function unambiguousLinkTemplate(group: MappingGroup): string {
  const vars = templateVars('folder/sample.pdf');
  const link = renderTemplate(group.linkTemplate, vars);
  const inner = /\[\[([^\]|#]+)/.exec(link)?.[1]?.trim();
  const noteName = renderTemplate(group.noteNameTemplate, vars).trim();

  if (!inner || inner !== noteName) return group.linkTemplate;
  return group.linkTemplate.replace('{{basename}}', '{{name}}');
}

export function defaultMapping(): Record<string, string> {
  return Object.fromEntries(SOURCE_DEFS.map(def => [def.id, def.property]));
}

let groupCounter = 0;

export function createGroup(partial: MappingGroupInput = {}): MappingGroup {
  groupCounter++;
  const attachmentDepth = typeof partial.attachmentDepth === 'number' && Number.isFinite(partial.attachmentDepth)
    ? Math.max(0, Math.floor(partial.attachmentDepth))
    : 0;
  const common = {
    id: partial.id ?? `g${Date.now().toString(36)}${groupCounter.toString(36)}`,
    name: partial.name ?? 'New group',
    auxiliaryPrefix: partial.auxiliaryPrefix ?? '',
    createNoteFile: partial.createNoteFile ?? true,
    extensionMode: partial.extensionMode === 'blocklist' ? 'blocklist' as const : 'allowlist' as const,
    watchedExtensions: normalizeExtensions(partial.watchedExtensions ?? ['.pdf']),
    excludedExtensions: normalizeExtensions(Array.isArray(partial.excludedExtensions)
      ? partial.excludedExtensions : DEFAULT_EXCLUDED_EXTENSIONS),
    templatePath: partial.templatePath ?? '',
    noteNameTemplate: partial.noteNameTemplate ?? '{{basename}}',
    linkTemplate: partial.linkTemplate ?? '[[{{name}}]]',
    embedAttachment: partial.embedAttachment ?? false,
    autoCreateOnNew: partial.autoCreateOnNew ?? true,
    syncUpdatedOnModify: partial.syncUpdatedOnModify ?? true,
    enablePdfMetadataExtraction: partial.enablePdfMetadataExtraction ?? true,
    enableDoiIsbnLookup: partial.enableDoiIsbnLookup ?? false,
    sanitizeListValues: partial.sanitizeListValues ?? true,
  };
  return partial.layout === 'folder'
    ? {
      ...common,
      layout: 'folder',
      collectionFolder: partial.collectionFolder ?? 'Library',
      attachmentDepth,
      includeSubfolders: partial.includeSubfolders === true,
    }
    : {
      ...common,
      layout: 'sidecar',
      resourceFolder: partial.resourceFolder ?? 'Attachments',
      noteFolder: partial.noteFolder ?? 'Library',
      mirrorFolderStructure: partial.mirrorFolderStructure ?? true,
    };
}

export function defaultSettings(): AttMetaMapSettings {
  return {
    version: SETTINGS_VERSION,
    language: 'auto',
    mapping: defaultMapping(),
    extraTemplateFolders: [],
    groups: [createGroup({ name: 'Attachments' })],
    attachmentRules: [],
    deletion: { resourceToNote: false, noteToResources: false, confirm: true },
  };
}

/** Sidecar always has a note; folder layout may be used as folder-only organization. */
export function groupCreatesNotes(group: MappingGroup): boolean {
  return group.layout === 'sidecar' || group.createNoteFile;
}

/** Reads only the current settings shape; retired fields are not carried forward. */
export function normalizeSettings(raw: unknown): AttMetaMapSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings();

  const candidate = raw as Partial<AttMetaMapSettings> & { groups?: MappingGroupInput[] };

  if (Array.isArray(candidate.groups)) {
    const mapping = { ...defaultMapping(), ...(candidate.mapping ?? {}) };
    const groups = candidate.groups
      .filter(group => group.layout === 'folder'
        ? typeof group.collectionFolder === 'string'
        : typeof group.resourceFolder === 'string' && typeof group.noteFolder === 'string')
      .map(group => {
        const clean = createGroup(group);
        clean.linkTemplate = unambiguousLinkTemplate(clean);
        return clean;
      });

    return {
      version: SETTINGS_VERSION,
      language: candidate.language ?? 'auto',
      mapping,
      extraTemplateFolders: candidate.extraTemplateFolders ?? [],
      groups: groups.length ? groups : defaultSettings().groups,
      attachmentRules: Array.isArray(candidate.attachmentRules)
        ? candidate.attachmentRules.map(rule => createAttachmentRule(rule))
        : [],
      deletion: {
        resourceToNote: candidate.deletion?.resourceToNote === true,
        noteToResources: candidate.deletion?.noteToResources === true,
        confirm: candidate.deletion?.confirm !== false,
      },
    };
  }

  return defaultSettings();
}
