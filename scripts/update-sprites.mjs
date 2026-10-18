// Holt neue Minecraft-Releases aus Mojangs Versionsmanifest und erzeugt public/data/<version>.json.
//   node scripts/update-sprites.mjs                 neue Releases ab MIN_VERSION nachziehen
//   node scripts/update-sprites.mjs --jar client.jar --version 26.2   aus einem vorhandenen Client-JAR
//   node scripts/update-sprites.mjs --dir <assets-root> --version 26.2 aus einem entpackten Asset-Ordner
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { unzipSync } from 'fflate';

const MIN_VERSION = '1.21.9';   // ab hier können Clients <sprite> in Texten anzeigen
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/data');
const PREFIX = 'assets/minecraft/';

// ---------- Dateiquellen: Client-JAR oder entpackter Ordner ----------
function zipSource(buf) {
  const files = unzipSync(new Uint8Array(buf), {
    filter: f => f.name.startsWith(PREFIX + 'textures/') || f.name.startsWith(PREFIX + 'atlases/'),
  });
  return {
    has: p => p in files,
    read: p => files[p],
    list: dir => Object.keys(files).filter(n => n.startsWith(dir)),
  };
}
async function dirSource(root) {
  const all = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p); else all.push(path.relative(root, p).split(path.sep).join('/'));
    }
  }
  await walk(path.join(root, PREFIX));
  const set = new Set(all);
  const cache = new Map();
  for (const p of all) cache.set(p, await readFile(path.join(root, p)));
  return { has: p => set.has(p), read: p => cache.get(p), list: dir => all.filter(n => n.startsWith(dir)) };
}

// ---------- Sprites aus den Atlas-Definitionen sammeln (wie der Client) ----------
const pngSize = b => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return [v.getUint32(16), v.getUint32(20)]; };
const b64 = b => Buffer.from(b).toString('base64');
const strip = id => id.replace(/^minecraft:/, '');

function buildSprites(src) {
  const sprites = new Map();
  const add = (atlas, id, file) => {
    const key = atlas + '\u0000' + id;
    if (sprites.has(key)) return;
    const png = src.read(file);
    const [w, h] = pngSize(png);
    let an = null;
    if (src.has(file + '.mcmeta')) {
      let m = {};
      try { m = JSON.parse(Buffer.from(src.read(file + '.mcmeta')).toString('utf8')); } catch {}
      if (m.animation) {
        const a = m.animation;
        let fw = a.width ?? w, fh = a.height ?? Math.min(w, h);
        if (a.width == null && a.height == null) fw = fh = Math.min(w, h);
        const ft = a.frametime ?? 1;
        const cols = Math.floor(w / fw), rows = Math.floor(h / fh);
        const seq = a.frames && a.frames.length
          ? a.frames.map(f => typeof f === 'number' ? [f, ft] : [f.index, f.time ?? ft])
          : Array.from({ length: cols * rows }, (_, i) => [i, ft]);
        an = { fw, fh, cols, rows, seq };
      }
    }
    sprites.set(key, { a: atlas, id, w, h, an, img: b64(png) });
  };
  const atlasFiles = src.list(PREFIX + 'atlases/').filter(n => /\/[a-z0-9_]+\.json$/.test(n)).sort();
  for (const f of atlasFiles) {
    const atlas = path.basename(f, '.json');
    const def = JSON.parse(Buffer.from(src.read(f)).toString('utf8'));
    for (const s of def.sources || []) {
      const type = strip(s.type);
      if (type === 'directory') {
        const base = PREFIX + 'textures/' + s.source + '/';
        for (const n of src.list(base).filter(n => n.endsWith('.png')).sort()) add(atlas, s.prefix + n.slice(base.length, -4), n);
      } else if (type === 'single') {
        const r = strip(s.resource), file = PREFIX + 'textures/' + r + '.png';
        if (src.has(file)) add(atlas, strip(s.sprite ?? r), file);
      }
    }
  }
  return [...sprites.values()].sort((x, y) => x.a < y.a ? -1 : x.a > y.a ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
}

// ---------- Versionsliste ----------
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
async function loadIndex() {
  try { return JSON.parse(await readFile(path.join(OUT, 'versions.json'), 'utf8')); } catch { return { updated: null, versions: [] }; }
}
async function saveVersion(index, id, sprites) {
  const json = JSON.stringify(sprites);
  const hash = createHash('sha1').update(json).digest('hex');
  // Gleiche Sprites wie eine vorhandene Version: Datei mitbenutzen
  let file = null;
  for (const v of index.versions) {
    const p = path.join(OUT, v.file + '.json');
    try { if (createHash('sha1').update(await readFile(p, 'utf8')).digest('hex') === hash) { file = v.file; break; } } catch {}
  }
  if (!file) { file = id; await writeFile(path.join(OUT, id + '.json'), json); }
  index.versions = index.versions.filter(v => v.id !== id);
  index.versions.push({ id, file, sprites: sprites.length });
  index.versions.sort((a, b) => cmpVer(b.id, a.id));
  index.updated = new Date().toISOString();
  await writeFile(path.join(OUT, 'versions.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`${id}: ${sprites.length} Sprites → data/${file}.json`);
}

async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }

async function main() {
  await mkdir(OUT, { recursive: true });
  const index = await loadIndex();
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  if (opt('--jar')) {
    const id = opt('--version'); if (!id) throw new Error('--version fehlt');
    await saveVersion(index, id, buildSprites(zipSource(await readFile(opt('--jar')))));
    return;
  }
  if (opt('--dir')) {
    const id = opt('--version'); if (!id) throw new Error('--version fehlt');
    await saveVersion(index, id, buildSprites(await dirSource(opt('--dir'))));
    return;
  }
  const manifest = await getJson(MANIFEST);
  const releases = manifest.versions.filter(v => v.type === 'release' && cmpVer(v.id, MIN_VERSION) >= 0);
  const have = new Set(index.versions.map(v => v.id));
  const todo = releases.filter(v => !have.has(v.id) || args.includes('--force'));
  if (!todo.length) { console.log('Alles aktuell. Neuestes Release:', manifest.latest.release); return; }
  for (const v of todo.sort((a, b) => cmpVer(a.id, b.id))) {
    const meta = await getJson(v.url);
    const dl = meta.downloads.client;
    console.log(`${v.id}: lade Client (${(dl.size / 1e6).toFixed(1)} MB) …`);
    const r = await fetch(dl.url); if (!r.ok) throw new Error(`Client ${v.id}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (createHash('sha1').update(buf).digest('hex') !== dl.sha1) throw new Error(`Client ${v.id}: SHA-1 stimmt nicht`);
    await saveVersion(index, v.id, buildSprites(zipSource(buf)));
  }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
