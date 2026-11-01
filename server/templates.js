// Loads the built-in games from /templates/<id>/ (meta.json + *.host.js / *.client.js / *.shared.js).
import fs from 'node:fs';
import path from 'node:path';

const ORDER = { shared: 0, host: 1, client: 2 };
const kindOf = (name) => name.match(/\.(host|client|shared)\.js$/)?.[1];

export function loadTemplates(dir) {
  const out = [];
  for (const id of fs.readdirSync(dir)) {
    const folder = path.join(dir, id);
    if (!fs.statSync(folder).isDirectory()) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8'));
    const scripts = fs.readdirSync(folder)
      .filter(kindOf)
      .sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)] || a.localeCompare(b))
      .map((name) => ({ name, code: fs.readFileSync(path.join(folder, name), 'utf8') }));
    let thumbnail = null;
    for (const ext of ['jpg', 'png']) {
      const f = path.join(folder, 'thumb.' + ext);
      if (fs.existsSync(f)) thumbnail = `data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,` + fs.readFileSync(f).toString('base64');
    }
    out.push({ id, maxPlayers: 6, tags: [], order: 99, ...meta, scripts, thumbnail });
  }
  return out.sort((a, b) => a.order - b.order);
}
