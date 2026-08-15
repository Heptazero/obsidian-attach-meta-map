import i18next from 'i18next';
import en from './locales/en.json';

/**
 * Interpolation uses ${var} rather than i18next's default {{var}}, so that
 * strings documenting the note-name and link templates can show {{basename}}
 * literally instead of having it substituted away.
 */
export async function initI18n(): Promise<void> {
  const lang = window.localStorage.getItem('language') ?? 'en';
  await i18next.init({
    lng: lang,
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
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
