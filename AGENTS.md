# Gestão de Rotinas — referência de manutenção

A única aplicação publicada é `public/index.html`, servida por `server/index.js`.
A API usa o Turso configurado no Render. Não substituir dados por seed, backup
antigo ou conteúdo de outros índices da raiz. Os índices da raiz são legados:
não são a aplicação publicada, nem devem ser usados para novas alterações.

## Regras essenciais
- Política atual: `scoped-2026-10-30`. Sessão diária até meia-noite de
  America/Sao_Paulo; fechar a aba ou PWA não faz logout.
- Autoridade de leitura e escrita: `server/access.js`. Menu e JavaScript de
  cliente são apenas apresentação. Alterar permissões exige testes da API.
- Maciel (`u1`) e Alef (`u2`) têm visão completa. Só Maciel administra acessos.
  Visão completa não concede exclusão em massa ou redefinição de senha a Alef.
- Carteira particular fica em `workspace_private`, fora do JSON operacional.
- Cache operacional tem usuário e assinatura de permissões. Troca de conta
  requer nova projeção da API; logout limpa cache e acervo deste aparelho.
- Não introduzir dados reais, contatos, documentos, faturamento ou credenciais
  em HTML, assets públicos ou fixtures de testes.
- A gravação exige versão-base e protocolo de escopo. Conflitos devem devolver
  somente a projeção do usuário. Nunca fazer overwrite forçado sem versão.
- Fotos exigem autorização por referência de registro ou autoria do upload.
- Novos módulos precisam declarar permissões no servidor e no menu. Evitar
  migrações automáticas em renderizações e nunca usar a base de produção como
  ambiente de testes.

## Organização
- `public/access-client.js`: retomada, cache e apresentação de permissões.
- `public/field-ui.js`: início por função, abas da área de trabalho.
- `public/mobile.js` e `mobile.css`: adaptação móvel e acessibilidade.
- `server/auth.js`: contas, cookie e autenticação.
- `server/access.js`: regras de leitura/escrita e anexos.
- `server/db.js`: persistência, concorrência, carteira separada e versões.
- `server/backup.js`: backup privado completo das dez tabelas e restauração
  somente em banco vazio separado. Nunca guardar seus resultados no Git.

## Antes de publicar
1. Executar `npm ci` e `npm test`.
2. Conferir integridade sintática dos scripts inline, assets e servidor.
3. Conferir celular (360, 390 e 430 px), desktop, formulários, teclado e
   restauração da sessão. O teste em computador não substitui aparelho real.
4. Publicar todos os arquivos de uma entrega em branch e integrar atomicamente.
5. Verificar o commit Live do Render, usuários/contagens e API anônima 401.
6. Não chamar o backup antigo de “versão atual”. Conferir sempre o Git e Live.

## Backup
O botão de backup do app exporta o estado operacional autorizado, sem tabelas
de contas. O backup integral exige ambiente privado com as variáveis do Turso:
`node server/backup.js export /caminho-privado/backup.json`.
Para ensaiar recuperação, apontar TURSO_DATABASE_URL para banco separado vazio
antes de `node server/backup.js restore-empty /caminho-privado/backup.json`.
O arquivo contém credenciais e anexos; não anexar a issues, PRs ou repositórios.
As versões em `workspace_backup` preservam dados anteriores a cada gravação,
mas não substituem uma cópia fora do banco. Definir retenção e monitorar espaço.
