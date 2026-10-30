# Autenticação diária — 30/10/2026

Base de implementação: commit a368457. O ponto de entrada continua sendo public/index.html, servido por server/index.js. Não usar os índices antigos da raiz. DB_VER permanece 2.

## Comportamento

- Cada usuário entra com sua senha atual. A sessão vale até a próxima meia-noite em America/Sao_Paulo, por navegador/aparelho. Não é uma janela móvel de 24 horas.
- Reabrir o navegador no mesmo dia restaura a sessão após consulta ao servidor. O login local antigo não autoriza acesso.
- Sair revoga a sessão do navegador no servidor. Trocar a senha ou emitir código de recuperação revoga as outras sessões da conta.
- Abertura/novo login exige internet. Com a página já autenticada, o trabalho offline continua no aparelho durante o mesmo dia. Ao expirar, os registros locais são mantidos, mas é necessário reconectar e entrar novamente para acessar e sincronizar.
- Na primeira abertura após a atualização, a equipe deve recarregar o app e entrar com a senha atual. Senhas salvas pela versão antiga são removidas quando o novo app abre.

## Persistência e migração

server/auth.js cria auth_user, auth_session, auth_meta e auth_throttle no mesmo Turso. initializeAuth roda depois da migração das três tabelas existentes.

Na primeira inicialização, as credenciais legadas são copiadas para auth_user e retiradas do JSON de workspace na mesma transação. Se faltar a credencial do gestor, o servidor recusa iniciar em vez de abrir acesso. O primeiro login válido verifica o algoritmo legado e atualiza o hash para scrypt sem mudar a senha. Senhas novas usam scrypt desde a criação. Nenhuma senha é armazenada em texto puro pelo novo código.

Os tokens de sessão têm 256 bits aleatórios; só o SHA-256 do token é persistido. O cookie de produção é __Host-grc_session, HttpOnly, Secure e SameSite=Strict, com expiração fixa diária, validada também pelo servidor. Em HTTP local de teste é usado um cookie de desenvolvimento distinto.

GET/POST /api/dados nunca expõem hashes/salts de senha. O campo creds na resposta contém apenas definida/trocadaEm para a interface. Credenciais recebidas num snapshot, inclusive de clientes antigos, são ignoradas. Os dados operacionais e fotos não são reinicializados. A versão de sincronização do workspace continua independente de DB_VER.

## Rotas e proteção

- Públicos: GET /api/auth/perfis (nomes/status, sem credenciais), POST /api/auth/login, POST /api/auth/logout e a verificação de sessão que retorna 401 se não houver sessão válida.
- GET /api/saude permanece disponível para o health check do Render; anonimamente informa só ok/protegido/política. Versão, anexos e detalhes operacionais exigem sessão.
- As demais APIs exigem sessão válida. SITE_TOKEN deixa de ser um mecanismo de autorização ou bypass.
- Escritas exigem Origin do próprio host e X-GRC-Client: daily-2026-10-30. O servidor não habilita CORS para outras origens.
- Limite de tentativas persistido no Turso por conta e IP. Dados e anexos privados usam Cache-Control: no-store.
- A identidade do autor da gravação é obtida da sessão, não do nome enviado pelo navegador. Apenas u1 pode emitir códigos de acesso, remover anexos em massa ou alterar as concessões de acesso da equipe.

Esta entrega autentica a API e preserva o modelo atual de módulos/permissões. O app ainda sincroniza um snapshot compartilhado com usuários autenticados; ela não transforma esse modelo em uma API com filtragem de cada campo por cargo. Uma separação granular de leitura/escrita por módulo exige um projeto adicional. O cache operacional offline do aparelho também não é criptografado por esta alteração.

## Primeiro acesso e recuperação

Contas sem senha não podem ser assumidas livremente. O gestor usa Configurações > Senhas da Equipe > Liberar primeiro acesso ou Redefinir. O código gerado vale por 24 horas e uma utilização. Entregar somente ao titular da conta; não colocar o código em logs, auditoria, GitHub ou mensagens públicas. O titular cria sua própria senha com esse código.

## Testes

Executar: node --test tests/auth-diaria.test.js

Cobertura: cálculo da meia-noite e virada de ano, negação de acesso anônimo e de token antigo, origem/cliente inválidos, senha errada, bloqueio de cadastro sem convite, migração do hash legado, cookie persistente/seguro, ausência de credenciais na resposta/snapshot, tentativa de conceder permissões, convite de uso único, revogação por troca de senha/reset/logout, expiração e limite de tentativas. Os testes usam dados artificiais e banco temporário, sem tocar na produção.

