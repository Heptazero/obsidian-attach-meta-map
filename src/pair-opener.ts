import { App, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { MappingGroup } from './types';
import { NoteManager } from './note-manager';
import { groupForAttachment, groupForFoldedAttachment, groupForNote } from './paths';
import { t } from './i18n/i18n';

export interface Pair {
  group: MappingGroup;
  attachment: TFile | null;
  note: TFile | null;
}

/**
 * Puts the pair on screen the way you read: the source and its note side by
 * side in the main area (source left, note right), not in the sidebar —
 * Obsidian gives no public API to set the pane-size ratio, so the source
 * pane starts equal width; drag the divider once and Obsidian remembers it
 * for the rest of the session. Works from either side of the pair, and
 * creates the note when there is none.
 */
export class PairOpener {
  /** The one note-side leaf this plugin drives, reused across calls. */
  private noteLeaf: WorkspaceLeaf | null = null;

  constructor(private app: App, private noteManager: NoteManager) {}

  resolvePair(file: TFile, groups: MappingGroup[]): Pair | null {
    if (file.extension === 'md') {
      const asNote = groupForNote(groups, file.path);
      if (asNote) {
        return {
          group: asNote,
          note: file,
          attachment: this.noteManager.findAttachment(asNote, file),
        };
      }
      return null;
    }

    const linked = this.noteManager.findNoteBySource(groups, file.path);
    if (linked) return { group: linked.group, attachment: file, note: linked.note };

    const asAttachment = groupForAttachment(groups, file.path, file.extension);
    if (asAttachment) {
      return {
        group: asAttachment,
        attachment: file,
        note: this.noteManager.findNote(asAttachment, file.path),
      };
    }

    // Not markdown, not under any configured resource root: might already be a
    // folded attachment, sitting beside its note (if the group even creates
    // one — createNoteFile: false groups never do) inside a folder-layout
    // collection.
    const asFolded = groupForFoldedAttachment(groups, file.path);
    if (!asFolded) return null;
    return { group: asFolded, attachment: file, note: this.noteManager.findNote(asFolded, file.path) };
  }

  async openPair(file: TFile, groups: MappingGroup[], createIfMissing = true): Promise<void> {
    const pair = this.resolvePair(file, groups);
    if (!pair) {
      new Notice(t('notices.noGroup', { file: file.name }));
      return;
    }

    let { note } = pair;
    if (!note && pair.attachment && createIfMissing) {
      note = await this.noteManager.createNote(pair.attachment, pair.group);
    }

    const attachmentLeaf = pair.attachment ? await this.showInMain(pair.attachment, note) : null;

    if (note && attachmentLeaf) {
      await this.showBeside(attachmentLeaf, note);
    } else if (note) {
      await this.showInMain(note, null);
    } else if (!pair.attachment) {
      new Notice(t('notices.noAttachment', { file: file.name }));
    }
  }

  /**
   * `avoid`: never land on a leaf that is currently showing this file — the
   * command can fire while the note itself is the active tab, and with both
   * panes now living in the main area, {@link Workspace.getLeaf}(false)
   * would otherwise hand back that very leaf and the note it's showing would
   * be silently replaced by the attachment.
   */
  private async showInMain(file: TFile, avoid: TFile | null): Promise<WorkspaceLeaf> {
    const existing = this.findLeafShowing(file, true);
    if (existing) {
      this.app.workspace.setActiveLeaf(existing, { focus: true });
      return existing;
    }

    let leaf = this.app.workspace.getLeaf(false);
    const shown = (leaf.view as unknown as { file?: TFile }).file;
    if (avoid && shown?.path === avoid.path) {
      leaf = this.app.workspace.getLeaf(true);
    }
    await leaf.openFile(file);
    return leaf;
  }

  /**
   * One note-side leaf, reused. Never pinned: a pinned leaf refuses the next
   * file, which is what previously made every call open another tab.
   */
  private async showBeside(attachmentLeaf: WorkspaceLeaf, note: TFile): Promise<void> {
    const existing = this.findLeafShowing(note, true);
    if (existing && existing !== attachmentLeaf) {
      this.noteLeaf = existing;
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    if (this.noteLeaf && this.noteLeaf !== attachmentLeaf && this.isAttached(this.noteLeaf)) {
      await this.noteLeaf.openFile(note, { active: false });
      await this.app.workspace.revealLeaf(this.noteLeaf);
      return;
    }

    // before=false: the new leaf lands after (to the right of, for a
    // vertical split) the attachment leaf.
    const leaf = this.app.workspace.createLeafBySplit(attachmentLeaf, 'vertical', false);
    await leaf.openFile(note, { active: false });
    this.noteLeaf = leaf;
  }

  private isAttached(leaf: WorkspaceLeaf): boolean {
    let alive = false;
    this.app.workspace.iterateAllLeaves(candidate => {
      if (candidate === leaf) alive = true;
    });
    return alive && leaf.getRoot() === this.app.workspace.rootSplit;
  }

  private findLeafShowing(file: TFile, inMainArea: boolean): WorkspaceLeaf | null {
    const mainRoot = this.app.workspace.rootSplit;
    let found: WorkspaceLeaf | null = null;

    this.app.workspace.iterateAllLeaves(leaf => {
      if (found) return;
      const shown = (leaf.view as unknown as { file?: TFile }).file;
      if (!shown || shown.path !== file.path) return;
      const isMain = leaf.getRoot() === mainRoot;
      if (isMain === inMainArea) found = leaf;
    });

    return found;
  }
}
