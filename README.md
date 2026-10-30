# Gestão de Rotinas — E-Business

Aplicação publicada: https://gestaoderotinas.onrender.com/

**Entrada correta: `public/index.html` + `server/index.js`.** Os índices e
scripts antigos na raiz são legados; não representam a versão publicada.
Leia [AGENTS.md](AGENTS.md) antes de pedir alterações a outra IA.

## Versão de referência

Política `scoped-2026-10-30`, banco `DB_VER=2`.
- Autenticação pelo servidor com cookie persistente até a meia-noite de Brasília.
- Maciel e Alef veem todas as áreas; demais contas recebem apenas dados permitidos.
- API filtra leitura, gravação, anexos e respostas de conflito.
- Carteira particular em tabela separada; cache por conta e permissões.
- Início móvel por função, botões maiores, área de Trabalho, tabelas identificadas.
- Versões anteriores recuperáveis e backup integral privado das dez tabelas.

## Executar

Node 20 ou superior. `npm ci`, depois `npm start`.
Configure `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` no ambiente privado.
A instalação usa as contas existentes no Turso. Não há senha padrão ou
cadastro público: novas contas precisam de código liberado pelo gestor.
`SITE_TOKEN` é legado e não substitui a sessão individual.

## Validar e publicar

`npm test` cobre autenticação, retorno diário, rede indisponível, escopo dos
14 perfis, tentativa de acesso indevido, anexos, conflitos, restauração de
backup, telas, menu móvel, foco da busca e limites de datas recorrentes.

Entregas devem ser integradas atomicamente na branch principal, após testes.
Conferir o commit Live no Render depois da integração. Não publicar branches
intermediárias ou repor um índice antigo por cima de `public/index.html`.
Não commitar backups, segredos, dados reais de produção ou bancos locais.

## Backup e arquitetura

O backup do app é operacional e não contém as tabelas de contas. A recuperação
completa usa `server/backup.js`; instruções e limites estão em [AGENTS.md](AGENTS.md).
As cópias ficam fora do conteúdo estático. Não há agendamento externo automático
configurado por esta versão; o responsável deve definir retenção e periodicidade.

A interface legada segue sendo extraída por partes. Ela ainda concentra regras
no HTML, mas os novos fluxos móveis e a política de acesso estão em arquivos
separados. Evitar reescrita integral ou mudança de fórmulas financeiras junto
com uma alteração visual. Validar as rotinas em aparelhos reais com a equipe.
