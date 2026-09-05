import i18next from 'i18next';
import { getLanguage } from 'obsidian';
import en from './locales/en.json';
import zh from './locales/zh.json';
import { UiLanguage } from '../types';

function resolveLanguage(preference: UiLanguage): string {
  if (preference !== 'auto') return preference;
  const appLanguage = getLanguage();
  return appLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * Interpolation uses ${var} rather than i18next's default {{var}}, so strings
 * documenting the note-name and link templates can show {{basename}} literally
 * instead of having it substituted away.
 */
export async function initI18n(preference: UiLanguage = 'auto'): Promise<void> {
  const lng = resolveLanguage(preference);

  if (i18next.isInitialized) {
    await i18next.changeLanguage(lng);
    return;
  }

  await i18next.init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    interpolation: {
      escapeValue: false,
      prefix: '${',
      suffix: '}',
    },
  });
}

export const t = (key: string, options?: Record<string, unknown>): string =>
  i18next.t(key, options);
