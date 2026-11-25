/* Testes de frontend: index.html REAL rodando em jsdom, falando por HTTP com os handlers reais de api/*.js
   (banco/blob em memoria). Nao testa: renderizacao visual, decodificacao real de imagens, Upstash/Blob reais. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('./harness');
const { call, store, blob } = H;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (w, s) => w.document.querySelector(s);
const qa = (w, s) => [...w.document.querySelectorAll(s)];
const click = (w, el) => { assert.ok(el, 'elemento para clicar nao existe'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); };
const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
const setFiles = (w, input, files) => { Object.defineProperty(input, 'files', { value: files, configurable: true }); input.dispatchEvent(new w.Event('change', { bubbles: true })); };

const HTML = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
const JPG_B64 = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(64, 2)]).toString('base64');

async function frontendTests(R) {
  const { t, PASS } = R;
  console.log('\n== FRONTEND ==');
  H.resetStore();
  let api = H.loadApi(H.DEFAULT_ENV);
  const { srv, port } = await H.startServer(() => api);
  const base = `http://127.0.0.1:${port}/`;
  const wins = [];

  async function open(ip, { prompt = '' } = {}) {
    const ctx = { alerts: [], errors: [], pending: 0, prompt, blobs: [], ip };
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => ctx.errors.push('jsdomError: ' + (e.detail || e.message || e)));
    vc.on('error', (...a) => ctx.errors.push('console.error: ' + a.join(' ')));
    const dom = new JSDOM(HTML, {
      url: base, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(win) {
        win.fetch = async (u, o = {}) => {
          ctx.pending++;
          try { const { cache, ...rest } = o; return await fetch(new URL(u, win.location.href).href, { ...rest, headers: { ...(rest.headers || {}), 'x-forwarded-for': ip } }); }
          finally { ctx.pending--; }
        };
        win.alert = (m) => ctx.alerts.push(String(m));
        win.confirm = () => true;
        win.prompt = () => ctx.prompt;
        win.scrollTo = () => {};
        const P = win.HTMLDialogElement.prototype;
        P.showModal = function () { this.setAttribute('open', ''); };
        P.close = function () { this.removeAttribute('open'); };
        win.URL.createObjectURL = (b) => { ctx.blobs.push(b); return 'blob:fake'; };
        win.URL.revokeObjectURL = () => {};
        win.HTMLAnchorElement.prototype.click = function () {};
        win.Image = class { set src(v) { this._s = v; setTimeout(() => { this.width = 800; this.height = 600; this.onload && this.onload(); }, 0); } get src() { return this._s; } };
        win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, fillStyle: '' });
        win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,' + JPG_B64;
        win.addEventListener('error', (e) => ctx.errors.push('window.error: ' + e.message));
        win.addEventListener('unhandledrejection', (e) => ctx.errors.push('unhandledrejection: ' + (e.reason && e.reason.message)));
      },
    });
    ctx.win = dom.window; wins.push(dom.window);
    await settle(ctx);
    return ctx;
  }
  async function settle(ctx, extra = 0) { let quiet = 0; for (let i = 0; i < 400 && quiet < 4; i++) { await sleep(15); quiet = ctx.pending === 0 ? quiet + 1 : 0; } await sleep(extra); }
  const A = (body, ip = '77.0.0.1') => call(api.data, { body: { admin: PASS, ...body }, ip });
  const U = (body, ip = '77.0.0.2') => call(api.data, { body, ip });

  /* ---- dados semeados por "outras pessoas" via API ---- */
  const seeded = {};
  seeded.mem = (await U({ action: 'addMemoria', titulo: 'Primeira base', autor: 'Ana', data: '2026-03-04', desc: 'Dia 1', fotos: ['https://fake123.public.blob.vercel-storage.com/uploads/f1.png', 'https://fake123.public.blob.vercel-storage.com/uploads/f2.png'] })).body.id;
  await U({ action: 'addComentario', mem: seeded.mem, nome: 'Bia', texto: 'Que lindo' });
  seeded.err = (await U({ action: 'addErro', nome: 'Crash ao abrir bau', tipo: 'Crash', nota: 'logs', imgs: [], files: [] })).body.id;
  seeded.wish = (await U({ action: 'addDesejo', nome: 'Create Extras', link: 'https://a.b/c', desc: 'quero', autor: 'Caio', voter: 'voteraaa1' })).body.id;
  await A({ action: 'addDownload', t: 'pack', nome: 'Modpack 1', versao: '1.0', link: 'https://drive.google.com/x', data: '2026-11-24', hora: '10:00' });

  let anon, adm, other;
  await t('pagina carrega sem erros de JS e sem aviso de offline', async () => {
    anon = await open('20.0.0.1');
    assert.deepEqual(anon.errors, []);
    assert.equal(q(anon.win, '#offline').hidden, true);
  });
  await t('as 9 abas existem e cada clique mostra so a secao certa', async () => {
    const ids = qa(anon.win, 'nav button').map((b) => b.dataset.t);
    assert.equal(ids.length, 9);
    for (const id of ids) { click(anon.win, q(anon.win, `nav button[data-t=${id}]`)); const on = qa(anon.win, 'section.on').map((s) => s.id); assert.deepEqual(on, [id]); }
    assert.deepEqual(anon.errors, []);
  });
  await t('visitante ve publicacoes de TODOS (memorias, erros, desejos, downloads)', async () => {
    assert.equal(qa(anon.win, '.memo').length, 1);
    assert.match(q(anon.win, '#album-list').textContent, /Primeira base/);
    assert.match(q(anon.win, '#l-erros').textContent, /Crash ao abrir bau/);
    assert.match(q(anon.win, '#w-list').textContent, /Create Extras/);
    assert.match(q(anon.win, '#dl-main').textContent, /Modpack 1/);
    assert.match(q(anon.win, '#al-stats').textContent, /Fotos\s*$|2/);
  });
  await t('visitante NAO ve nenhum controle de exclusao/admin', async () => {
    assert.equal(q(anon.win, '#adm').textContent, 'Admin');
    assert.equal(q(anon.win, '#adm-import').hidden, true); assert.equal(q(anon.win, '#dl-add').hidden, true);
    assert.equal(qa(anon.win, '[data-del=erros],[data-wdel],[data-dldel]').length, 0);
    assert.ok(qa(anon.win, '[data-res]').every((c) => c.disabled));
    click(anon.win, q(anon.win, '.memo'));
    assert.equal(q(anon.win, '#mdlg').open, true);
    assert.equal(qa(anon.win, '[data-mdel],[data-mcdel],[data-mrmfoto],[data-medit],[data-mfav],#mv-add').length, 0);
    click(anon.win, q(anon.win, '[data-mclose]'));
  });
  await t('visitante forjando ADMIN no navegador e barrado pelo servidor (nada apagado) e volta a visitante', async () => {
    anon.win.eval("ADMIN='palpite'");
    anon.win.eval(`api('delErro',{id:'${seeded.err}'}).catch(e=>alerts_push(e.message))`.replace('alerts_push', 'alert'));
    await settle(anon);
    assert.ok(anon.alerts.some((a) => /admin/i.test(a)), 'alerts=' + anon.alerts);
    assert.equal(Object.keys(store.h.erros).length, 1);
    assert.equal(anon.win.eval('isAdm()'), false, 'sessao admin invalida deveria ser descartada apos 401');
  });
  await t('login admin: senha errada nao libera; senha certa libera controles', async () => {
    adm = await open('20.0.0.2', { prompt: 'errada' });
    click(adm.win, q(adm.win, '#adm')); await settle(adm);
    assert.ok(adm.alerts.some((a) => /incorreta/i.test(a))); assert.equal(q(adm.win, '#adm').textContent, 'Admin');
    adm.prompt = PASS; adm.win.prompt = () => PASS;
    click(adm.win, q(adm.win, '#adm')); await settle(adm);
    assert.equal(q(adm.win, '#adm').textContent, 'Sair do admin');
    assert.notEqual(adm.win.sessionStorage.getItem('obraland2-admin'), PASS, 'senha nao pode ficar no navegador');
    assert.match(adm.win.sessionStorage.getItem('obraland2-admin'), /^\d{13}\.[a-f0-9]{64}$/);
    assert.equal(q(adm.win, '#adm-import').hidden, false); assert.equal(q(adm.win, '#dl-add').hidden, false);
    assert.ok(qa(adm.win, '[data-del=erros]').length >= 1 && qa(adm.win, '[data-wdel]').length >= 1 && qa(adm.win, '[data-dldel]').length >= 0);
    assert.deepEqual(adm.errors, []);
  });
  await t('visitante posta de verdade pela UI: comentario, desejo, voto, erro (aparece p/ todos)', async () => {
    anon = await open('20.0.0.3');
    click(anon.win, q(anon.win, '.memo'));
    const cf = q(anon.win, '#mv-cf'); cf.elements.nome.value = 'Duda'; cf.elements.texto.value = 'comentario da UI'; submit(anon.win, cf); await settle(anon);
    assert.match(q(anon.win, '#mbody').textContent, /comentario da UI/);
    click(anon.win, q(anon.win, '[data-mclose]'));
    const wf = q(anon.win, '#f-wish'); wf.elements.nome.value = 'Mod UI'; wf.elements.link.value = 'https://mod.ui/x'; submit(anon.win, wf); await settle(anon);
    assert.match(q(anon.win, '#w-list').textContent, /Mod UI/);
    const before = anon.win.eval('WISH.find(w=>w.id=="' + seeded.wish + '").votos');
    click(anon.win, q(anon.win, `[data-wvote="${seeded.wish}"]`)); await settle(anon);
    assert.equal(anon.win.eval('WISH.find(w=>w.id=="' + seeded.wish + '").votos'), before + 1);
    click(anon.win, q(anon.win, `[data-wvote="${seeded.wish}"]`)); await settle(anon);
    assert.equal(anon.win.eval('WISH.find(w=>w.id=="' + seeded.wish + '").votos'), before);
    const ef = q(anon.win, '#f-erro'); ef.elements.nome.value = 'Erro da UI'; ef.elements.tipo.value = 'Bug'; ef.elements.nota.value = 'nota'; submit(anon.win, ef); await settle(anon);
    assert.match(q(anon.win, '#l-erros').textContent, /Erro da UI/);
    assert.deepEqual(anon.errors, [], anon.errors.join('\n'));
  });
  await t('upload pela UI: memoria com foto e erro com imagem + log (.txt) chegam ao servidor e aparecem', async () => {
    const f = q(anon.win, '#f-mem'); f.elements.titulo.value = 'Com foto'; f.elements.autor.value = 'Edu';
    setFiles(anon.win, q(anon.win, '#e-mem'), [new anon.win.File([Buffer.from('x')], 'a.jpg', { type: 'image/jpeg' })]);
    submit(anon.win, f); await settle(anon, 50);
    const m = Object.values(store.h.memorias).map((x) => JSON.parse(x)).find((x) => x.titulo === 'Com foto');
    assert.ok(m && m.fotos.length === 1 && /\.public\.blob\.vercel-storage\.com\/uploads\//.test(m.fotos[0]), JSON.stringify(m) + anon.alerts);
    const ef = q(anon.win, '#f-erro'); ef.elements.nome.value = 'Com anexos';
    setFiles(anon.win, q(anon.win, '#e-img'), [new anon.win.File([Buffer.from('x')], 'p.png', { type: 'image/png' })]);
    setFiles(anon.win, q(anon.win, '#e-txt'), [new anon.win.File(['log de crash'], 'latest.log', { type: 'text/plain' })]);
    submit(anon.win, ef); await settle(anon, 50);
    const e = Object.values(store.h.erros).map((x) => JSON.parse(x)).find((x) => x.nome === 'Com anexos');
    assert.ok(e && e.imgs.length === 1 && e.files.length === 1 && e.files[0].name === 'latest.log', JSON.stringify(e) + anon.alerts);
    assert.ok(blob.puts.some((p) => p.opts.contentType === 'text/plain'));
  });
  await t('XSS: titulo/comentario/erro com HTML malicioso nao executa nem injeta elementos', async () => {
    const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>"\'>';
    const m = await U({ action: 'addMemoria', titulo: evil, autor: evil, desc: evil });
    await U({ action: 'addComentario', mem: m.body.id, nome: evil, texto: evil });
    await U({ action: 'addErro', nome: evil, nota: evil }); await U({ action: 'addDesejo', nome: evil, desc: evil, autor: evil, link: 'https://a.b/"onmouseover="window.__xss=3' });
    const x = await open('20.0.0.4'); const w = x.win;
    click(w, qa(w, '.memo').find((b) => b.dataset.open === m.body.id)); await sleep(30);
    assert.equal(w.__xss, undefined); assert.equal(qa(w, 'img[src=x]').length, 0); assert.equal(qa(w, '#mbody script, #album-list script, #l-erros script, #w-list script').length, 0);
    assert.equal(qa(w, '#w-list a[onmouseover]').length, 0);
    assert.match(q(w, '#mbody').textContent, /<img src=x/);
  });
  await t('sincronizacao: B posta e A ve ao voltar para a aba (sem recarregar a pagina)', async () => {
    const a = await open('20.0.0.5'), b = await open('20.0.0.6');
    const bf = q(b.win, '#f-wish'); bf.elements.nome.value = 'Mod do B'; bf.elements.link.value = 'https://b.b/b'; submit(b.win, bf); await settle(b);
    assert.doesNotMatch(q(a.win, '#w-list').textContent, /Mod do B/);
    a.win.dispatchEvent(new a.win.Event('focus')); await settle(a);
    assert.match(q(a.win, '#w-list').textContent, /Mod do B/);
  });
  await t('sincronizacao: atualizacao automatica nao apaga comentario que a pessoa esta digitando', async () => {
    const a = await open('20.0.0.7');
    click(a.win, q(a.win, '.memo')); const ta = q(a.win, '#mv-cf textarea'); ta.value = 'escrevendo...';
    a.win.dispatchEvent(new a.win.Event('focus')); a.win.document.dispatchEvent(new a.win.Event('visibilitychange')); await settle(a);
    assert.equal(q(a.win, '#mv-cf textarea').value, 'escrevendo...');
  });
  await t('admin pela UI: exclui erro, desejo, memoria e download; visitante ve sumir', async () => {
    adm.win.dispatchEvent(new adm.win.Event('focus')); await settle(adm);
    click(adm.win, q(adm.win, `[data-del=erros][data-id="${seeded.err}"]`)); await settle(adm);
    assert.equal(store.h.erros[seeded.err], undefined);
    click(adm.win, q(adm.win, `[data-wdel="${seeded.wish}"]`)); await settle(adm);
    assert.equal(store.h.desejos[seeded.wish], undefined);
    const dl = qa(adm.win, '[data-dldel]'); assert.ok(dl.length >= 1); click(adm.win, dl[0]); await settle(adm);
    assert.equal(Object.keys(store.h.downloads || {}).length, 0);
    click(adm.win, q(adm.win, `[data-open="${seeded.mem}"]`));
    const nc = Object.keys(store.h.coms || {}).filter((k) => k.startsWith(seeded.mem)).length;
    click(adm.win, q(adm.win, '[data-mcdel]')); await settle(adm);
    assert.equal(Object.keys(store.h.coms || {}).filter((k) => k.startsWith(seeded.mem)).length, nc - 1);
    click(adm.win, q(adm.win, '[data-mdel]')); await settle(adm);
    assert.equal(store.h.memorias[seeded.mem], undefined);
    assert.equal(Object.keys(store.h.coms || {}).filter((k) => k.startsWith(seeded.mem)).length, 0, 'comentarios orfaos');
    assert.ok(blob.dels.length >= 2);
    const v = await open('20.0.0.8'); assert.doesNotMatch(q(v.win, '#album-list').textContent, /Primeira base/); assert.doesNotMatch(q(v.win, '#l-erros').textContent, /Crash ao abrir bau/);
    assert.deepEqual(adm.errors, [], adm.errors.join('\n'));
  });
  await t('backup: exportar -> banco zerado -> importar restaura tudo (sem duplicar comentarios)', async () => {
    const mm = (await U({ action: 'addMemoria', titulo: 'Backup mem', fotos: ['https://fake123.public.blob.vercel-storage.com/uploads/z.png'] })).body.id;
    await U({ action: 'addComentario', mem: mm, nome: 'N1', texto: 'um' }); await U({ action: 'addComentario', mem: mm, nome: 'N2', texto: 'dois' });
    await U({ action: 'addDesejo', nome: 'Desejo backup', link: 'https://a.b', voter: 'voterbbb1' });
    adm.win.dispatchEvent(new adm.win.Event('focus')); await settle(adm);
    adm.blobs.length = 0; click(adm.win, q(adm.win, '#exp'));
    const text = await new Promise((res) => { const r = new adm.win.FileReader(); r.onload = () => res(r.result); r.readAsText(adm.blobs[adm.blobs.length - 1]); });
    const dump = JSON.parse(text); assert.ok(dump.memorias.some((m) => m.titulo === 'Backup mem' && m.coms.length === 2));
    const nMem = dump.memorias.length, nDes = dump.desejos.length, nErr = dump.erros.length;
    H.resetStore(); api = H.loadApi(H.DEFAULT_ENV);
    for (let round = 0; round < 2; round++) {
      setFiles(adm.win, q(adm.win, '#imp'), [new adm.win.File([text], 'obraland2-backup.json', { type: 'application/json' })]); await settle(adm, 120);
      await settle(adm);
      const l = (await call(api.data, { method: 'GET' })).body;
      assert.equal(l.memorias.length, nMem, 'rodada ' + round); assert.equal(l.desejos.length, nDes); assert.equal(l.erros.length, nErr);
      const m = l.memorias.find((x) => x.titulo === 'Backup mem');
      assert.deepEqual(m.coms.map((c) => c.texto), ['um', 'dois'], 'rodada ' + round);
      assert.equal(l.desejos.find((d) => d.nome === 'Desejo backup').votos, 1);
    }
    assert.match(q(adm.win, '#imp-st').textContent, /conclu/i);
  });
  await t('importar backup como visitante e recusado sem tocar no banco', async () => {
    const v = await open('20.0.0.9'); const before = JSON.stringify(store.h);
    setFiles(v.win, q(v.win, '#imp'), [new v.win.File(['{"memorias":[{"titulo":"x"}]}'], 'b.json')]); await settle(v, 60);
    assert.ok(v.alerts.some((a) => /admin/i.test(a))); assert.equal(JSON.stringify(store.h), before);
  });
  await t('servidor fora do ar: faixa de offline aparece e a pagina nao quebra', async () => {
    const v = await open('20.0.0.10'); await new Promise((r) => srv.close(r));
    v.win.eval('loadAll()'); await settle(v);
    assert.equal(q(v.win, '#offline').hidden, false);
  });
  wins.forEach((w) => { try { w.close(); } catch (e) {} });
  srv.closeAllConnections && srv.closeAllConnections();
}

module.exports = { frontendTests };
