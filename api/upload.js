const { put } = require('@vercel/blob');
const { redis, str, newId, limit, adminCred } = require('./_lib');

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
};
const MAX_BYTES = 3 * 1024 * 1024;

/* confere os primeiros bytes: o tipo informado pelo navegador nao basta */
const SIG = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/gif': (b) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'text/plain': (b) => !b.includes(0),
};

const fail = (res, code, error) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json({ error });
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
    if (!redis) return fail(res, 503, 'O banco de dados ainda não foi configurado na Vercel.');

    if (!process.env.BLOB_READ_WRITE_TOKEN) return fail(res, 503, 'O armazenamento de arquivos (Vercel Blob) ainda não foi configurado na Vercel.');

    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const type = str(b.type, 40).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(EXT, type)) return fail(res, 400, 'Tipo de arquivo não permitido.');

    const data = typeof b.data === 'string' ? b.data : '';
    if (!data || data.length > 4200000) return fail(res, 413, 'Arquivo grande demais.');

    const cred = adminCred(req);
    if (b.admin && !cred && !(await limit(req, 'adm', 10, 600))) return fail(res, 429, 'Muitas tentativas com senha errada. Espere alguns minutos.');

    if (!cred && (!(await limit(req, 'u', 40, 60)) || !(await limit(req, 'ud', 400, 86400)))) {
      return fail(res, 429, 'Muitos envios seguidos. Espere um pouco e tente de novo.');
    }

    const buf = Buffer.from(data, 'base64');
    if (!buf.length || buf.length > MAX_BYTES) return fail(res, 413, 'Arquivo grande demais (máximo 3 MB).');

    if (!SIG[type](buf)) return fail(res, 400, 'O conteúdo do arquivo não corresponde ao tipo informado.');

    const base =
      str(b.name, 60)
        .replace(/\.[a-z0-9]{1,5}$/i, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'arquivo';

    const out = await put(`uploads/${base}-${newId()}.${EXT[type]}`, buf, {
      access: 'public',
      contentType: type,
      addRandomSuffix: false,
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ url: out.url });
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Não consegui enviar o arquivo. Tente de novo.');
  }
};
