# Obraland 2 — Diário do Mundo

Site do mundo de Minecraft **Obraland 2**: vídeos e lives, álbum de memórias, mural de erros, lista de mods, links de download e lista de desejos.

É um site **estático** (HTML + CSS + JavaScript puro). Não tem build, não tem dependências e roda direto na Vercel.

## Estrutura

```
index.html      página e toda a lógica
style.css       estilo
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

## Importante: onde os dados ficam

Memórias, erros reportados, metas, desejos e votos ficam salvos **no navegador de cada pessoa** (localStorage e IndexedDB). Eles não são compartilhados entre visitantes. Use **Exportar backup** na aba Início para guardar uma cópia.

Para o conteúdo ser o mesmo para todo mundo, ele precisa estar no código (como `MEDIA`, `DOWNLOADS` e `MODS`) ou o site precisa de um banco de dados.
