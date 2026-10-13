import { Setting, TextComponent } from 'obsidian';
import type { MappingGroup } from './types';
import { activeExtensions, setActiveExtensions } from './extension-filter';
import { t } from './i18n/i18n';

/** One editor for two independently persisted lists; switching does not rebuild the group. */
export function renderExtensionFilter(
  container: HTMLElement, group: MappingGroup, save: () => Promise<void>,
): void {
  let extensionText: TextComponent;
  const refresh = (): void => {
    const blocked = group.extensionMode === 'blocklist';
    extensionSetting
      .setName(t(blocked ? 'settings.group.extensions.excludedName' : 'settings.group.extensions.name'))
      .setDesc(t(blocked ? 'settings.group.extensions.blocklistDesc' : 'settings.group.extensions.desc'));
    extensionText.setPlaceholder(blocked ? '.md, .canvas, .base' : '.pdf, .epub')
      .setValue(activeExtensions(group).join(', '));
  };

  new Setting(container)
    .setName(t('settings.group.extensionMode.name'))
    .addDropdown(dropdown => dropdown
      .addOption('allowlist', t('settings.group.extensionMode.allowlist'))
      .addOption('blocklist', t('settings.group.extensionMode.blocklist'))
      .setValue(group.extensionMode)
      .onChange(async value => {
        group.extensionMode = value === 'blocklist' ? 'blocklist' : 'allowlist';
        refresh();
        await save();
      }));

  const extensionSetting = new Setting(container).addText(text => {
    extensionText = text;
    text.onChange(async value => {
      setActiveExtensions(group, value.split(','));
      await save();
    });
  });
  refresh();
}
