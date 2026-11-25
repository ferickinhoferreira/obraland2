/* Harness de testes: Redis e Blob em memoria (mesma semantica JSON do Upstash) + servidor HTTP local que
   executa os handlers reais de api/*.js. NAO fala com Upstash/Vercel Blob reais. */
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const API = path.join(ROOT, 'api');

const store = { h: {}, s: {}, k: {} };
const blob = { puts: [], dels: [] };
const resetStore = () => { store.h = {}; store.s = {}; store.k = {}; blob.puts = []; blob.dels = []; };

class FakeRedis {
  async hset(k, o) { const h = (store.h[k] = store.h[k] || {}); for (const f in o) h[f] = JSON.stringify(o[f]); return Object.keys(o).length; }
  async hget(k, f) { const h = store.h[k]; return h && f in h ? JSON.parse(h[f]) : null; }
  async hgetall(k) { const h = store.h[k]; if (!h || !Object.keys(h).length) return null; const o = {}; for (const f in h) o[f] = JSON.parse(h[f]); return o; }
  async hdel(k, ...f) { const h = store.h[k]; let n = 0; if (h) f.forEach((x) => { if (x in h) { delete h[x]; n++; } }); return n; }
  async del(...ks) { ks.forEach((k) => { delete store.h[k]; delete store.s[k]; delete store.k[k]; }); return ks.length; }
  async sadd(k, ...m) { const s = (store.s[k] = store.s[k] || new Set()); m.forEach((x) => s.add(String(x))); return m.length; }
  async srem(k, ...m) { const s = store.s[k]; if (s) m.forEach((x) => s.delete(String(x))); return m.length; }
  async sismember(k, m) { const s = store.s[k]; return s && s.has(String(m)) ? 1 : 0; }
  async scard(k) { const s = store.s[k]; return s ? s.size : 0; }
  async incr(k) { store.k[k] = (store.k[k] || 0) + 1; return store.k[k]; }
  async expire() { return 1; }
  pipeline() {
    const ops = [], p = {
      scard: (k) => (ops.push(() => this.scard(k)), p),
      sismember: (k, m) => (ops.push(() => this.sismember(k, m)), p),
      exec: () => Promise.all(ops.map((f) => f())),
    };
    return p;
  }
}

const fakeBlob = {
  put: async (p, buf, opts) => { blob.puts.push({ path: p, size: buf.length, opts }); return { url: `https://fake123.public.blob.vercel-storage.com/${p}` }; },
  del: async (u) => { blob.dels.push(...(Array.isArray(u) ? u : [u])); },
};

function mockModules() {
  const r = require.resolve('@upstash/redis', { paths: [API] });
  require.cache[r] = { id: r, filename: r, loaded: true, exports: { Redis: FakeRedis } };
  const b = require.resolve('@vercel/blob', { paths: [API] });
  require.cache[b] = { id: b, filename: b, loaded: true, exports: fakeBlob };
}

function loadApi(env = {}) {
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'ADMIN_PASSWORD', 'BLOB_READ_WRITE_TOKEN']) delete process.env[k];
  Object.assign(process.env, env);
  for (const f of ['_lib.js', 'data.js', 'upload.js']) delete require.cache[path.join(API, f)];
  mockModules();
  return { data: require(path.join(API, 'data.js')), upload: require(path.join(API, 'upload.js')) };
}

const DEFAULT_ENV = { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'tok', ADMIN_PASSWORD: 'senha-super-secreta', BLOB_READ_WRITE_TOKEN: 'blob-tok' };

function call(handler, { method = 'POST', body, query, ip = '1.1.1.1' } = {}) {
  return new Promise((resolve) => {
    const req = { method, body, query: query || {}, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code || 200, body: o, headers: this.headers }); } };
    Promise.resolve(handler(req, res)).catch((e) => resolve({ code: 599, body: { error: String(e && e.stack) } }));
  });
}

/* servidor local: imita o roteamento da Vercel (limite de corpo 4,5 MB) */
function startServer(getApi) {
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    const m = /^\/api\/(data|upload)$/.exec(u.pathname);
    if (!m) { s.statusCode = 404; return s.end('nf'); }
    const chunks = []; let n = 0, over = false;
    q.on('data', (c) => { n += c.length; if (n > 4.5 * 1024 * 1024) over = true; else chunks.push(c); });
    q.on('end', () => {
      const send = (code, o) => { s.statusCode = code; s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(o)); };
      if (over) return send(413, { error: 'FUNCTION_PAYLOAD_TOO_LARGE' });
      let body; if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) { body = undefined; } }
      const req = { method: q.method, body, query: Object.fromEntries(u.searchParams), headers: { 'x-forwarded-for': q.headers['x-forwarded-for'] || '9.9.9.9' }, socket: { remoteAddress: '9.9.9.9' } };
      const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(o) { send(this.code || 200, o); } };
      Promise.resolve(getApi()[m[1]](req, res)).catch((e) => send(599, { error: String(e) }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

module.exports = { ROOT, API, store, blob, resetStore, loadApi, call, startServer, DEFAULT_ENV };
