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
- Versões anteriores recuperáveis e backup integral privado das treze tabelas.

## Brigada mensal e gestão de Maciel — 03/11/2026
- A brigada registra o check-list mensal e a ronda diária e mantém evidências das falhas.
- Maciel recebe as pendências no Meu espaço e no Check-list por Andar; somente ele confere e registra a solução.
- O módulo separado Brigada e manutenção foi retirado. Seus registros antigos são preservados em arquivo somente para Maciel, sem novas ações.
- A API protege resolução e conferência contra alterações por outros perfis e clientes antigos (manager-review-v2).
- As pendências permanecem nos meses seguintes até a conferência de Maciel.
- Cache grc-v36-vendas-custas-sgq; backup integral mantém 13 tabelas.

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

## Materiais de limpeza — 04/11/2026
- Página limpeza e /api/limpeza somente para u1, u2 e u4. Fernanda não recebe acesso ao estoque geral.
- u4 informa estoque e confirma contagem; u1/u2 cadastram materiais, ideal e preços, preparam e finalizam pedido para cotação.
- cleaning_record armazena catálogo privado e um registro por mês com versão, itens e histórico. Nenhum dado do condomínio ou fornecedor fica em assets públicos.
- Avisos dentro do app a partir do dia 15 (Brasília), pendentes até conferência; após confirmação, aviso para Maciel/Alef. Não há envio de push com o app fechado nem envio automático ao fornecedor.
- Sugestão máximo(0, ideal - estoque); quantidades de compra inteiras, ajuste manual, preço editável e PDF real com ou sem preços. PDF exige pedido salvo e finalizado.
- Meses iniciados preservam catálogo/preços próprios; reajuste do cadastro só vale nos próximos meses. Concorrência retorna 409 sem sobrescrever.
- Backup privado inclui cleaning_record (13 tabelas); backup operacional antigo não inclui este módulo.


## Vendas e custas SGQ — 10/11/2026
O módulo usa competência mensal, seleção explícita de ciclos, faturamento ADM e custas SGQ automáticas de água das lojas M e publicidade vinculada. Os relatórios Excel e PDF seguem as estruturas dos modelos do condomínio. Pendências impedem emissão; a API usa a versão salva e o escopo autorizado. O fechamento mensal preserva valores anteriores contra reajustes futuros e permite reabertura auditada. Dados reais e vínculos permanecem exclusivamente na base privada. Ver detalhes em AGENTS.md.
