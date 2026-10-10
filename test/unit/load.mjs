// Loads the extension's plain browser scripts into a sandbox for unit tests.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

export function load(...files) {
  const context = vm.createContext({ URL, console });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: file });
  return context;
}
