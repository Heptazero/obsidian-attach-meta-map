# Att Meta Map

[简体中文](./README.zh-CN.md)

Att Meta Map turns resource collections into index notes in Obsidian. The model is deliberately simple: **`source` defines the relationship, the template defines the fields, and the mapping defines where other values come from.**

Forked from [Attachments Library](https://github.com/compadrejunior/attachments-library) by José Compadre Junior (MIT).

## What it does

### Keep one explicit relationship

Every managed note has a fixed `source` property containing one wikilink or a list of wikilinks. That property is the only authority for deciding which resources belong to the note.

- Same names, folders, and file sizes never create an existing relationship by themselves.
- One note can point to an original PDF, a translation, slides, data, or other companion material.
- From either the note or any linked resource, **Open paired view** opens the resources on the left and reuses one note tab on the right.
- The **Resource relations** side panel lists every `source` entry and lets you open or explicitly unbind it. Unbinding never deletes a file.

### Choose a sidecar or folder layout

- **Sidecar** keeps resources and notes under separate roots. Resources stay in place; notes can mirror the resource folder structure.
- **Folder** uses one collection root. You select the exact attachment depth: root files are depth `0`, the next level is depth `1`, and so on.

At folder depth `0`, a loose resource is folded into a new item folder and, when enabled, gets a note beside it. At depth `1` or deeper, its current parent is already the final item folder, so Att Meta Map creates the note in place and never adds another nested folder.

Folder groups can recognize several companion prefixes such as `cn_`, `zh_`, or `slides_`. A companion whose remaining name matches an existing item joins that item folder and is appended to the note's `source` list.

### Let templates control metadata

Each group selects one Markdown template. Its frontmatter keys are the allow-list for the note; a global mapping says which source may fill each key.

Available sources include:

- vault and filename values: path, name, extension, size, dates, and parsed year/title
- PDF metadata: title, author, subject, keywords, dates, creator, producer, and page count
- optional online lookup: DOI or ISBN, title, author, and year

Several sources may map to the same property. The first non-empty value wins, so filename or PDF metadata is not overwritten by a later network result. Re-extraction shows the current and incoming values side by side; nothing is overwritten without the selected row.

### Organize unmanaged attachments with ordered rules

Attachment rules move and rename files that are outside every mapping-group resource root.

- Rules run from top to bottom and stop after the first match.
- Multiple values in one field are OR; different fields are AND; exclusions are NOT; an empty field means unrestricted.
- Source folders and extensions use fuzzy suggestions from the current vault.
- Naming supports `{{basename}}`, `{{parent}}`, `{{note}}`, and `{{index}}`.
- `{{index}}` is recalculated from a complete target snapshot and uses the smallest available positive integers, so a folder containing `1` and `82` can be compacted to `1` and `2`.

Mapping-group roots are a hard protection boundary. General rules never touch files already owned by a group. Rules are manual only and always show the complete change tree before confirmation.

## Install

### Obsidian Community plugins

After Att Meta Map is accepted into the Obsidian Community directory, install it from *Settings → Community plugins → Browse*.

### BRAT or manual installation

Until then, add `Heptazero/obsidian-attach-meta-map` in [BRAT](https://obsidian.md/plugins?id=obsidian42-brat), or download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Heptazero/obsidian-attach-meta-map/releases/latest) into:

```text
<vault>/.obsidian/plugins/att-meta-map/
```

Then reload Obsidian and enable **Att Meta Map** under *Community plugins*.

## Quick start

1. Open *Settings → Att Meta Map* and choose Chinese, English, or *Follow Obsidian* as the interface language.
2. Add a mapping group and choose **Sidecar** or **Folder**.
3. Select its resource folder, template, watched extensions, and creation behavior.
4. Right-click one resource and choose **Open paired view**. If no note exists, the planned note or folder is created according to the group.
5. Before a large backfill, inspect the complete red/green folder tree and confirm only when every target is correct.

## Relationship model

The model has three rules:

1. **`source` is fixed.** It is not part of the configurable metadata mapping.
2. **The template decides which metadata fields exist.** Adding a frontmatter key to the template enables that field for the group.
3. **The global mapping decides where values come from.** If `PDF author → author` is configured but the template has no `author` key, nothing is written.

The template is therefore the field switch. Att Meta Map always maintains `source`; every other property must be accepted by both the template and the mapping.

## Layout details

### Sidecar

Sidecar groups configure a resource root and a note root separately. Resources are never moved by the mapping feature. Notes may mirror the resource subfolder structure or remain flat.

### Folder

Folder groups configure only one collection root and an exact attachment depth.

- Depth `0`: create an item folder, move the attachment into it, and optionally create the note.
- Depth `1+`: treat the current parent as the item folder; create the note beside the resource without moving it.
- Shallower and deeper files are ignored instead of being guessed into the group.
- Folder names may be changed freely because they do not define the relationship.

Disable **Create a note for new attachments** when you only want folder organization. The item folder is still created at depth `0`, but templates, metadata extraction, and note maintenance are disabled for that group.

## Templates and mappings

Att Meta Map automatically discovers the Templater `templates_folder` and the core Templates folder. Additional template folders can be added in settings.

The template body is copied to each new note. Existing frontmatter values such as `type: paper` or `status: active` are preserved. Templater `<% ... %>` blocks are removed rather than executed, because commands such as `tp.file.move()` can move the new note outside the configured relationship boundary. Run Templater manually afterward when dynamic template behavior is needed.

With no selected template, Att Meta Map uses a minimal built-in set: `source`, `title`, `author`, `created`, and `updated`. Empty properties are omitted.

Note and link templates support:

- `{{basename}}`, `{{name}}`, `{{ext}}`, `{{path}}`, and `{{folder}}`
- `{{year}}` and `{{title}}`, parsed from common `Author - Year - Title` filenames

If a note-name template requires `{{year}}` but the filename has no year, the whole template falls back to the safe filename instead of producing a malformed partial name. Ambiguous extensionless links are automatically rewritten so `[[paper]]` does not resolve to `paper.md` instead of `paper.pdf`.

## Commands and file menus

| Command | Action |
|---|---|
| Open paired view | Opens resources on the left and reuses one note tab on the right; creates a missing note when allowed |
| Re-extract metadata | Shows current and incoming values side by side and applies only selected rows |
| Unbind current resource | Removes selected `source` relationships after confirmation without moving or deleting files |
| Open resource relations | Opens the side panel for all `source` entries of the current note or resource |
| Backfill missing notes | Scans groups, previews every move/note/source change, then applies only after confirmation |
| Organize attachments linked by current note | Applies general attachment rules to unmanaged links from the active note |

File-menu actions also organize one note's attachments, one attachment, one folder, or one folder recursively. Every entry uses the same planner, preview, and guarded executor.

In change previews, red `−` means a file leaves its old path; it does not mean deletion. Green `+` means a new path, note, or `source` value will appear. Cancelling performs zero writes.

## Automation and safety

Mapping groups register `create`, `rename`, and `modify` listeners while the plugin is enabled. Scripts, sync tools, and Git operations may therefore trigger the same events as changes made in Obsidian. General attachment rules do not register automatic listeners.

Att Meta Map never listens for `delete` and never automatically deletes notes. If a resource disappears, the note and its inspectable broken `source` link remain.

Additional boundaries:

- Only properties accepted by both the template and mapping are written.
- Modified-time sync updates a property only when the note already contains it.
- Occupied note names fall back to an extension-qualified name; existing files are never overwritten.
- Batch moves use a pre-execution snapshot and temporary names. If state changes after preview, the entire batch is rejected; failed moves attempt to restore their original paths.
- Folder layout moves only depth-`0` resources and marks its own moves so the rename listener does not process them again.

Changes to `data.json` are loaded only when the plugin starts. Disable and re-enable the plugin, use *View → Force Reload*, or restart Obsidian after editing that file externally.

## Language and architecture

The interface can follow Obsidian or be switched directly between Chinese and English. Translation keys are kept in `src/i18n/locales/en.json` and `src/i18n/locales/zh.json`; UI code does not contain parallel hard-coded copies.

The implementation keeps deterministic policy separate from Obsidian mutations:

- `settings-model.ts` owns defaults and persisted-setting normalization.
- `sources.ts` resolves metadata; `metadata-types.ts` contains its shared data model.
- `metadata-diff.ts` defines refresh and safe-fill decisions without depending on a modal.
- `paths.ts` owns deterministic folder, name, and link policy.
- `creation-plan.ts` defines previewable note/folder changes.
- `attachment-rules.ts` plans general attachment moves; `attachment-organizer.ts` executes confirmed plans.
- `note-manager.ts` is the Obsidian-facing service that resolves relationships and performs guarded note operations.

## Development

```bash
npm install
npm run pipeline
```

The pipeline runs the Obsidian lint rules, unit tests with coverage, TypeScript checking, and the production bundle. Obsidian releases contain `main.js`, `manifest.json`, and `styles.css`.

Issues and contributions are welcome in the [GitHub repository](https://github.com/Heptazero/obsidian-attach-meta-map).

## License

MIT. See [LICENSE](LICENSE). Original Attachments Library copyright belongs to José Compadre Junior.
