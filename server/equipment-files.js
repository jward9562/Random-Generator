import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export function parseEquipmentJson(text, label = 'JSON file') {
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`${label}: invalid JSON. ${error.message}`); }
  // JSON.parse silently overwrites repeated properties. Reject those before use.
  const stack = [];
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  for (const token of tokens) {
    const top = stack.at(-1);
    if (token === '{') stack.push({ object: true, key: true, names: new Set() });
    else if (token === '[') stack.push({ object: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.object) top.key = true;
    else if (top?.object && top.key && token.startsWith('"')) {
      const name = JSON.parse(token);
      if (top.names.has(name)) throw new Error(`${label}: duplicate JSON property "${name}". Keep only one occurrence.`);
      top.names.add(name);
      top.key = false;
    }
  }
  return value;
}

// Operator files stay separate for human editing; arrays preserve duplicate IDs
// so validation can report them instead of silently overwriting a map entry.
export async function loadEquipmentDirectory(directory) {
  const folder = resolve(directory);
  const read = async relative => {
    const file = join(folder, relative);
    let text;
    try { text = await readFile(file, 'utf8'); } catch { throw new Error(`${file}: could not read the required data file.`); }
    return parseEquipmentJson(text, relative);
  };
  const metadata = await read('metadata.json');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(key => !['schemaVersion', 'dataVersion'].includes(key))) throw new Error('metadata.json: use only schemaVersion and dataVersion.');
  const database = { ...metadata };
  for (const key of ['attachments', 'categories', 'weapons', 'gadgets']) database[key] = await read(`${key}.json`);
  let files;
  try { files = await readdir(join(folder, 'operators')); } catch { throw new Error(`${folder}: operators folder is missing.`); }
  database.operators = [];
  for (const file of files.filter(name => name.endsWith('.json')).sort()) database.operators.push(await read(join('operators', file)));
  return database;
}
