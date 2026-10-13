import { describe, expect, it, vi } from 'vitest';
import { createGroup, normalizeSettings } from '../src/settings-model';
import { renderExtensionFilter } from '../src/extension-filter-settings';
import { initI18n } from '../src/i18n/i18n';

interface Control {
  value: string;
  change: (value: string) => Promise<void>;
}
interface Row {
  name: string;
  desc: string;
  text?: Control;
  dropdown?: Control;
}
interface Host { rows: Row[] }

vi.mock('obsidian', async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>();
  class MockControl implements Control {
    value = '';
    change = async (_value: string): Promise<void> => {};
    setValue(value: string): this { this.value = value; return this; }
    setPlaceholder(_value: string): this { return this; }
    addOption(_value: string, _label: string): this { return this; }
    onChange(callback: (value: string) => Promise<void>): this { this.change = callback; return this; }
  }
  class MockSetting implements Row {
    name = '';
    desc = '';
    text?: MockControl;
    dropdown?: MockControl;
    constructor(host: Host) { host.rows.push(this); }
    setName(name: string): this { this.name = name; return this; }
    setDesc(desc: string): this { this.desc = desc; return this; }
    addText(callback: (control: MockControl) => void): this {
      this.text = new MockControl(); callback(this.text); return this;
    }
    addDropdown(callback: (control: MockControl) => void): this {
      this.dropdown = new MockControl(); callback(this.dropdown); return this;
    }
  }
  return { ...original, Setting: MockSetting };
});

describe('extension filter setting controls (not a live UI test)', () => {
  it('switches editor contents and labels without losing either list or rebuilding rows', async () => {
    await initI18n('en');
    const host: Host = { rows: [] };
    const group = createGroup();
    const saved: unknown[] = [];
    renderExtensionFilter(host as unknown as HTMLElement, group, async () => {
      saved.push(JSON.parse(JSON.stringify({ groups: [group] })));
    });
    const [mode, list] = host.rows;
    expect(mode.dropdown!.value).toBe('allowlist');
    expect(list.name).toBe('Watched extensions');
    expect(list.text!.value).toBe('.pdf');
    await list.text!.change('pdf, epub');
    await mode.dropdown!.change('blocklist');
    expect(list.name).toBe('Excluded extensions');
    expect(list.text!.value).toBe('.md, .canvas, .base');
    await list.text!.change('zip');
    await mode.dropdown!.change('allowlist');
    expect(list.text!.value).toBe('.pdf, .epub');
    await mode.dropdown!.change('blocklist');
    expect(list.text!.value).toBe('.zip');
    expect(host.rows).toHaveLength(2);
    expect(normalizeSettings(saved.at(-1)).groups[0]).toMatchObject({
      extensionMode: 'blocklist', watchedExtensions: ['.pdf', '.epub'], excludedExtensions: ['.zip'],
    });
  });

  it('renders a saved empty blocklist in Chinese, then restores its allowlist', async () => {
    await initI18n('zh');
    const host: Host = { rows: [] };
    const group = createGroup({ extensionMode: 'blocklist', excludedExtensions: [] });
    const save = vi.fn(async () => {});
    renderExtensionFilter(host as unknown as HTMLElement, group, save);
    const [mode, list] = host.rows;
    expect(mode.name).toBe('后缀筛选方式');
    expect(list.name).toBe('排除的扩展名');
    expect(list.text!.value).toBe('');
    expect(list.desc).toContain('留空处理全部附件');
    await mode.dropdown!.change('allowlist');
    expect(list.text!.value).toBe('.pdf');
    expect(list.name).toBe('监听的扩展名');
    expect(group.excludedExtensions).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
