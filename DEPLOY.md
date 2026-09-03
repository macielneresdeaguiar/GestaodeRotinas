# Publicar o app — passo a passo pelo navegador

Tempo estimado: **20 a 30 minutos**. Você não precisa instalar nada.

Ordem: **Turso (banco) → GitHub (código) → Render (site)**.
Nessa ordem porque o Render vai pedir os dados do Turso na hora de subir.

Antes de começar, baixe o arquivo **`gestao-rotinas.zip`** que está no workspace e
**descompacte** em uma pasta do seu computador (clique com o botão direito → Extrair).
Você vai usar essa pasta no passo 2.

---

## Passo 1 — Criar o banco no Turso

O Turso é onde os dados ficam guardados de verdade, para o celular e o computador
enxergarem a mesma coisa.

1. Entre em <https://app.turso.tech> com sua conta.
2. Clique em **Create Database** (ou **+ New Database**).
3. Preencha:
   - **Name:** `gestao-rotinas`
   - **Region / Location:** escolha a mais próxima do Brasil — normalmente
     `São Paulo (gru)`. Se não aparecer, use qualquer uma dos EUA.
   - **Plan:** o gratuito atende com folga (nossa base tem menos de 1 MB).
4. Clique em **Create**.

### Copiar os dois valores que o Render vai pedir

Ainda na página do banco recém-criado:

5. Procure o campo **Database URL** (ou aba **Connect**). Vai ser algo como:

   ```
   libsql://gestao-rotinas-seuusuario.turso.io
   ```

   Copie e **cole num bloco de notas**. Esse é o `TURSO_DATABASE_URL`.

6. Agora clique em **Create Token** (fica na mesma tela, às vezes dentro de
   **Connect** ou no menu de três pontinhos do banco).
   - Expiração: escolha **No expiration** (sem expirar), senão o app para de
     sincronizar no dia do vencimento.
   - Permissão: **Read & Write**.
7. Copie o token gerado — é um texto longo começando com `ey...` — e cole no bloco
   de notas também. Esse é o `TURSO_AUTH_TOKEN`.

> ⚠️ **O token só aparece uma vez.** Se fechar a janela sem copiar, é só gerar outro.
> Guarde os dois valores: eles são a chave dos dados dos condomínios, não compartilhe.

**Não precisa criar tabela nenhuma.** O servidor cria sozinho na primeira vez que subir.

---

## Passo 2 — Subir o código para o GitHub

1. Entre em <https://github.com> → botão verde **New** (ou <https://github.com/new>).
2. Preencha:
   - **Repository name:** `gestao-rotinas`
   - **Visibility:** marque **Private** ⬅️ *importante, o app tem dados dos condomínios*
   - **NÃO** marque "Add a README file" — deixe tudo desmarcado.
3. **Create repository**.
4. Na tela seguinte, clique no link **uploading an existing file**
   (fica na frase *"…or push an existing repository…"*, logo acima).
5. Abra a pasta que você descompactou. Selecione **tudo que está dentro dela**
   (as pastas `public`, `server`, `tests`, `dados` e os arquivos soltos) e
   **arraste para a área de upload** do GitHub.

   > Arraste o **conteúdo** da pasta, não a pasta em si. O `public/index.html`
   > precisa ficar em `public/`, não em `gestao-rotinas/public/`.

6. Espere as barrinhas terminarem (são 29 arquivos, ~125 KB — é rápido).
7. Lá embaixo, em *Commit changes*, escreva `Primeira versão` e clique em
   **Commit changes**.

Confira: a página do repositório deve listar `public`, `server`, `tests`, `dados`,
`package.json`, `render.yaml` e `README.md`.

---

## Passo 3 — Publicar no Render

1. Entre em <https://dashboard.render.com>.
2. **New +** → **Web Service**.
3. Em *Source Code*, escolha **GitHub** e clique em **Connect account** se for a
   primeira vez. Autorize o Render a ver seus repositórios.
   - Se o repositório privado não aparecer na lista, clique em
     **Configure account** e libere o acesso a `gestao-rotinas`.
4. Ache `gestao-rotinas` na lista e clique em **Connect**.
5. Confira os campos (o Render já preenche pelo `render.yaml`):

   | Campo | Valor |
   |---|---|
   | Name | `gestao-rotinas` |
   | Region | `Oregon` (ou a que preferir) |
   | Branch | `main` |
   | Runtime | `Node` |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Instance Type | `Free` |

