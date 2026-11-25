# Obraland 2 — Diário do Mundo

Site do mundo de Minecraft **Obraland 2**: vídeos e lives, álbum de memórias, mural de erros, lista de mods, links de download e lista de desejos.

É um site **estático** (HTML + CSS + JavaScript puro, sem build) com funções da Vercel em `api/` para os dados compartilhados.

## Estrutura

```
index.html      página e toda a lógica
style.css       estilo
api/            funções da Vercel (dados e uploads)
imagens/        logo e imagens
vercel.json     configuração da Vercel
package.json    atalhos para rodar localmente
```

## Rodar localmente

```bash
git clone <URL-DO-REPOSITORIO>
cd obraland2
npm start
```

Abra o endereço que o terminal mostrar (normalmente `http://localhost:3000`). Também dá para abrir o `index.html` direto no navegador.

## Publicar na Vercel

1. Acesse [vercel.com/new](https://vercel.com/new) e importe este repositório.
2. Deixe tudo como está (Framework: **Other**, sem Build Command, Output Directory `.`). O `vercel.json` já define isso.
3. Clique em **Deploy**.

A partir daí, todo push na branch `main` publica em produção e todo Pull Request gera uma URL de preview.

## Como contribuir

1. Faça um fork ou crie uma branch: `git checkout -b minha-mudanca`
2. Edite os arquivos e teste localmente.
3. Faça commit e abra um Pull Request para `main`.

### Adicionar um vídeo, short ou live

No `index.html`, procure `const MEDIA=[` e copie uma linha:

```js
{t:'short',a:'Ferickinho',c:'Ferickinho Gameplay',n:'Título do vídeo',id:'ID_DO_VIDEO',u:'https://www.youtube.com/shorts/ID_DO_VIDEO'}
```

- `t`: `'live'`, `'short'` ou `'video'`
- `id`: código do vídeo no link do YouTube

### Publicar um download (modpack, mod ou correção)

No `index.html`, procure `const DOWNLOADS=[` e siga o exemplo comentado acima da lista. Use um link externo (Drive, Mega, Mediafire). Arquivos `.zip` e `.jar` ficam fora do Git de propósito (limite de 100 MB do GitHub).

### Atualizar a lista de mods

No `index.html`, procure `const MODS=[` e atualize a lista com os arquivos da pasta `mods` do Minecraft.

## Dados compartilhados (como funciona)

Memórias, comentários, erros reportados, lista de desejos (com votos) e downloads publicados ficam **no servidor** e aparecem para **todos os visitantes**. Qualquer pessoa pode publicar, comentar e votar; **só o admin pode excluir ou editar**. A checagem é feita no servidor (`api/data.js`), não só na tela.

- `api/data.js` – leitura e escrita dos dados (banco Upstash Redis)
- `api/upload.js` – envio de fotos (JPG/PNG/WebP/GIF) e logs (.txt) de até 3 MB para o Vercel Blob
- `api/_lib.js` – validação, limite de uso, autenticação do admin
- Metas, coordenadas, obras, jogadores e diário continuam **só no navegador** de cada pessoa (localStorage).
- **Exportar/Importar backup** (aba Início) gera/restaura um `.json` com todos os dados compartilhados (importar exige admin).

## Configuração obrigatória na Vercel (produção)

No painel do projeto: **Storage** e **Settings → Environment Variables** (marque Production, Preview e Development):

1. **Banco**: Storage → Create → *Upstash for Redis* (Marketplace) → conecte ao projeto. Isso cria `KV_REST_API_URL` e `KV_REST_API_TOKEN` (o código também aceita `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`).
2. **Arquivos**: Storage → Create → *Blob* com acesso **Public** → conecte ao projeto. Isso cria `BLOB_READ_WRITE_TOKEN`.
3. **Senha do admin**: crie a variável `ADMIN_PASSWORD` com uma senha longa e única.
4. Faça um **Redeploy** depois de criar/alterar variáveis (elas só valem em deploys novos).

Sem essas variáveis a API responde 503 com uma mensagem explicando o que falta (banco, Blob ou senha de admin). Os dados persistem no Redis/Blob, não nos arquivos do deploy.

## Testes

```bash
cd _patch/test
npm install
npm test
```

Os testes rodam as funções reais de `api/` e o `index.html` real (jsdom) com Redis/Blob simulados em memória. Eles **não** substituem um teste no deploy de verdade (veja o roteiro de verificação pós-deploy abaixo).

## Verificação pós-deploy (manual)

1. Abra o site em duas janelas (uma anônima), publique um erro numa e veja na outra.
2. Clique em **Admin** no rodapé, entre com `ADMIN_PASSWORD` e exclua o item de teste; na janela anônima não deve existir botão de excluir.
3. Envie uma foto numa memória e confirme que ela aparece e continua lá após recarregar.
4. Exporte um backup e confira que o arquivo contém os dados.
