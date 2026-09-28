import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';

const source = new URL('../resources/locales/', import.meta.url);
const files = (await readdir(source)).filter(name => name.endsWith('.json')).sort();
const english = JSON.parse(await readFile(new URL('english.json', source), 'utf8')) as Record<string, string>;
const keys = Object.keys(english).sort();

test('all supported Steam client languages have source files', () => {
  const supported = `bulgarian schinese tchinese czech danish dutch english finnish french german
    greek hungarian indonesian italian japanese koreana latam malay norwegian polish
    portuguese brazilian romanian russian spanish swedish thai turkish ukrainian vietnamese`.split(/\s+/);
  expect(files).toEqual(supported.map(language => `${language}.json`).sort());
  expect(keys.length).toBeGreaterThan(0);
});

for (const file of files.filter(name => name !== 'english.json')) {
  test(`${file} contains every English string`, async () => {
    const strings = JSON.parse(await readFile(new URL(file, source), 'utf8')) as Record<string, unknown>;
    const missing = keys.filter(key => typeof strings[key] !== 'string' || !strings[key].trim());
    expect(missing).toEqual([]);
  });
}

test('generated locales match their source files', async () => {
  const locales = JSON.parse(await readFile(new URL('../resources/locales.json', import.meta.url), 'utf8')) as Record<string, Record<string, string>>;
  expect(Object.keys(locales).map(language => `${language}.json`).sort()).toEqual(files);

  for (const file of files) {
    const language = file.slice(0, -5);
    expect(locales[language]).toEqual(JSON.parse(await readFile(new URL(file, source), 'utf8')));
  }
});