6. Role até **Environment Variables** e clique em **Add Environment Variable**
   três vezes, cadastrando:

   | Key | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | a URL `libsql://...` do Passo 1 |
   | `TURSO_AUTH_TOKEN` | o token `ey...` do Passo 1 |
   | `SITE_TOKEN` | *(veja o quadro abaixo)* |

   > **Sobre o `SITE_TOKEN`:** é uma senha extra na porta do site, além do login do
   > app. Se deixar **em branco**, qualquer pessoa com o endereço abre a tela de
   > login (o login com senha continua valendo normalmente). Como o endereço
   > `.onrender.com` é público, minha recomendação é **deixar em branco por agora**
   > para a equipe conseguir entrar sem complicação — o app já exige usuário e senha.

7. Clique em **Create Web Service**.
8. Acompanhe o log. Em 2 a 4 minutos deve aparecer:

   ```
   ==> Build successful
   [grc] no ar na porta 10000
   ==> Your service is live 🎉
   ```

9. O endereço fica no topo da página:
   **`https://gestao-rotinas.onrender.com`**
   (se o nome já estiver em uso, o Render acrescenta letras no fim — use o que ele mostrar).

---

## Passo 4 — Primeiro acesso e conferência

Abra o endereço no computador e faça o teste abaixo, nesta ordem:

1. **Entre** com o Gestor (Maciel, senha `senha123`) e confira o Dashboard:
   deve mostrar **0 atrasadas**, **3 tarefas para hoje** e **28 pendentes**.
2. No topo da tela, veja o indicador de sincronização: precisa dizer
   **"Sincronizado"**. Se disser "Sem conexão", algo saiu errado — veja *Problemas* abaixo.
3. **Crie uma tarefa qualquer** de teste.
4. Abra o mesmo endereço **no celular**, entre com outro usuário e veja se a tarefa
   apareceu. Se apareceu, o Turso está funcionando de ponta a ponta. 🎉
5. Apague a tarefa de teste.

### Trocar as senhas (faça isso antes de liberar para a equipe)

As senhas atuais são as de desenvolvimento (`senha123`, `alef1234`, `cleiton1`).
Cada pessoa deve entrar e trocar a sua no menu de perfil.

### Instalar no celular

Abra o endereço no celular → menu do navegador → **Adicionar à tela de início**.
O app abre em tela cheia, com ícone próprio, e funciona mesmo sem internet.

---

## Problemas mais comuns

**O site demora 40 segundos para abrir a primeira vez.**
Normal no plano gratuito: o Render hiberna o serviço após ~15 min sem acesso.
Os dados **não** se perdem (estão no Turso). Se incomodar no uso diário, o plano
Starter (US$ 7/mês) mantém o serviço sempre ligado.

**Indicador diz "Sem conexão" mesmo com internet.**
Quase sempre é o Turso. No Render → aba **Logs**, procure a mensagem de erro:
- `SERVER_ERROR` ou `unauthorized` → o `TURSO_AUTH_TOKEN` está errado ou expirou.
  Gere outro no Turso e atualize a variável.
- `URL_INVALID` → o `TURSO_DATABASE_URL` precisa começar com `libsql://`, sem `https://`
  e sem barra no final.
Depois de corrigir, clique em **Manual Deploy → Deploy latest commit**.

**Build falhou.**
Veja se o `package.json` está na **raiz** do repositório, e não dentro de uma
subpasta `gestao-rotinas/`. Se estiver na subpasta, refaça o Passo 2 arrastando o
conteúdo da pasta.

**Cada aparelho mostra dados diferentes.**
Um deles está com base antiga em cache. Basta recarregar a página segurando Shift
(ou fechar e reabrir o app no celular) — a versão nova é reconhecida sozinha.

---

## Domínio próprio (quando quiser)

1. Render → seu serviço → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. Digite o domínio, ex.: `rotinas.suaempresa.com.br`.
3. No painel do seu provedor de DNS (Registro.br, Cloudflare, GoDaddy…), crie:
   - **subdomínio** → registro **CNAME** apontando para o host que o Render mostrar;
   - **domínio raiz** → registro **A** para o IP que o Render indicar.
4. Volte no Render e clique em **Verify**. O HTTPS é emitido sozinho em alguns minutos.

---

## Atualizações futuras

Quando eu alterar o app aqui, você atualiza assim:
GitHub → arquivo `public/index.html` → ícone de lápis → cole o conteúdo novo →
**Commit changes**. O Render detecta e republica sozinho em ~3 minutos.
