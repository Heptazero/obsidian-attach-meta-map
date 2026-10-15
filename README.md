# Att Meta Map — attachment notes and organization for Obsidian

[简体中文](./README.zh-CN.md)

Att Meta Map is an **Obsidian plugin for creating Markdown companion notes for PDFs and other attachments, filling note properties from file/PDF metadata, and organizing attachments with folder and naming rules**. Use it for a document library, research papers with original and translated PDFs, or attachments that need searchable note properties.

Keep files in place with **Sidecar** notes, or collect a resource and its note in an item folder with **Folder** layout. A note's `source` property explicitly links its files; one note can describe several resources, not just one PDF.

[Install](#install) · [Quick start](#quick-start) · [Common questions](#common-questions) · [Automation and safety](#automation-and-safety)

## Which workflow do you need?

| What you might ask | What Att Meta Map provides |
|---|---|
| How do I automatically create a Markdown note for each PDF in Obsidian? | [Mapping groups](#choose-a-sidecar-or-folder-layout) can create companion notes for new matching attachments. Existing files use the batch backfill preview. |
| Can I put PDF title, author, and page count into note properties? | [Template-driven metadata](#let-templates-control-metadata) fills configured frontmatter fields from PDF/file metadata, with optional DOI/ISBN lookup. It does not summarize the paper. |
| Can an original PDF, a translated PDF, and slides share one note? | A [`source` link list](#keep-one-explicit-relationship) associates multiple resources with one note. Folder groups can recognize configured companion prefixes; the plugin does not translate files. |
| How do I open an attachment beside its note and manage the links? | **Open paired view** opens the pair; the **Resource relations** panel lists, opens, and unbinds `source` entries without deleting files. See [commands](#commands-and-file-menus). |
| Can I organize attachments into per-item folders, or keep PDFs where they are? | [Folder and Sidecar layouts](#layout-details) support both. Folder layout has depth controls and can organize files without creating notes. |
| Can I watch all document types instead of listing every extension? | Use [Blocklist](#watch-selected-extensions-or-all-attachments) and clear its exclusions. Markdown remains excluded; no literal `*` is supported. |
| Can I move and rename attachments by extension, source folder, and priority? | [Ordered attachment rules](#organize-unmanaged-attachments-with-ordered-rules) provide include/exclude conditions and sequential numbering. These rules are manual, previewed, and limited to files outside mapping-group roots. |
| Can deleting a PDF also delete its note, or vice versa? | [Optional source-linked deletion](#automation-and-safety) supports both directions with shared-resource protection. Both plugin directions default to off; native Obsidian cleanup is handled separately. |

**Before enabling automation:** Folder layout moves matching files; Sidecar layout leaves resources in place. Automatic mapping events do not show a batch confirmation. Start with a small test folder and read [Automation and safety](#automation-and-safety), especially when sync tools or other attachment managers also modify the vault.

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
- **Folder** uses one collection root. You select a depth for loose attachments: root files are depth `0`, the next level is depth `1`, and so on. **Include deeper subfolders** optionally extends this to all deeper levels; it defaults to off.

At any configured depth, a loose resource is folded into its matching item folder and, when enabled, gets a note beside it. If its current parent already matches the item name, that folder is reused and only the note is created. Existing `source` relations remain authoritative and are never folded again.

Folder groups can recognize several companion prefixes such as `cn_`, `zh_`, or `slides_`. A companion whose remaining name matches an existing item joins that item folder and is appended to the note's `source` list.

### Watch selected extensions or all attachments

In **Settings → Att Meta Map → your mapping group → Paths & files → Extension filter**, select:

- **Allowlist** (default): process only listed suffixes, such as `.pdf, .epub`. An empty allowlist processes nothing.
- **Blocklist**: process every attachment except listed suffixes. An empty blocklist includes all attachment types, even extensionless files, within the group's folder/depth scope. Use this for a Documents folder without maintaining a long extension list; a literal `*` is not supported.

The initial blocklist is `.md, .canvas, .base`. Canvas and Base can be removed. Markdown is always excluded, even if removed or explicitly allowed, to prevent generated notes from recursively spawning notes.

Both lists are saved independently and restored when switching modes. The original `watchedExtensions` setting remains the allowlist, so existing groups keep their behavior. Right-click, batch, and automatic processing share this filter and the existing folder-depth policy. Existing `source` relationships can still be opened regardless of the filter. See the [filter implementation](./src/extension-filter.ts) and [tests](./tests/extension-filter.test.ts).

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

For example, place a PDF-specific rule for `Inbox/Papers` first and a broader fallback rule last. A matching file uses the first rule only, not every matching rule. Conditions have separate include/exclude fields; this is not a scripting language. See the [rule planner](./src/attachment-rules.ts).

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

For example, one paper note can link to three existing files:

```yaml
---
source:
  - "[[paper.pdf]]"
  - "[[cn_paper.pdf]]"
  - "[[paper-slides.pptx]]"
---
```

These links define the relationship whether the resources share a folder or live separately. Ordinary body links and backlinks do not establish this binding. Adding several `source` links does not translate, copy, or merge the files. See the [source-link parser](./src/resource-links.ts).

## Layout details

### Sidecar

Sidecar groups configure a resource root and a note root separately. Resources are never moved by the mapping feature. Notes may mirror the resource subfolder structure or remain flat.

### Folder

Folder groups configure one collection root, a loose attachment depth, and an optional **Include deeper subfolders** toggle.

- At any depth, create or reuse the matching item folder, move the attachment when needed, and optionally create the note.
- A current parent whose name matches the rendered item name is reused, so an already placed attachment only receives its missing note.
- With the toggle off, only the selected loose depth is handled, plus matching item folders one level below for missing-note recovery. With it on, the selected depth and every deeper level are handled. Shallower files remain ignored: selecting depth `1` includes `1, 2, 3…`, never `0`.
- At deeper levels, the current category folders remain in place; item folders are created or reused beside each resource. Existing source-bound items are skipped and nested groups retain their matching priority.
- After a `source` relation exists, folder names may be changed freely because they do not define the relationship.

Disable **Create a note for new attachments** when you only want folder organization. The item folder is still created or reused, but templates, metadata extraction, and note maintenance are disabled for that group.

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

In organization and backfill previews, red `−` means a file leaves its old path; it does not mean deletion. Green `+` means a new path, note, or `source` value will appear. Cancelling those previews performs zero writes. Linked deletion has its own preview, where red means moving a remaining file to trash or removing a `source` entry.

## Automation and safety

Mapping groups register `create`, `rename`, and `modify` listeners while the plugin is enabled. Scripts, sync tools, and Git operations may therefore trigger the same events as changes made in Obsidian. General attachment rules do not register automatic listeners.

Linked deletion is optional under **General → Linked deletion**. The plugin's two directions default to off; change confirmation defaults to on. With resource-to-note deletion off, a deleted resource leaves its note and broken `source` link intact.

On Obsidian 1.12+, when **Files & Links → Delete attachments when deleting files** is set to **Ask each time** (Obsidian's default) or **Always**, the note-to-resources row appears checked and disabled, with a small label showing that Obsidian handles it. The plugin skips this direction, preventing a second confirmation window. Native cleanup follows Obsidian's link rules and confirmation preference; the plugin's preview toggle does not control it. Set the native preference to **Never** to enable the plugin's source-only option. Its previous toggle value is retained. Earlier Obsidian versions keep the plugin option available.

Detection uses the vault's actual configuration directory, refreshes when settings open and every two seconds, and rechecks before plugin deletion. The plugin never writes native settings. If native configuration cannot be read, this direction is paused until detection recovers.

- **Resource → note:** deleting the last `source` resource moves the managed note to trash. If other `source` entries remain, including unresolved links, only the deleted resource's entry is removed.
- **Note → resources:** deleting a managed note moves its resolved `source` resources to trash, except resources still referenced by any other note's `source`. Markdown and Canvas targets are excluded.
- **Confirmation:** shows the remaining changes as a folder tree. The first file has already been deleted by Obsidian; cancelling preserves the other files and their properties, and does not restore the first file. Turning confirmation off applies the same rules automatically.

Only notes in note roots of groups that create notes trigger linked deletion. Resources may be anywhere if their `source` binding was resolved while they existed. The plugin remembers relations during the current session; it does not infer them from names or delete old orphan notes on startup. It follows individual file deletion events; folder events themselves do not trigger a recursive cascade. Sync, scripts, and Git can also produce deletion events, so enable these settings only where this behavior is intended.

All plugin-triggered file deletions use Obsidian's trash preference (vault `.trash` or system trash); no permanent deletion fallback is used. Pending previews are serialized. Restoring the first file, changing a candidate file or its relations, disabling the direction, or unloading the plugin stops the pending operation. Plugin-triggered deletions do not cascade again. A failed operation stops and reports an error; already completed steps remain in trash.

Additional boundaries:

- Only properties accepted by both the template and mapping are written.
- Modified-time sync updates a property only when the note already contains it.
- Occupied note names fall back to an extension-qualified name; existing files are never overwritten.
- Batch moves use a pre-execution snapshot and temporary names. If state changes after preview, the entire batch is rejected; failed moves attempt to restore their original paths.
- Folder layout follows the configured depth scope (including deeper levels only when enabled) and marks its own moves so the rename listener does not process them again.

Changes to `data.json` are loaded only when the plugin starts. Disable and re-enable the plugin, use *View → Force Reload*, or restart Obsidian after editing that file externally.

## Common questions

### Does Att Meta Map convert PDFs to Markdown, translate papers, or extract annotations?

No. A companion note is a Markdown file linked to the attachment, not a conversion of its contents. Att Meta Map reads PDF metadata and can look up bibliographic fields using a detected DOI/ISBN; it does not provide OCR, full-text conversion, translation, annotation extraction, citation counts, or AI summaries. Use separate tools for those tasks and link their resulting files through `source` when appropriate.

### Is it only for PDFs, or can I manage EPUBs, images, and slides?

Mapping groups can create companion notes for non-Markdown file types allowed by their extension filter, including EPUBs, images, and slide files. General file metadata is available for these attachments; embedded title/author/page metadata extraction is PDF-specific. Linking a file does not add a new viewer for its format.

### Can it replace an attachment-management plugin?

For manual, rule-based moves and renames outside mapping-group roots, Att Meta Map includes attachment-management features. It is not a drop-in replacement for every attachment manager: general rules do not intercept paste/drop events, override Obsidian's attachment-location setting, or run automatically. Mapping-group creation has its own automatic listeners. Avoid assigning overlapping file-moving responsibilities to multiple plugins.

### Does it need an AI service, account, or internet connection?

No AI service or account is required. Creating companion notes, local PDF metadata extraction, relationship management, and attachment organization work locally. Optional DOI/ISBN lookup uses Crossref/Open Library and requires a network connection; it is off by default.

## Privacy, language, and architecture

- Notes, attachments, settings, and extracted PDF metadata stay inside the Obsidian vault.
- DOI/ISBN lookup is disabled by default. When enabled, the detected DOI is sent to Crossref or the detected ISBN is sent to Open Library to retrieve bibliographic metadata.
- Att Meta Map has no account, telemetry, advertisements, or access to files outside the vault.

The interface can follow Obsidian or be switched directly between Chinese and English. Translation keys are kept in `src/i18n/locales/en.json` and `src/i18n/locales/zh.json`; UI code does not contain parallel hard-coded copies.

The implementation keeps deterministic policy separate from Obsidian mutations:

- `settings-model.ts` owns defaults and persisted-setting normalization.
- `sources.ts` resolves metadata; `metadata-types.ts` contains its shared data model.
- `metadata-diff.ts` defines refresh and safe-fill decisions without depending on a modal.
- `paths.ts` owns deterministic folder, name, and link policy.
- `creation-plan.ts` defines previewable note/folder changes.
- `attachment-rules.ts` plans general attachment moves; `attachment-organizer.ts` executes confirmed plans.
- `note-manager.ts` is the Obsidian-facing service that resolves relationships and performs guarded note operations.
- `deletion-policy.ts` plans linked changes from explicit source snapshots; `deletion-manager.ts` maintains the session index and applies guarded trash/property changes; `deletion-modal.ts` shows the confirmation tree.

## Development

```bash
npm install
npm run pipeline
```

The pipeline runs the Obsidian lint rules, unit tests with coverage, TypeScript checking, and the production bundle. Obsidian releases contain `main.js`, `manifest.json`, and `styles.css`.

Issues and contributions are welcome in the [GitHub repository](https://github.com/Heptazero/obsidian-attach-meta-map).

## License

MIT. See [LICENSE](LICENSE). Original Attachments Library copyright belongs to José Compadre Junior.
