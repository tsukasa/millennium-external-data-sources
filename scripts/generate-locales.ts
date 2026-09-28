import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*****************************************************************************/
/* Main Block                                                                */
/*****************************************************************************/

console.log('Starting locale generation...');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'resources', 'locales');
const output = join(root, 'resources', 'locales.json');

const files = (await readdir(source))
  .filter(name => name.endsWith('.json'))
  .sort();

if (!files.includes('english.json'))
  throw new Error('Missing resources/locales/english.json');

for (const file of files) {
  if (!/^[a-z]+\.json$/.test(file))
    throw new Error(`Invalid locale filename: ${file}`);
}

await generateLocales();

console.log('Finished locale generation!\r\n');

/*****************************************************************************/
/* Helper Functions                                                          */
/*****************************************************************************/

/**
 * Reads a locale file and ensures it contains only non-empty string values.
 * @param file Name of the JSON file in resources/locales.
 * @returns The translation strings indexed by key.
 * @throws If the file does not contain a valid locale object.
 */
async function readLocale(file: string): Promise<Record<string, string>> {
  const value: unknown = JSON.parse(await readFile(join(source, file), 'utf8'));

  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.values(value).some(text => typeof text !== 'string' || !text.trim()))
    throw new Error(`Invalid locale: ${file}`);

  return value as Record<string, string>;
}

/**
 * Combines all locale files into resources/locales.json, using English as the
 * reference for translation keys. Writes the output only when it has changed.
 * @throws If a locale has different translation keys from english.json.
 */
async function generateLocales(): Promise<void> {
  const english = await readLocale('english.json');
  const keys = Object.keys(english).sort();
  const locales: Record<string, Record<string, string>> = { english };

  for (const file of files) {
    if (file === 'english.json')
      continue;

    const language = file.slice(0, -5);
    const strings = await readLocale(file);

    if (JSON.stringify(Object.keys(strings).sort()) !== JSON.stringify(keys))
      throw new Error(`Translation keys differ from english.json: ${file}`);

    locales[language] = strings;
    console.log(`Processed locale: ${language}`);
  }

  const generated = `${JSON.stringify(locales, null, 2)}\n`;
  if (await readFile(output, 'utf8').catch(() => '') !== generated) {
    await writeFile(output, generated, 'utf8');
  }
}
