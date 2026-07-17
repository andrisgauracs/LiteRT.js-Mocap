// Copies the LiteRT Wasm runtime out of node_modules into public/ so the
// app can serve it statically (required for fully-offline operation).
// Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..', 'node_modules', '@litertjs', 'core', 'wasm');
const dest = path.join(root, '..', 'public', 'litert-wasm');

if (!existsSync(src)) {
  console.error('LiteRT wasm files not found — did you run `npm install`?');
  process.exit(1);
}
cpSync(src, dest, { recursive: true });
console.log('Copied LiteRT wasm runtime -> public/litert-wasm');
