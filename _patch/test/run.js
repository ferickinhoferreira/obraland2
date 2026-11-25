/* Testes do Obraland 2: APIs (handlers reais) + frontend (jsdom). Uso: cd _patch/test && npm test */
const assert = require('assert');
const H = require('./harness');
const { call, store, blob } = H;

const results = [];
async function t(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ok   ' + name); }
  catch (e) { results.push([false, name, e]); console.log('  FAIL ' + name + '\n       ' + String(e && e.message).split('\n').join('\n       ')); }
}
const PASS = H.DEFAULT_ENV.ADMIN_PASSWORD;
const BLOB = (n) => `https://fake123.public.blob.vercel-storage.com/uploads/${n}.png`;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(64, 2)]);

async function apiTests() {
  console.log('\n== API ==');
  H.resetStore();
  let api = H.loadApi(H.DEFAULT_ENV);
  const D = (body, o) => call(api.data, { body, ...o });
  const A = (body, o) => D({ admin: PASS, ...body }, o);
  const list = async (q) => (await call(api.data, { method: 'GET', query: q })).body;

  await t('GET vazio devolve 4 listas vazias e no-store', async () => {
    const r = await call(api.data, { method: 'GET' });
    assert.equal(r.code, 200); assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Object.keys(r.body).sort(), ['desejos', 'downloads', 'erros', 'memorias']);
    Object.values(r.body).forEach((v) => assert.deepEqual(v, []));
  });
  await t('sem banco configurado: 503 em GET/POST/upload', async () => {
    const a2 = H.loadApi({ ADMIN_PASSWORD: 'x' });
    assert.equal((await call(a2.data, { method: 'GET' })).code, 503);
    assert.equal((await call(a2.data, { body: { action: 'addErro' } })).code, 503);
    assert.equal((await call(a2.upload, { body: { type: 'image/png', data: 'AA==' } })).code, 503);
    api = H.loadApi(H.DEFAULT_ENV);
  });
  await t('metodos/acoes invalidos (incl. __proto__/constructor)', async () => {
    assert.equal((await call(api.data, { method: 'PUT' })).code, 405);
    assert.equal((await call(api.upload, { method: 'GET' })).code, 405);
    for (const a of ['', 'nada', 'constructor', '__proto__', 'hasOwnProperty', 'toString']) assert.equal((await D({ action: a })).code, 400, a);
    assert.equal((await call(api.data, { body: undefined })).code, 400);
  });

  let mem, wish, err;
  await t('qualquer pessoa cria memoria (fotos nao-blob descartadas, campos limitados)', async () => {
    assert.equal((await D({ action: 'addMemoria', titulo: '  ' })).code, 400);
    const r = await D({ action: 'addMemoria', titulo: 'T'.repeat(500), autor: 'Ana', desc: 'd', data: 'lixo',
      fotos: [BLOB('a'), 'https://evil.com/x.png', 'javascript:alert(1)', 5, null] });
    assert.equal(r.code, 200); mem = r.body.id;
    const m = (await list()).memorias[0];
    assert.equal(m.titulo.length, 120); assert.deepEqual(m.fotos, [BLOB('a')]);
    assert.match(m.data, /^\d{4}-\d{2}-\d{2}$/); assert.equal(m.fav, false);
  });
  await t('comentarios: validacao, 404 e visiveis para todos', async () => {
    assert.equal((await D({ action: 'addComentario', mem, texto: '' })).code, 400);
    assert.equal((await D({ action: 'addComentario', mem: 'naoexiste', texto: 'oi' })).code, 404);
    assert.equal((await D({ action: 'addComentario', mem, nome: 'Bia', texto: 'lindo' }, { ip: '2.2.2.2' })).code, 200);
    const m = (await list({}, {})).memorias[0];
    assert.equal(m.coms.length, 1); assert.equal(m.coms[0].nome, 'Bia');
  });
  await t('desejos + votos (toggle, por votante, contagem e flag votou)', async () => {
    assert.equal((await D({ action: 'addDesejo', nome: 'Mod', link: 'ftp://x' })).code, 400);
    assert.equal((await D({ action: 'addDesejo', nome: '', link: 'https://a.b' })).code, 400);
    const r = await D({ action: 'addDesejo', nome: 'Mod', link: 'https://a.b/c', voter: 'voter0001', foto: 'https://evil/x.png' }); wish = r.body.id;
    assert.equal((await list({ v: 'voter0001' })).desejos[0].votos, 1);
    assert.equal((await list({ v: 'voter0001' })).desejos[0].foto, '');
    assert.equal((await D({ action: 'voto', id: wish, voter: 'voter0002' })).body.votos, 2);
    assert.equal((await D({ action: 'voto', id: wish, voter: 'curto' })).code, 400);
    assert.equal((await D({ action: 'voto', id: 'zzzz', voter: 'voter0002' })).code, 404);
    const v = await D({ action: 'voto', id: wish, voter: 'voter0002' });
    assert.deepEqual(v.body, { votos: 1, votou: false });
    const d = (await list({ v: 'voter0001' })).desejos[0]; assert.equal(d.votou, true);
    assert.equal((await list({ v: 'outro0000' })).desejos[0].votou, false);
  });
  await t('erros: tipo invalido vira vazio; anexos so blob', async () => {
    assert.equal((await D({ action: 'addErro', nome: '' })).code, 400);
    const r = await D({ action: 'addErro', nome: 'Crash', tipo: 'Hack', nota: 'n', imgs: [BLOB('i'), 'http://x'], files: [{ name: 'log.txt', url: BLOB('l') }, { name: 'x', url: 'https://x/y' }] });
    err = r.body.id; const e = (await list()).erros[0];
    assert.equal(e.tipo, ''); assert.deepEqual(e.imgs, [BLOB('i')]); assert.equal(e.files.length, 1); assert.equal(e.ok, false);
  });

  const ADMIN_ACTIONS = ['editMemoria', 'favMemoria', 'addFotos', 'rmFoto', 'delMemoria', 'delComentario', 'delDesejo', 'resolveErro', 'delErro', 'addDownload', 'delDownload', 'importItem'];
  await t('acoes de admin: 401 sem senha e com senha errada; nada e apagado', async () => {
    for (const a of ADMIN_ACTIONS) {
      assert.equal((await D({ action: a, id: mem, mem })).code, 401, a + ' sem senha');
      assert.equal((await D({ action: a, id: mem, mem, admin: 'errada' }, { ip: '8.8.' + ADMIN_ACTIONS.indexOf(a) + '.1' })).code, 401, a + ' errada');
    }
    const l = await list(); assert.equal(l.memorias.length, 1); assert.equal(l.desejos.length, 1); assert.equal(l.erros.length, 1);
    assert.equal(blob.dels.length, 0);
  });
  await t('login: certo, errado e senha nao configurada', async () => {
    assert.equal((await D({ action: 'login', admin: PASS })).code, 200);
    assert.equal((await D({ action: 'login', admin: 'x' })).code, 401);
    assert.equal((await D({ action: 'login' })).code, 401);
    const a2 = H.loadApi({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' });
    assert.equal((await call(a2.data, { body: { action: 'login', admin: 'x' } })).code, 503);
    assert.equal((await call(a2.data, { body: { action: 'delErro', id: err, admin: '' } })).code, 401);
    api = H.loadApi(H.DEFAULT_ENV);
  });
  await t('token de sessao admin: login devolve token; token vale; adulterado/expirado/lixo nao', async () => {
    const crypto = require('crypto');
    const l = await D({ action: 'login', admin: PASS }); assert.match(l.body.token, /^\d{13}\.[a-f0-9]{64}$/);
    const tok = l.body.token;
    assert.equal((await D({ action: 'login', admin: tok })).code, 200);
    assert.equal((await D({ action: 'login', admin: tok })).body.token, undefined, 'token nao deve renovar token');
    assert.equal((await D({ action: 'favMemoria', id: mem, admin: tok })).code, 200); assert.equal((await D({ action: 'favMemoria', id: mem, admin: tok })).code, 200);
    const [exp, sig] = tok.split('.');
    const past = Date.now() - 1000, psig = crypto.createHmac('sha256', PASS).update('obraland-admin:' + past).digest('hex');
    const bads = [exp + '.' + sig.replace(/.$/, sig.endsWith('0') ? '1' : '0'), (Number(exp) + 1) + '.' + sig, past + '.' + psig, exp + '.' + 'a'.repeat(64), '1.2', tok + 'x', {}, 123, ['x']];
    for (let i = 0; i < bads.length; i++) assert.equal((await D({ action: 'favMemoria', id: mem, admin: bads[i] }, { ip: '12.0.0.' + i })).code, 401, 'token ruim #' + i);
    const other = H.loadApi({ ...H.DEFAULT_ENV, ADMIN_PASSWORD: 'outra-senha' });
    assert.equal((await call(other.data, { body: { action: 'favMemoria', id: mem, admin: tok }, ip: '12.1.1.1' })).code, 401, 'trocar a senha invalida tokens');
    api = H.loadApi(H.DEFAULT_ENV);
  });
  await t('admin: editar/favoritar/fotos/resolver/downloads', async () => {
    assert.equal((await A({ action: 'editMemoria', id: mem, titulo: 'Novo', data: '2026-01-02', autor: 'Z', desc: 'D' })).code, 200);
    assert.equal((await A({ action: 'editMemoria', id: mem, titulo: '' })).code, 400);
    assert.equal((await A({ action: 'favMemoria', id: mem })).code, 200);
    assert.equal((await A({ action: 'addFotos', id: mem, fotos: [BLOB('b'), 'https://evil/x'] })).code, 200);
    let m = (await list()).memorias[0];
    assert.equal(m.titulo, 'Novo'); assert.equal(m.fav, true); assert.deepEqual(m.fotos, [BLOB('a'), BLOB('b')]);
    assert.equal((await A({ action: 'rmFoto', id: mem, index: 9 })).code, 400);
    assert.equal((await A({ action: 'rmFoto', id: mem, index: 0 })).code, 200);
    assert.deepEqual(blob.dels, [BLOB('a')]); m = (await list()).memorias[0]; assert.deepEqual(m.fotos, [BLOB('b')]);
    assert.equal((await A({ action: 'resolveErro', id: err, ok: true })).code, 200);
    assert.equal((await list()).erros[0].ok, true);
    assert.equal((await A({ action: 'resolveErro', id: 'nada', ok: true })).code, 404);
    assert.equal((await A({ action: 'addDownload', nome: 'Pack', t: 'zzz', link: 'javascript:1', arquivo: '../x' })).code, 400);
    const d = await A({ action: 'addDownload', nome: 'Pack', t: 'pack', link: 'https://drive/x', mudancas: ['a', '', 'b'] });
    assert.equal(d.code, 200); assert.deepEqual((await list()).downloads[0].mudancas, ['a', 'b']);
    assert.equal((await A({ action: 'delDownload', id: d.body.id })).code, 200); assert.equal((await list()).downloads.length, 0);
  });
  await t('admin exclui: comentario, desejo (votos+foto), erro (anexos), memoria (cascata + blobs)', async () => {
    const c = (await list()).memorias[0].coms[0];
    assert.equal((await A({ action: 'delComentario', mem, id: c.id })).code, 200); assert.equal((await list()).memorias[0].coms.length, 0);
    await D({ action: 'addComentario', mem, texto: 'x' });
    blob.dels.length = 0;
    assert.equal((await A({ action: 'delErro', id: err })).code, 200);
    assert.deepEqual(blob.dels.sort(), [BLOB('i'), BLOB('l')].sort());
    assert.equal((await A({ action: 'delDesejo', id: wish })).code, 200); assert.equal(store.s['wv:' + wish], undefined);
    blob.dels.length = 0;
    assert.equal((await A({ action: 'delMemoria', id: mem })).code, 200);
    assert.deepEqual(blob.dels, [BLOB('b')]);
    const l = await list(); Object.values(l).forEach((v) => assert.equal(v.length, 0));
    assert.deepEqual(Object.keys(store.h.coms || {}), []);
  });
  await t('import/backup: 4 tipos e reimportar NAO duplica comentarios', async () => {
    const item = { id: 'mem1abc', titulo: 'Velha', data: '2025-05-05', fotos: [BLOB('z')], fav: true, criado: 1700000000000,
      coms: [{ id: 'c1abc', nome: 'A', texto: 'um', criado: 1700000000001 }, { nome: 'B', texto: 'dois', criado: 1700000000002 }] };
    for (let i = 0; i < 2; i++) {
      assert.equal((await A({ action: 'importItem', kind: 'memoria', item })).code, 200);
      assert.equal((await A({ action: 'importItem', kind: 'desejo', item: { id: 'des1abc', nome: 'M', link: 'https://a.b', votos: 7 } })).code, 200);
      assert.equal((await A({ action: 'importItem', kind: 'erro', item: { id: 'err1abc', nome: 'E', ok: true } })).code, 200);
      assert.equal((await A({ action: 'importItem', kind: 'download', item: { id: 'dl1abc', nome: 'D', link: 'https://a.b' } })).code, 200);
    }
    assert.equal((await A({ action: 'importItem', kind: 'xyz', item })).code, 400);
    const l = await list();
    assert.equal(l.memorias.length, 1); assert.equal(l.memorias[0].criado, 1700000000000);
    assert.equal(l.memorias[0].coms.length, 2, 'comentarios duplicados na reimportacao: ' + l.memorias[0].coms.length);
    assert.equal(l.desejos[0].votos, 7); assert.equal(l.erros[0].ok, true); assert.equal(l.downloads.length, 1);
  });
  await t('persistencia: "reiniciar" as funcoes mantem tudo (estado so no banco)', async () => {
    const before = JSON.stringify(await list());
    api = H.loadApi(H.DEFAULT_ENV);
    assert.equal(JSON.stringify(await list()), before);
  });
  await t('sincronizacao: usuario B (outro IP/votante) ve o que A publicou', async () => {
    const r = await D({ action: 'addMemoria', titulo: 'De A' }, { ip: '3.3.3.3' });
    const seenByB = await call(api.data, { method: 'GET', query: { v: 'bbbbbbbb' }, ip: '4.4.4.4' });
    assert.ok(seenByB.body.memorias.some((m) => m.id === r.body.id));
  });
  await t('rate limit anonimo: 429 depois de 30 escritas/min; admin nao e limitado', async () => {
    let last; for (let i = 0; i < 32; i++) last = await D({ action: 'addErro', nome: 'x' + i }, { ip: '5.5.5.5' });
    assert.equal(last.code, 429);
    for (let i = 0; i < 40; i++) assert.equal((await A({ action: 'addErro', nome: 'a' + i }, { ip: '5.5.5.5' })).code, 200);
  });
  await t('forca bruta na senha: tentativas erradas em excesso viram 429', async () => {
    let c; for (let i = 0; i < 25; i++) c = (await D({ action: 'login', admin: 'chute' + i }, { ip: '6.6.6.6' })).code;
    assert.equal(c, 429);
    assert.equal((await D({ action: 'login', admin: PASS }, { ip: '7.7.7.7' })).code, 200);
  });

  console.log('\n== UPLOAD ==');
  const up = (b, o) => call(api.upload, { body: b, ...o });
  const enc = (b) => b.toString('base64');
  await t('png/jpg/txt validos -> URL blob em uploads/ com content-type correto', async () => {
    H.resetStore(); api = H.loadApi(H.DEFAULT_ENV);
    const r = await up({ name: 'Minha Foto!.png', type: 'image/png', data: enc(PNG) }, { ip: '10.0.0.1' });
    assert.equal(r.code, 200); assert.match(r.body.url, /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/uploads\/Minha_Foto-[a-z0-9]+\.png$/);
    assert.equal((await up({ name: 'a', type: 'image/jpeg', data: enc(JPG) }, { ip: '10.0.0.1' })).code, 200);
    assert.equal((await up({ name: 'log.txt', type: 'text/plain', data: enc(Buffer.from('texto')) }, { ip: '10.0.0.1' })).code, 200);
    assert.equal(blob.puts[0].opts.contentType, 'image/png'); assert.equal(blob.puts[0].opts.access, 'public');
  });
  await t('upload sem token do Blob configurado: 503 claro (nao 500)', async () => {
    const a2 = H.loadApi({ ...H.DEFAULT_ENV, BLOB_READ_WRITE_TOKEN: '' }); delete process.env.BLOB_READ_WRITE_TOKEN;
    const r = await call(a2.upload, { body: { type: 'image/png', data: PNG.toString('base64') } });
    assert.equal(r.code, 503); assert.match(r.body.error, /Blob/);
    api = H.loadApi(H.DEFAULT_ENV);
  });
  await t('upload rejeita: tipo nao permitido, vazio, > 3 MB, base64 lixo', async () => {
    for (const ty of ['text/html', 'image/svg+xml', 'application/javascript', '__proto__', 'constructor', '']) assert.equal((await up({ type: ty, data: enc(PNG) })).code, 400, ty);
    assert.equal((await up({ type: 'image/png', data: '' })).code, 413);
    assert.equal((await up({ type: 'image/png', data: enc(Buffer.alloc(3 * 1024 * 1024 + 1, 1)) })).code, 413);
    assert.equal((await up({ type: 'image/png', data: '!!!' })).code, 413);
  });
  await t('upload valida o conteudo real (nao so o type declarado)', async () => {
    assert.equal((await up({ type: 'image/png', data: enc(Buffer.from('<html><script>alert(1)</script></html>')) }, { ip: '10.0.0.2' })).code, 400);
    assert.equal((await up({ type: 'image/jpeg', data: enc(PNG) }, { ip: '10.0.0.2' })).code, 400);
    assert.equal((await up({ type: 'text/plain', data: enc(Buffer.from([65, 0, 66])) }, { ip: '10.0.0.2' })).code, 400);
  });
  await t('upload: 429 para anonimo (40/min); admin importando muitas fotos nao e limitado', async () => {
    let c; for (let i = 0; i < 42; i++) c = (await up({ type: 'image/png', data: enc(PNG) }, { ip: '11.0.0.1' })).code;
    assert.equal(c, 429);
    for (let i = 0; i < 50; i++) assert.equal((await up({ type: 'image/png', data: enc(PNG), admin: PASS }, { ip: '11.0.0.1' })).code, 200, 'admin #' + i);
  });
}

module.exports = { t, results, apiTests, PASS, PNG, JPG };

if (require.main === module) {
  (async () => {
    await apiTests();
    let fe; try { fe = require('./frontend'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
    if (fe) await fe.frontendTests(module.exports);
    const bad = results.filter((r) => !r[0]);
    console.log(`\n${results.length - bad.length}/${results.length} passaram`);
    process.exit(bad.length ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
