// Minimaler Minecraft-Server, der nur auf Server List Ping antwortet (zum Testen)
import net from 'node:net';
const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const status = { version: { name: 'Paper 26.2', protocol: 775 }, players: { online: 17, max: 200 }, favicon: icon,
  description: { text: '', extra: [{ text: 'Test', color: '#ff8800', bold: true }, { text: ' Server ', color: 'gray' }, { text: '§aGrün §lfett <kein tag>' }, '\n', { text: 'Zeile zwei', italic: true, shadow_color: -16777216 }] } };
const vi = n => { const o = []; n >>>= 0; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return Buffer.from(o); };
net.createServer(s => {
  let buf = Buffer.alloc(0);
  s.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      let i = 0, len = 0, sh = 0, b;
      do { if (i >= buf.length) return; b = buf[i++]; len |= (b & 127) << sh; sh += 7; } while (b & 128);
      if (buf.length < i + len) return;
      const pk = buf.subarray(i, i + len); buf = buf.subarray(i + len);
      const id = pk[0];
      if (id === 0 && pk.length === 1) { const js = Buffer.from(JSON.stringify(status)); const body = Buffer.concat([vi(0), vi(js.length), js]); s.write(Buffer.concat([vi(body.length), body])); }
      else if (id === 1) { const body = Buffer.concat([vi(1), pk.subarray(1)]); s.write(Buffer.concat([vi(body.length), body])); }
    }
  });
  s.on('error', () => {});
}).listen(25599, '127.0.0.1', () => console.log('fake mc on 25599'));
