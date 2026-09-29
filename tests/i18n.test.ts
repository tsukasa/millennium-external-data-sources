import { beforeEach, expect, test } from 'bun:test';
import { installBackend, initI18n, getPluginI18nString } from './helpers/ui-runtime';

beforeEach(installBackend);

test('plugin strings follow the Steam client language and fall back to English', async () => {
  const original = globalThis.SteamClient;
  let language = 'german';
  try {
    Object.assign(globalThis, { SteamClient: { ...original, Settings: { GetCurrentLanguage: async () => language } } });
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('Externe Datenquellen');
    expect(getPluginI18nString('save')).toBe('Speichern');

    language = 'french';
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('Sources de données externes');

    language = 'unsupported-language';
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('External Data Sources');
    expect(getPluginI18nString('save')).toBe('Save');
  } finally {
    Object.assign(globalThis, { SteamClient: original });
    await initI18n();
  }
});
