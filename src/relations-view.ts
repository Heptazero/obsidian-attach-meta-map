import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { MappingGroup } from './types';
import { NoteManager, RelationContext } from './note-manager';
import { t } from './i18n/i18n';

export const RESOURCE_RELATIONS_VIEW = 'att-meta-map-relations';

export class ResourceRelationsView extends ItemView {
  private contextFile: TFile | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private noteManager: NoteManager,
    private groups: () => MappingGroup[],
    private requestUnbind: (context: RelationContext, target: string) => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return RESOURCE_RELATIONS_VIEW;
  }

  getDisplayText(): string {
    return t('relations.title');
  }

  getIcon(): string {
    return 'links';
  }

  onOpen(): Promise<void> {
    this.contextFile = this.app.workspace.getActiveFile();
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (file) this.contextFile = file;
      this.render();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', file => {
      const context = this.resolveContext();
      if (!context || file.path === context.note.path) this.render();
    }));
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('amm-relations-view');

    const context = this.resolveContext();
    if (!context) {
      contentEl.createDiv({ cls: 'amm-relations-empty', text: t('relations.empty') });
      return;
    }

    const heading = contentEl.createDiv({ cls: 'amm-relations-heading' });
    heading.createDiv({ cls: 'amm-relations-label', text: t('relations.currentNote') });
    const noteButton = heading.createEl('button', {
      cls: 'amm-relations-note',
      text: context.note.basename,
      attr: { type: 'button', title: context.note.path },
    });
    noteButton.addEventListener('click', () => this.openFile(context.note));

    const list = contentEl.createDiv({ cls: 'amm-relations-list' });
    for (const relation of context.relations) {
      const row = list.createDiv({ cls: 'amm-relation-row' });
      const identity = row.createDiv({ cls: 'amm-relation-identity' });
      const resource = identity.createEl('button', {
        cls: 'amm-relation-resource',
        text: relation.file?.name ?? relation.target,
        attr: {
          type: 'button',
          title: relation.file?.path ?? relation.target,
          'aria-disabled': String(!relation.file),
        },
      });
      resource.disabled = !relation.file;
      if (relation.file) resource.addEventListener('click', () => this.openFile(relation.file!));
      identity.createDiv({
        cls: `amm-relation-path${relation.file ? '' : ' is-missing'}`,
        text: relation.file?.path ?? t('relations.missing'),
      });

      const unlink = row.createEl('button', {
        cls: 'clickable-icon amm-relation-unlink',
        attr: { type: 'button', 'aria-label': t('relations.unbind'), title: t('relations.unbind') },
      });
      setIcon(unlink, 'unlink');
      unlink.addEventListener('click', () => this.requestUnbind(context, relation.target));
    }
  }

  private resolveContext(): RelationContext | null {
    return this.contextFile
      ? this.noteManager.resolveRelationContext(this.contextFile, this.groups())
      : null;
  }

  private openFile(file: TFile): void {
    const leaf = this.app.workspace.getLeaf(false);
    if (!leaf) {
      new Notice(t('relations.openFailed'));
      return;
    }
    leaf.openFile(file).catch(() => new Notice(t('relations.openFailed')));
  }
}
