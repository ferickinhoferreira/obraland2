const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const str = (v, max) =>
  String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);

const httpUrl = (v) => {
  const s = str(v, 500);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
};

const blobUrl = (v) => {
  const s = str(v, 600);
  return /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s]+$/i.test(s) ? s : '';
};

const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (pass, exp) => crypto.createHmac('sha256', pass).update('obraland-admin:' + exp).digest('hex');

/* O navegador guarda so um token assinado (HMAC) com validade de 12 h, nunca a senha. */
function makeToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  return exp + '.' + sign(process.env.ADMIN_PASSWORD, exp);
}

function adminCred(req) {
  const pass = process.env.ADMIN_PASSWORD;
  const got = req.body && req.body.admin;
  if (!pass || typeof got !== 'string' || !got || got.length > 200) return '';
  if (crypto.timingSafeEqual(sha(got), sha(pass))) return 'password';
  const m = /^(\d{10,16})\.([a-f0-9]{64})$/.exec(got);
  if (m && Number(m[1]) > Date.now() && crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(sign(pass, m[1])))) return 'token';
  return '';
}

const isAdmin = (req) => !!adminCred(req);

async function limit(req, bucket, max, windowSec) {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'x')
    .split(',')[0]
    .trim();
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSec * 2);
  return n <= max;
}

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

module.exports = { redis, str, httpUrl, blobUrl, newId, isAdmin, adminCred, makeToken, limit, bad };
