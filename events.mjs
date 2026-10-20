// Every workflow step is logged here and streamed to the user through the dashboard.
// The log lives beside plan.json (gitignored) and is append-only.
import fs from 'node:fs';
import path from 'node:path';

const fileFor = (root, id) => {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) throw Error('Invalid workflow ID');
  return path.join(root, 'workflows', id, 'events.jsonl');
};

export function appendEvent(root, id, event) {
  const file = fileFor(root, id);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.appendFileSync(file, JSON.stringify({at: new Date().toISOString(), ...event}) + '\n');
}

export function readEvents(root, id, limit = 80) {
  let text = '';
  try { text = fs.readFileSync(fileFor(root, id), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).slice(-limit).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}
