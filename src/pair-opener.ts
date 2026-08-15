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
 * note pinned in the right sidebar. Works from either side of the pair.
 */
export class PairOpener {
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

  private async showInRightSidebar(file: TFile): Promise<void> {
    const existing = this.findLeafShowing(file, true);
    if (existing) {
      existing.setPinned(true);
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      await this.app.workspace.getLeaf('split').openFile(file);
      return;
    }
    await leaf.openFile(file, { active: false });
    leaf.setPinned(true);
    await this.app.workspace.revealLeaf(leaf);
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
