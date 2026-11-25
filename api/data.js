const { del } = require('@vercel/blob');
const { redis, str, httpUrl, blobUrl, newId, adminCred, makeToken, limit, bad } = require('./_lib');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const VOTER = /^[a-z0-9]{8,40}$/i;
const ID = /^[a-z0-9]{3,40}$/i;
const TIPOS_ERRO = ['Erro', 'Crash', 'Bug'];
const TIPOS_DL = ['pack', 'mod', 'fix'];

const send = (res, code, obj) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(obj);
};

const all = async (key) => Object.values((await redis.hgetall(key)) || {});
const today = () => new Date().toISOString().slice(0, 10);
const pickId = (v) => (ID.test(String(v || '')) ? String(v) : newId());
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

async function rmBlobs(urls) {
  const u = urls.filter(Boolean);
  if (!u.length) return;
  try {
    await del(u);
  } catch (e) {
    console.error('blob del', e);
  }
}

async function getMem(id) {
  const m = await redis.hget('memorias', str(id, 40));
  if (!m) throw bad('Memória não encontrada.', 404);
  return m;
}

function cleanMem(b) {
  const titulo = str(b.titulo, 120);
  if (!titulo) throw bad('Dê um título ao momento.');
  return {
    titulo,
    data: DATE.test(String(b.data)) ? String(b.data) : today(),
    autor: str(b.autor, 60),
    desc: str(b.desc, 4000),
    fotos: arr(b.fotos, 30).map(blobUrl).filter(Boolean),
  };
}

function cleanWish(b) {
  const nome = str(b.nome, 80);
  const link = httpUrl(b.link);
  if (!nome) throw bad('Informe o nome do mod.');
  if (!link) throw bad('Informe um link válido (começando com http:// ou https://).');
  return { nome, link, desc: str(b.desc, 600), autor: str(b.autor, 60), foto: blobUrl(b.foto) };
}

function cleanErro(b) {
  const nome = str(b.nome, 120);
  if (!nome) throw bad('Digite um título.');
  return {
    nome,
    tipo: TIPOS_ERRO.includes(b.tipo) ? b.tipo : '',
    nota: str(b.nota, 4000),
    imgs: arr(b.imgs, 12).map(blobUrl).filter(Boolean),
    files: arr(b.files, 12)
      .map((f) => ({ name: str(f && f.name, 80), url: blobUrl(f && f.url) }))
      .filter((f) => f.url),
  };
}

function cleanDownload(b) {
  const nome = str(b.nome, 80);
  const link = httpUrl(b.link);
  let arquivo = str(b.arquivo, 150);
  if (/^[a-z]+:/i.test(arquivo) || arquivo.includes('..') || arquivo.startsWith('/')) arquivo = '';
  if (!nome) throw bad('Informe o nome.');
  if (!link && !arquivo) throw bad('Informe o link de download.');
  return {
    t: TIPOS_DL.includes(b.t) ? b.t : 'mod',
    nome,
    versao: str(b.versao, 20),
    tam: str(b.tam, 20),
    data: DATE.test(String(b.data)) ? String(b.data) : today(),
    hora: HORA.test(String(b.hora)) ? String(b.hora) : '',
    link,
    arquivo,
    nota: str(b.nota, 600),
    mudancas: arr(b.mudancas, 30).map((x) => str(x, 200)).filter(Boolean),
  };
}

async function saveComs(memId, coms) {
  const entries = {};
  arr(coms, 200).forEach((c) => {
    const texto = str(c && c.texto, 1000);
    if (!texto) return;
    /* sem id no backup: id estavel derivado do conteudo, para reimportar nao duplicar */
    const id = ID.test(String(c.id || ''))
      ? String(c.id)
      : require('crypto').createHash('sha1').update([memId, c.nome, texto, c.criado].join('|')).digest('hex').slice(0, 16);
    entries[`${memId}:${id}`] = { id, mem: memId, nome: str(c.nome, 60), texto, criado: Number(c.criado) || Date.now() };
  });
  if (Object.keys(entries).length) await redis.hset('coms', entries);
}