Também foi exercitado o DOM completo da interface com servidor de teste: login, restauração após reabertura, remoção de senha persistida, snapshot sem credenciais e logout. Uma migração em cópia do banco operacional confirmou igualdade de todos os dados de negócio e preservação dos 259 anexos.

## Publicação e continuidade

Publicar public/index.html, public/sw.js, server/auth.js e server/index.js juntos. O service worker usa grc-v25-auth-diaria. Não publicar apenas a interface ou apenas o servidor.

Existe Deploy Hook no Render mesmo com Auto-Deploy desativado. Conferir o commit efetivamente Live após a publicação. Não usar seed, zerar aparelhos, restaurar relação de salas ou reenviar snapshots antigos para implantar código. A volta a uma versão anterior sem autenticação reabre as APIs e não é uma estratégia segura de recuperação. Os backups anteriores à autenticação não incluem as quatro tabelas novas; novos backups completos do Turso precisam incluí-las, com o devido cuidado por conterem credenciais.


## Revisão de retomada e celular

A reabertura usa primeiro a sessão persistente já validada pelo servidor. Com uma cópia operacional no aparelho, a tela volta imediatamente após essa validação e os dados sincronizam em segundo plano. Uma falha de download dos dados não encerra uma sessão válida nem exige senha novamente. Se faltar conexão para verificar a sessão, o app mantém o estado e oferece Tentar novamente; após reconectar, retoma sem novo login. Nenhuma decisão de autorização da API é tomada com base em indicadores do localStorage.

O bloqueio continua à meia-noite, por logout, revogação ou troca de conta. Ele também fecha os avisos críticos e modais para que não permaneçam sobre a tela de entrada. Fechar o aplicativo, mudar de aba ou navegar entre módulos não faz logout. A persistência é por ambiente de armazenamento: navegador privado, limpeza de dados ou uso de outro navegador/app instalado não compartilham automaticamente o mesmo cookie.

public/mobile.css e public/mobile.js concentram os novos ajustes de apresentação. O menu móvel e o desktop usam itensNavegacao(), respeitando o mesmo catálogo por perfil. Cartões recebem rótulos das colunas, campos mantêm o foco após filtros, ferramentas secundárias ficam recolhidas e o estado de sincronização permanece visível. Não foram removidos registros ou módulos de negócio. O cache do service worker é grc-v26-mobile-retomada e inclui os dois novos arquivos.

Executar npm test para os testes de servidor e de interface. O teste de interface usa jsdom como dependência apenas de desenvolvimento e percorre 28 telas e os 14 perfis. Ele cobre reabertura, falha de download, reconexão sem senha, logout, meia-noite, igualdade de menus, rótulos e preservação do foco. Ele não substitui a inspeção visual em navegadores e aparelhos reais.

## Revisão de escopo e uso em campo — 30/10/2026

A política adicional é `scoped-2026-10-30`; `DB_VER` continua 2. Leitura, escrita,
anexos, histórico e conflitos passam pelo servidor. Maciel e Alef têm visão
completa; administração de contas permanece exclusiva do Maciel. A carteira
particular migra atomicamente para `workspace_private`, preservando os IDs.
Clientes antigos não podem gravar snapshots globais (HTTP 426). Versão-base é
obrigatória; a tentativa de escrever uma área proibida é recusada (HTTP 403).

Cada cache operacional registra a conta e a assinatura das permissões. Mudança
de conta ou de escopo exige dados novos da API antes de abrir; logout limpa o
cache e as fotos locais. Reabrir no mesmo dia usa a sessão do servidor e pode
retomar o cache autorizado. Nenhuma senha é salva pelo JavaScript.

O início do celular mostra os atalhos da função e a fila de atenção. Tarefas,
rotinas, sem data e calendário ficam na área de Trabalho. Exportações e gráficos
secundários são recolhidos; menus, campos e toques têm adaptação móvel. A
renderização não grava o snapshot por si só. Recorrências mensais respeitam o
último dia existente no mês de destino; não recalculam lançamentos anteriores.

As versões completas antes de cada gravação ficam em `workspace_backup`. O
backup integral das dez tabelas e o ensaio em banco separado vazio usam
`server/backup.js`. Ver `AGENTS.md`; nunca expor os arquivos gerados pelo site
ou pelo Git. Não foi criado agendamento externo automático de backups.
