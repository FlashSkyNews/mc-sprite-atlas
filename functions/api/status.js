// Server List Ping (Java Edition) über eine TCP-Verbindung aus der Pages Function.
// GET /api/status?host=play.example.de[:25565]
import { connect } from 'cloudflare:sockets';

const TIMEOUT_MS = 6000;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': status === 200 ? 'public, max-age=30' : 'no-store',
      ...extra,
    },
  });
}

function isPrivateHost(h) {
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const varInt = n => {
  const out = [];
  n >>>= 0;
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
};
const str = s => { const b = new TextEncoder().encode(s); return [...varInt(b.length), ...b]; };
const packet = (id, body) => { const p = [...varInt(id), ...body]; return new Uint8Array([...varInt(p.length), ...p]); };

class Reader {
  constructor(r) { this.r = r; this.buf = new Uint8Array(0); }
  async need(n) {
    while (this.buf.length < n) {
      const { value, done } = await this.r.read();
      if (done) throw new Error('connection closed by server');
      const b = new Uint8Array(this.buf.length + value.length); b.set(this.buf); b.set(value, this.buf.length); this.buf = b;
    }
  }
  async byte() { await this.need(1); const v = this.buf[0]; this.buf = this.buf.subarray(1); return v; }
  async varInt() {
    let n = 0, shift = 0, b;
    do { b = await this.byte(); n |= (b & 0x7f) << shift; shift += 7; if (shift > 35) throw new Error('invalid VarInt'); } while (b & 0x80);
    return n;
  }
  async bytes(n) { await this.need(n); const v = this.buf.slice(0, n); this.buf = this.buf.subarray(n); return v; }
}

async function resolveSrv(host) {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=_minecraft._tcp.${encodeURIComponent(host)}&type=SRV`, { headers: { accept: 'application/dns-json' } });
    const d = await r.json();
    const a = (d.Answer || []).find(x => x.type === 33);
    if (!a) return null;
    const [, , port, target] = a.data.split(' ');
    return { host: target.replace(/\.$/, ''), port: +port };
  } catch { return null; }
}

async function ping(host, port, handshakeHost) {
  const socket = connect({ hostname: host, port });
  const writer = socket.writable.getWriter();
  const reader = new Reader(socket.readable.getReader());
  try {
    const hs = [...varInt(-1 >>> 0), ...str(handshakeHost), (port >> 8) & 0xff, port & 0xff, ...varInt(1)];
    await writer.write(packet(0x00, hs));
    await writer.write(packet(0x00, []));
    await reader.varInt();                       // Paketlänge
    if (await reader.varInt() !== 0x00) throw new Error('unexpected response');
    const len = await reader.varInt();
    const status = JSON.parse(new TextDecoder().decode(await reader.bytes(len)));
    let latency = null;
    try {
      const t0 = Date.now();
      const payload = new Uint8Array(8); new DataView(payload.buffer).setBigInt64(0, BigInt(t0));
      await writer.write(packet(0x01, [...payload]));
      await reader.varInt(); await reader.varInt(); await reader.bytes(8);
      latency = Date.now() - t0;
    } catch { /* manche Server antworten nicht auf Ping */ }
    return { status, latency };
  } finally {
    try { await socket.close(); } catch {}
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let input = (url.searchParams.get('host') || '').trim().toLowerCase();
  if (!input) return json({ ok: false, code: 'missing_host', error: 'Missing host parameter, e.g. /api/status?host=hypixel.net' }, 400);
  let host = input, port = null;
  const m = input.match(/^(.+):(\d{1,5})$/);
  if (m) { host = m[1]; port = +m[2]; }
  if (!HOST_RE.test(host) || (port != null && (port < 1 || port > 65535))) return json({ ok: false, code: 'invalid', error: 'Invalid address.' }, 400);
  if (isPrivateHost(host) && env.ALLOW_PRIVATE !== '1') return json({ ok: false, code: 'private', error: 'Private or local addresses are not queried.' }, 400);

  let target = { host, port: port ?? 25565 }, srv = null;
  if (port == null) { srv = await resolveSrv(host); if (srv) target = srv; }

  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after ' + TIMEOUT_MS / 1000 + ' s')), TIMEOUT_MS));
    const { status, latency } = await Promise.race([ping(target.host, target.port, host), timeout]);
    return json({
      ok: true, online: true, host, port: target.port, srv: srv ? `${srv.host}:${srv.port}` : null, latency,
      version: status.version || null, players: status.players || null,
      description: status.description ?? '', favicon: typeof status.favicon === 'string' ? status.favicon : null,
      enforcesSecureChat: status.enforcesSecureChat ?? null,
    });
  } catch (e) {
    return json({ ok: true, online: false, host, port: target.port, error: String(e.message || e) }, 200, { 'cache-control': 'no-store' });
  }
}