const ACTIONS = {
  /* ---------- qualquer pessoa ---------- */
  addMemoria: {
    run: async (b) => {
      const m = { id: newId(), ...cleanMem(b), fav: false, criado: Date.now() };
      await redis.hset('memorias', { [m.id]: m });
      return { id: m.id };
    },
  },
  addComentario: {
    run: async (b) => {
      const m = await getMem(b.mem);
      const texto = str(b.texto, 1000);
      if (!texto) throw bad('Escreva o comentário.');
      const c = { id: newId(), mem: m.id, nome: str(b.nome, 60), texto, criado: Date.now() };
      await redis.hset('coms', { [`${m.id}:${c.id}`]: c });
    },
  },
  addDesejo: {
    run: async (b) => {
      const w = { id: newId(), ...cleanWish(b), base: 0, criado: Date.now() };
      await redis.hset('desejos', { [w.id]: w });
      if (VOTER.test(String(b.voter))) await redis.sadd(`wv:${w.id}`, String(b.voter));
      return { id: w.id };
    },
  },
  voto: {
    run: async (b) => {
      const id = str(b.id, 40);
      const w = await redis.hget('desejos', id);
      if (!w) throw bad('Mod não encontrado.', 404);
      if (!VOTER.test(String(b.voter))) throw bad('Identificação inválida.');
      const key = `wv:${id}`;
      const had = await redis.sismember(key, String(b.voter));
      if (had) await redis.srem(key, String(b.voter));
      else await redis.sadd(key, String(b.voter));
      const n = await redis.scard(key);
      return { votos: (w.base || 0) + n, votou: !had };
    },
  },
  addErro: {
    run: async (b) => {
      const e = { id: newId(), ...cleanErro(b), ok: false, criado: Date.now() };
      await redis.hset('erros', { [e.id]: e });
      return { id: e.id };
    },
  },

  /* ---------- somente admin ---------- */
  editMemoria: {
    admin: true,
    run: async (b) => {
      const m = await getMem(b.id);
      const c = cleanMem({ ...b, fotos: m.fotos });
      await redis.hset('memorias', { [m.id]: { ...m, titulo: c.titulo, data: c.data, autor: c.autor, desc: c.desc } });
    },
  },
  favMemoria: {
    admin: true,
    run: async (b) => {
      const m = await getMem(b.id);
      await redis.hset('memorias', { [m.id]: { ...m, fav: !m.fav } });
    },
  },
  addFotos: {
    admin: true,
    run: async (b) => {
      const m = await getMem(b.id);
      const novas = arr(b.fotos, 30).map(blobUrl).filter(Boolean);
      await redis.hset('memorias', { [m.id]: { ...m, fotos: [...m.fotos, ...novas].slice(0, 60) } });
    },
  },
  rmFoto: {
    admin: true,
    run: async (b) => {
      const m = await getMem(b.id);
      const i = Number(b.index);
      if (!Number.isInteger(i) || i < 0 || i >= m.fotos.length) throw bad('Foto inválida.');
      const [gone] = m.fotos.splice(i, 1);
      await redis.hset('memorias', { [m.id]: m });
      await rmBlobs([gone]);
    },
  },
  delMemoria: {
    admin: true,
    run: async (b) => {
      const m = await getMem(b.id);
      const coms = (await redis.hgetall('coms')) || {};
      const keys = Object.keys(coms).filter((k) => k.startsWith(`${m.id}:`));
      if (keys.length) await redis.hdel('coms', ...keys);
      await redis.hdel('memorias', m.id);
      await rmBlobs(m.fotos || []);
    },
  },
  delComentario: {
    admin: true,
    run: async (b) => {
      await redis.hdel('coms', `${str(b.mem, 40)}:${str(b.id, 40)}`);
    },
  },
  delDesejo: {
    admin: true,
    run: async (b) => {
      const id = str(b.id, 40);
      const w = await redis.hget('desejos', id);
      if (!w) return;
      await redis.hdel('desejos', id);
      await redis.del(`wv:${id}`);
      await rmBlobs([w.foto]);
    },
  },
  resolveErro: {
    admin: true,
    run: async (b) => {
      const id = str(b.id, 40);
      const e = await redis.hget('erros', id);
      if (!e) throw bad('Erro não encontrado.', 404);
      await redis.hset('erros', { [id]: { ...e, ok: !!b.ok } });
    },
  },
  delErro: {
    admin: true,
    run: async (b) => {
      const id = str(b.id, 40);
      const e = await redis.hget('erros', id);
      if (!e) return;
      await redis.hdel('erros', id);
      await rmBlobs([...(e.imgs || []), ...(e.files || []).map((f) => f.url)]);
    },
  },
  addDownload: {
    admin: true,
    run: async (b) => {
      const d = { id: newId(), ...cleanDownload(b), criado: Date.now() };
      await redis.hset('downloads', { [d.id]: d });
      return { id: d.id };
    },
  },
  delDownload: {
    admin: true,
    run: async (b) => {
      await redis.hdel('downloads', str(b.id, 40));
    },
  },
  importItem: {
    admin: true,
    run: async (b) => {
      const it = b.item && typeof b.item === 'object' ? b.item : {};
      const id = pickId(it.id);
      const criado = Number(it.criado) || Date.now();
      if (b.kind === 'memoria') {
        await redis.hset('memorias', { [id]: { id, ...cleanMem(it), fav: !!it.fav, criado } });
        await saveComs(id, it.coms);
      } else if (b.kind === 'desejo') {
        await redis.hset('desejos', { [id]: { id, ...cleanWish(it), base: Math.max(0, Number(it.votos) || 0), criado } });
      } else if (b.kind === 'erro') {
        await redis.hset('erros', { [id]: { id, ...cleanErro(it), ok: !!it.ok, criado } });
      } else if (b.kind === 'download') {
        await redis.hset('downloads', { [id]: { id, ...cleanDownload(it), criado } });
      } else {
        throw bad('Tipo inválido.');
      }
    },
  },
};

