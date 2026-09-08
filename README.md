# Gestão de Rotinas Condominiais

App de gestão para os condomínios **E-Business** e **Taguá Life**: tarefas, rotina semanal,
notas fiscais, leituras de água e energia, estoque, pedidos de material, apontamentos,
publicidade nos elevadores (locação de espaços com contrato em PDF) e relatórios.

- Front-end: um único arquivo `public/index.html` (HTML + CSS + JS puro, sem framework).
- Back-end: Express + **Turso** (SQLite na nuvem) apenas para sincronizar os dados entre aparelhos.
- Funciona **offline**: o navegador guarda tudo localmente e envia ao servidor quando há conexão.

---

> **Vai publicar pela primeira vez?** Siga o [DEPLOY.md](DEPLOY.md) — passo a passo
> pelo navegador, sem instalar nada. As seções abaixo são o resumo por linha de comando.

## 1. Criar o banco no Turso

```bash
# instalar a CLI (uma vez)
curl -sSfL https://get.tur.so/install.sh | bash

turso auth login
turso db create gestao-rotinas

# guarde estes dois valores:
turso db show gestao-rotinas --url          # -> TURSO_DATABASE_URL
turso db tokens create gestao-rotinas       # -> TURSO_AUTH_TOKEN
```

As tabelas são criadas sozinhas na primeira vez que o servidor sobe.

## 2. Subir para o GitHub

```bash
cd gestao-rotinas
git init
git add .
git commit -m "Gestão de Rotinas Condominiais"
git branch -M main
git remote add origin git@github.com:SEU_USUARIO/gestao-rotinas.git
git push -u origin main
```

> O repositório deve ser **privado**: o app contém dados operacionais dos condomínios.

## 3. Publicar no Render

1. Render → **New** → **Web Service** → conecte o repositório.
2. O `render.yaml` já define tudo: runtime Node, `npm ci`, `npm start` e health check em `/api/saude`.
3. Em **Environment**, cadastre:

| Variável | Valor |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://...` do passo 1 |
| `TURSO_AUTH_TOKEN` | token do passo 1 |
| `SITE_TOKEN` | senha única do site (opcional; vazio = site aberto) |

4. **Create Web Service**. O endereço sai como `https://gestao-rotinas.onrender.com`.

### Domínio próprio (quando quiser)
Render → Settings → **Custom Domains** → adicione o domínio e crie no seu provedor de DNS:

- subdomínio (ex.: `rotinas.suaempresa.com.br`) → registro **CNAME** apontando para o host que o Render mostrar;
- domínio raiz → registro **A** para o IP indicado pelo Render.

O certificado HTTPS é emitido automaticamente em alguns minutos.

> **Atenção ao plano gratuito do Render:** o serviço hiberna após ~15 min sem acesso e a primeira
> visita depois disso leva de 30 a 60 segundos para responder. Os dados **não** se perdem (ficam no
> Turso). Para uso diário da equipe, vale o plano pago mais barato.

---

## Como funciona a sincronização

- Cada gravação envia o **estado inteiro** do app com um número de versão.
- Se outra pessoa salvou antes, o servidor responde **409 (conflito)**; o app baixa a versão nova,
  aplica na tela e avisa quem alterou. Nada é sobrescrito silenciosamente.
- O app confere novidades a cada 45 segundos e ao voltar a ficar online.
- Um indicador no topo mostra o estado: *Sincronizado*, *Salvando…*, *Sem conexão*.
- Sem internet, tudo continua funcionando e sobe depois.

### API

| Método | Rota | Função |
|---|---|---|
| GET | `/api/saude` | status e versão atual (não exige token) |
| GET | `/api/dados` | baixa o estado atual |
| POST | `/api/dados` | envia o estado (`snapshot`, `versaoBase`) |
| GET | `/api/historico` | últimas 30 gravações: quem, quando, de qual aparelho |

---

## Rodar na sua máquina

```bash
npm install
cp .env.example .env      # preencha as variáveis
TURSO_DATABASE_URL=file:local.db npm start   # banco local, sem nuvem
```

Abra <http://localhost:3000>.

## Testes

```bash
# extrai o JS do HTML e roda as suítes
sed -n '/^<script>/,/^<\/script>/p' public/index.html | sed '1d;$d' > /tmp/a.js
cat tests/hdr2.js tests/hdr3.js /tmp/a.js tests/tarifa.js > /tmp/run.js && node /tmp/run.js
```

Suítes em `tests/`: regressão geral, notas fiscais, migrações, leituras de água,
tarifa da CAESB, projeção de conta, decimais, sincronização, publicidade/contrato em PDF
e vazamento de ícones.
Os testes de navegador (Playwright) são executados sob demanda durante o desenvolvimento.

## Início da operação

O sistema começa a operar em **01/09/2026**. A base nasce sem nenhuma pendência atrasada:

- As demandas recorrentes de **Gestor** e **Administrativo** são geradas nas datas reais do mês
  corrente (mensais no dia certo, semanais em cada ocorrência, diária no dia).
- Nada é criado com data anterior a hoje — não existe tarefa "nascida atrasada".
- Apontamentos, cessões e pedidos começam **vazios**: são preenchidos pela operação real.
- As notas fiscais da competência começam **todas pendentes**.
- **Exceção proposital:** o histórico de leituras de água (15/06 a 02/09/2026) é mantido,
  para preservar a base de comparação de consumo.

`DB_VER = 2` marca esse recomeço: bases da versão anterior (dados de demonstração) são
descartadas automaticamente na primeira abertura, no aparelho e no servidor.

## Dados de referência

- `dados/leituras_agua_ebusiness.csv` — histórico de água do E-Business (15/06 a 02/09/2026).
- `dados/tarifa_caesb.md` — tabela de faixas da CAESB conferida com a fatura 06/2026.
