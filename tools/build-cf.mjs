// Packs everything Cloudflare needs into cf/dist: static files (site, runtime, three.js, Monaco)
// and the built-in games as a JS module the Worker imports.
import fs from 'node:fs';
import path from 'node:path';
import { loadTemplates } from '../server/templates.js';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'cf/dist');
const pub = path.join(out, 'public');
fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(pub, to), { recursive: true });
copy('web', 'web');
copy('runtime', 'runtime');
copy('node_modules/three/build/three.module.js', 'vendor/three/three.module.js');
copy('node_modules/monaco-editor/min/vs', 'vendor/monaco/vs');
fs.copyFileSync(path.join(root, 'web/index.html'), path.join(pub, 'index.html'));
fs.copyFileSync(path.join(root, 'web/icon.png'), path.join(pub, 'favicon.ico'));
fs.writeFileSync(path.join(pub, '_headers'), ['/runtime/*', '  Access-Control-Allow-Origin: *', '/vendor/three/*', '  Access-Control-Allow-Origin: *', '  Cache-Control: public, max-age=86400', '/vendor/monaco/*', '  Cache-Control: public, max-age=86400', ''].join('\n'));
const templates = loadTemplates(path.join(root, 'templates'));
fs.writeFileSync(path.join(out, 'templates.js'), `export default ${JSON.stringify(templates)};\n`);
let files = 0;
const count = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? count(path.join(d, f.name)) : files++; };
count(pub);
console.log(`cf/dist ready: ${files} static files, ${templates.length} templates`);
