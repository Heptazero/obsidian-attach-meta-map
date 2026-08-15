import { App, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { MappingGroup } from './types';
import { NoteManager } from './note-manager';
import { groupForAttachment, groupForNote } from './paths';
import { t } from './i18n/i18n';

export interface Pair {
  group: MappingGroup;
  attachment: TFile | null;
  note: TFile | null;
}

/**
 * Puts the pair on screen the way you read: the source in the main area, its
 * note in the right sidebar. Works from either side of the pair, and creates
 * the note when there is none.
 */
export class PairOpener {
  /** The one sidebar tab this plugin drives. */
  private noteLeaf: WorkspaceLeaf | null = null;

  constructor(private app: App, private noteManager: NoteManager) {}

  resolvePair(file: TFile, groups: MappingGroup[]): Pair | null {
    const asAttachment = groupForAttachment(groups, file.path, file.extension);
    if (asAttachment) {
      return {
        group: asAttachment,
        attachment: file,
        note: this.noteManager.findNote(asAttachment, file.path),
      };
    }

    if (file.extension !== 'md') return null;
    const asNote = groupForNote(groups, file.path);
    if (!asNote) return null;
    return {
      group: asNote,
      note: file,
      attachment: this.noteManager.findAttachment(asNote, file),
    };
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

    if (pair.attachment) await this.showInMain(pair.attachment);
    if (note) await this.showInRightSidebar(note);
    else if (!pair.attachment) new Notice(t('notices.noAttachment', { file: file.name }));
  }

  private async showInMain(file: TFile): Promise<void> {
    const existing = this.findLeafShowing(file, false);
    if (existing) {
      this.app.workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  /**
   * One sidebar tab, reused. The leaf is deliberately not pinned: a pinned
   * leaf refuses the next file, which is what made every call open another tab.
   */
  private async showInRightSidebar(file: TFile): Promise<void> {
    const existing = this.findLeafShowing(file, true);
    if (existing) {
      this.noteLeaf = existing;
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    if (this.noteLeaf && this.isAttached(this.noteLeaf)) {
      await this.noteLeaf.openFile(file, { active: false });
      await this.app.workspace.revealLeaf(this.noteLeaf);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      await this.app.workspace.getLeaf('split').openFile(file);
      return;
    }
    await leaf.openFile(file, { active: false });
    this.noteLeaf = leaf;
    await this.app.workspace.revealLeaf(leaf);
  }

  private isAttached(leaf: WorkspaceLeaf): boolean {
    let alive = false;
    this.app.workspace.iterateAllLeaves(candidate => {
      if (candidate === leaf) alive = true;
    });
    return alive && leaf.getRoot() === this.app.workspace.rightSplit;
  }

  private findLeafShowing(file: TFile, inRightSidebar: boolean): WorkspaceLeaf | null {
    const rightRoot = this.app.workspace.rightSplit;
    let found: WorkspaceLeaf | null = null;

    this.app.workspace.iterateAllLeaves(leaf => {
      if (found) return;
      const shown = (leaf.view as unknown as { file?: TFile }).file;
      if (!shown || shown.path !== file.path) return;
      const isRight = leaf.getRoot() === rightRoot;
      if (isRight === inRightSidebar) found = leaf;
    });

    return found;
  }
}