async function list(req, res) {
  const v = String((req.query && req.query.v) || '');
  const voter = VOTER.test(v) ? v : 'anon-none';
  const [memorias, desejos, erros, downloads, coms] = await Promise.all([
    all('memorias'),
    all('desejos'),
    all('erros'),
    all('downloads'),
    all('coms'),
  ]);
  const by = {};
  coms.forEach((c) => (by[c.mem] = by[c.mem] || []).push(c));
  memorias.forEach((m) => {
    m.coms = (by[m.id] || []).sort((a, b) => a.criado - b.criado);
  });
  if (desejos.length) {
    const p = redis.pipeline();
    desejos.forEach((d) => {
      p.scard(`wv:${d.id}`);
      p.sismember(`wv:${d.id}`, voter);
    });
    const r = await p.exec();
    desejos.forEach((d, i) => {
      d.votos = (d.base || 0) + (Number(r[i * 2]) || 0);
      d.votou = !!Number(r[i * 2 + 1]);
    });
  }
  send(res, 200, { memorias, desejos, erros, downloads });
}

module.exports = async (req, res) => {
  try {
    if (!redis) return send(res, 503, { error: 'O banco de dados ainda não foi configurado na Vercel.' });
    if (req.method === 'GET') return await list(req, res);
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });

    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const cred = adminCred(req);
    const admin = !!cred;
    const act = str(b.action, 30);

    if (b.admin && !admin && !(await limit(req, 'adm', 10, 600))) {
      return send(res, 429, { error: 'Muitas tentativas com senha errada. Espere alguns minutos.' });
    }

    if (act === 'login') {
      if (admin) return send(res, 200, cred === 'password' ? { ok: true, token: makeToken() } : { ok: true });
      if (!process.env.ADMIN_PASSWORD) return send(res, 503, { error: 'A senha de admin ainda não foi configurada na Vercel.' });
      return send(res, 401, { error: 'Senha incorreta.' });
    }

    const h = Object.prototype.hasOwnProperty.call(ACTIONS, act) ? ACTIONS[act] : null;
    if (!h) return send(res, 400, { error: 'Ação inválida.' });
    if (h.admin && !admin) return send(res, 401, { error: 'Apenas o admin pode fazer isso.' });
    if (!admin && !(await limit(req, 'w', 30, 60))) {
      return send(res, 429, { error: 'Muitas ações seguidas. Espere um minuto e tente de novo.' });
    }
    const out = await h.run(b);
    return send(res, 200, out || { ok: true });
  } catch (e) {
    if (e && e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Erro no servidor. Tente de novo.' });
  }
};
