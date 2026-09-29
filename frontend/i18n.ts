import locales from '../resources/locales.json';

/**
 * English translations used when a language or translation key is unavailable.
 */
const english = locales.english;

/**
 * Translation keys defined by the English locale.
 */
type TranslationKey = keyof typeof english;

/**
 * Available translations indexed by Steam's language names.
 */
const translations: Record<string, Partial<Record<TranslationKey, string>>> = locales;

/**
 * Translations selected for the current Steam client language.
 */
let current: Partial<Record<TranslationKey, string>> = english;

/**
 * Loads the Steam client language and selects its translations, falling back to English.
 * @remarks Falls back to English if the current Steam client language is unavailable.
 * @returns A promise that resolves once the translations have been initialized.
 */
export async function initI18n(): Promise<void> {
  try {
    const language = await SteamClient.Settings.GetCurrentLanguage();
    current = translations[language.toLowerCase()] || english;
  } catch {
    current = english;
  }
}

/**
 * Gets a plugin translation for the current language, falling back to English.
 * @param key Translation key from the English locale.
 * @returns The translated string, or its English equivalent.
 */
export function getPluginI18nString(key: TranslationKey): string {
  return current[key] || english[key];
}
