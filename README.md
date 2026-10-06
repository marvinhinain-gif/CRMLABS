# CRMLABS

CRM para organizar relacionamentos, atendimento e oportunidades comerciais. A área principal é o **Social Seller**: Kanban personalizável + Direct e comentários do Instagram pela API oficial da Meta.

> Status da integração com o Instagram: **implementada e coberta por testes de contrato, pendente de validação real** com credenciais da Meta e conta profissional autorizada (ver [Pendências externas](#pendências-externas)).

---

## Abrir no Mac com um clique (modo local)

1. Dê dois cliques em **Iniciar CRMLABS.command** (na primeira vez o macOS pode pedir confirmação: clique com o botão direito → Abrir).
2. Na primeira vez ele instala as dependências e prepara tudo (alguns minutos). Das próximas vezes abre em segundos; quando o código é atualizado, ele recompila sozinho.
3. O navegador abre em `http://localhost:3000`. Seu login e senha ficam no arquivo **Acesso local.txt**, criado nesta pasta.
4. Para encerrar, feche a janela do Terminal (ou Ctrl+C nela).

O modo local usa um PostgreSQL embutido (pasta `dados-locais/`, nada é instalado no sistema) e precisa apenas do **Node.js 20.9+**; se ele não existir, o próprio arquivo abre a página oficial para instalar. Os dados ficam só neste computador. Links de convite e de recuperação de senha aparecem na janela do Terminal, porque não há e-mail configurado. O Instagram não funciona em `localhost` (a Meta exige HTTPS público).

## Sumário

1. [Stack e decisões](#stack-e-decisões)
2. [Rodar localmente](#rodar-localmente)
3. [Usuários, convites e e-mail](#usuários-convites-e-e-mail)
4. [Configurar o Instagram](#configurar-o-instagram)
5. [Testes e QA](#testes-e-qa)
6. [Deploy](#deploy)
7. [Arquitetura](#arquitetura)
8. [Segurança, retenção e backups](#segurança-retenção-e-backups)
9. [O que funciona, o que foi testado e o que falta](#o-que-funciona-o-que-foi-testado-e-o-que-falta)

---

## Stack e decisões

| Camada | Escolha | Motivo |
|---|---|---|
| Web | **Next.js 16** (App Router) + React 19 + TypeScript | Sugestão da especificação; UI e API no mesmo projeto |
| Estilo | Tailwind CSS 4 com tokens da paleta aprovada | Raios, cores e espaçamentos centralizados em `src/app/globals.css` |
| Fonte | **Poppins** hospedada localmente (`@fontsource/poppins`, pesos 400/500/600/700, latin) | Sem dependência de CDN |
| Banco | **PostgreSQL** + Drizzle ORM | Migrações SQL versionadas em `drizzle/`; sem binários externos |
| Autenticação | Própria, no servidor: sessões opacas em cookie `httpOnly` + tabela `sessions` | Revogação imediata, “lembrar de mim” só muda a duração, convites e recuperação de uso único |
| Senhas | `scrypt` nativo do Node | Sem dependências nativas |
| Tempo real | Server-Sent Events + Postgres `LISTEN/NOTIFY` | Funciona com várias instâncias; eventos são filtrados por permissão |
| Arrastar e soltar | `@dnd-kit` (mouse, toque e teclado) | Acessível; alternativa “Mover para etapa” no menu |
| Componentes | Radix (diálogo, menu, popover) | Foco e teclado corretos |
| E-mail | Nodemailer (SMTP) | Funciona com qualquer provedor transacional |

**Por que não Supabase?** A especificação o sugere como opção. Optei por Postgres puro + auth própria para não depender de um serviço externo já contratado e para manter as regras de permissão em um único lugar (camada de serviços no servidor). O schema roda em qualquer Postgres 14+ — inclusive no Postgres do Supabase, Neon, RDS etc.

## Rodar localmente

Pré-requisitos: **Node 20.9+** e **PostgreSQL 14+**.

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e ENCRYPTION_KEY
# gere a chave de criptografia:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm run db:migrate            # aplica as migrações
SEED_ADMIN_NAME="Marvin Hinain" SEED_ADMIN_EMAIL=voce@empresa.com SEED_ADMIN_PASSWORD='uma-senha-forte' npm run db:seed
npm run db:seed:demo          # opcional: organização de demonstração separada
npm run dev                   # http://localhost:3000
npm run worker                # em outro terminal: fila de webhooks, renovação de tokens, retenção
```

- `db:seed` cria a organização real (padrão **AXION**) e o primeiro administrador. É idempotente.
- `db:seed:demo` cria **“AXION · Demonstração”**, uma organização *separada* (`is_demo = true`) com contatos, conversas, oportunidades e tarefas fictícias que reproduzem os mockups. Envio externo é bloqueado e nenhuma conta do Instagram é simulada como conectada. Se o administrador real já existir, ele ganha acesso à demo pelo seletor de organização no menu do perfil. A senha dos usuários demo vem de `DEMO_PASSWORD` ou é gerada e exibida no terminal.

Rotas: `/login`, `/recuperar-senha`, `/redefinir-senha`, `/convite`, `/dashboard`, `/social-seller`, `/conversas`, `/contatos`, `/comercial`, `/tarefas`, `/configuracoes`.

## Usuários, convites e e-mail

- **Convite:** o administrador convida em **Configurações → Equipe**; a pessoa recebe um link válido por 7 dias e de uso único para criar a senha.
- **Pedido de acesso:** qualquer pessoa pode se cadastrar em `/cadastro` (link “Criar conta” no login). O pedido fica **pendente** e não permite entrar. Os administradores recebem uma notificação, escolhem o papel e clicam em **Aprovar** (ou **Recusar**, que remove o cadastro) em **Configurações → Equipe → Pedidos de acesso**. Quem foi aprovado recebe um e-mail. A tela de cadastro responde sempre da mesma forma, sem revelar se um e-mail já existe, e limita pedidos repetidos. O cadastro pode ser fechado em **Configurações → Organização → Acesso à equipe**.
- Recuperação de senha: link válido por 1 hora, uso único; a resposta é sempre neutra (não revela se o e-mail existe) e todas as sessões abertas são encerradas ao redefinir.
- Bloqueio após 5 tentativas erradas em 15 minutos (por e-mail e por IP).
- Usuário desativado perde o acesso na hora (sessões revogadas).

**E-mail:** em produção use `MAIL_TRANSPORT=smtp` com `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (qualquer provedor: Amazon SES, Resend SMTP, Postmark, SendGrid…). Em desenvolvimento, `MAIL_TRANSPORT=console` imprime os links no log do servidor; esse modo é **recusado** quando `NODE_ENV=production`.

## Configurar o Instagram

Rota escolhida: **Instagram API com Login do Instagram** (`graph.instagram.com`, Graph API v25.0 — documentação conferida em 04/10/2026). É a rota indicada para contas profissionais que não precisam de Página do Facebook. Tokens e permissões da rota “Facebook Login” não são misturados (`connected_accounts.auth_route`).

### Requisitos
1. Conta do Instagram **profissional** (Empresa ou Criador) — no cenário inicial, @olucaoferraz.
2. App no [Meta for Developers](https://developers.facebook.com/) com o produto **Instagram → API setup with Instagram login**.
3. Aplicação publicada em **HTTPS público** (o OAuth e os webhooks da Meta não aceitam `localhost`). Para testar localmente, use um túnel HTTPS (ex.: Cloudflare Tunnel) e coloque essa URL em `APP_URL`.

### Passo a passo
1. No app da Meta, copie **Instagram App ID** e **Instagram App Secret** para `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`.
2. Defina um texto secreto qualquer em `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
3. Em **Business login settings**, cadastre a URI de redirecionamento OAuth: `APP_URL/api/integrations/instagram/callback`.
4. Em **Webhooks**, use a URL de callback `APP_URL/api/webhooks/instagram` com o mesmo verify token e assine os campos **messages** e **comments**.
5. Cadastre os callbacks de desautorização (`/api/webhooks/instagram/deauthorize`) e de exclusão de dados (`/api/webhooks/instagram/data-deletion`).
6. Adicione a conta do Instagram como testadora do app (modo de desenvolvimento) até a revisão da Meta.
7. Reinicie o servidor e o worker. Em **Configurações → Integrações** o painel mostra o que falta; todas as URLs acima aparecem lá com botão de copiar.
8. Como administrador, clique em **Conectar Instagram**. O status só vira **Conectado** depois que o servidor confirma a credencial no provedor e inscreve os webhooks; os outros estados possíveis são *Permissão insuficiente*, *Reconexão necessária*, *Erro* e *Desconectado*.
9. Para produção com usuários reais, solicite na revisão do app as permissões `instagram_business_basic`, `instagram_business_manage_messages` e `instagram_business_manage_comments` (e, se for usar respostas fora das 24 h, o recurso **Human Agent**; depois disso, ative `INSTAGRAM_HUMAN_AGENT_ENABLED=true`).

### O que a integração faz
- **Direct:** recebe mensagens por webhook; responde conversas iniciadas pelo usuário dentro da janela de 24 h (7 dias com Human Agent aprovado). Estados de envio: *Enviando*, *Aceita pelo Instagram*, *Não confirmada*, *Falhou*; *Lida* somente quando a Meta envia o evento de leitura. Contato com @ cadastrado manualmente **não** ganha envio — é preciso identidade oficial (IGSID) vinda da API.
- **Comentários:** recebe por webhook e sincroniza mídias recentes; “Responder comentário” (público) e “Enviar resposta privada” (Direct, uma por comentário, até 7 dias) são ações separadas.
- **Deduplicação:** eventos por conta + id do evento; contatos por identificador oficial (nunca por nome); mensagens por `mid`. Reentregas não duplicam nada.
- **Envio idempotente:** cada clique gera um `clientRequestId`; se o provedor demora (timeout), a mensagem fica “Não confirmada” e só pode ser reenviada depois de “Verificar envio” (consulta à API) ou quando o eco do webhook a confirma automaticamente.
- **Tokens:** longos (60 dias), guardados criptografados (AES-256-GCM) em tabela separada, renovados pelo worker 10 dias antes de expirar.

### Caixa de entrada comercial (Instagram → Directs, Comentários, Histórico)
Cada item abaixo foi mapeado para um recurso oficial da *Instagram API com Instagram Login* (permissões `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`):

| Funcionalidade | Como funciona | Recurso oficial |
|---|---|---|
| Lista de Directs | Instagram → sincronização → banco do CRMLABS → tela. Webhook `messages` em tempo real + sincronização a cada 5 min: **incremental** (páginas mais recentes até encontrar conversas já em dia) e **histórico completo** (todas as páginas, retomando pelo cursor salvo, 6 páginas de 25 por vez para respeitar a cota). Nome e foto oficiais chegam aos poucos (30 perfis por vez). | `GET /me/conversations?platform=instagram&fields=participants,updated_time,messages{…}&after={cursor}` (20 mensagens mais recentes por conversa) · `GET /{igsid}?fields=name,username,profile_pic` |
| Pesquisa e rolagem | Pesquisa no banco (todas as conversas sincronizadas, não só as carregadas): nome, @, ID oficial do Instagram ou trecho da mensagem, com espera de 300 ms; índices trigram (`pg_trgm`) em nome, @ e texto. Rolagem infinita com cursor estável (data + id). Estados "Pesquisando…", "Nenhuma conversa encontrada" e "Sincronizando conversas…" | — |
| "Sem resposta / Todas / Stories" | Filtro operacional do CRM (2º nível). "Stories" lista conversas com resposta aos stories da conta ou menção em story | Campo `story` da mensagem e `reply_to.story` do webhook |
| Tipos de mensagem | Texto, foto, vídeo, áudio, arquivo, compartilhamento, resposta e menção de story | Campos `attachments`, `shares`, `story` e eventos de webhook |
| Responder Direct | Dentro da janela de 24 h (7 dias com Human Agent) | `POST /me/messages` |
| Comentários por publicação, curtidas, oculto | Webhook `comments` + sincronização das 12 publicações mais recentes | `GET /me/media?fields=…,like_count,comments_count,comments{…,replies{…}}` |
| Responder / Ocultar / Excluir / Comentar no post | Respostas a uma resposta vão para o comentário principal com @menção (o Instagram só tem um nível) | `POST /{comment-id}/replies` · `POST /{comment-id}?hide=` · `DELETE /{comment-id}` · `POST /{media-id}/comments` |
| Responder no Direct (privada) | Uma por comentário, até 7 dias | `POST /me/messages` com `recipient.comment_id` |
| Pendente / Resolvido | Regra do CRMLABS: responder (pelo CRM ou pelo próprio app do Instagram) resolve; nova mensagem/comentário volta a pendente; "Marcar como resolvido" manual | — |
| Histórico (só administrador) | Toda ação registrada com pessoa, horário, destinatário, ação e status | — |

**Não disponível pela API oficial (não simulado):**
- **Pastas Principal / Geral / Pedidos / Parcerias:** a API devolve as conversas sem informar a pasta e não tem filtro por pasta; por isso não há abas nem contador de "Pedidos" (seriam falsos). Conversas que estão em Pedidos chegam normalmente pela API e aparecem na lista; as inativas há mais de 30 dias em Pedidos não são devolvidas pela API. **Pedidos ocultos não estão disponíveis através da API utilizada.** Aceitar/recusar pedidos também não existe na API.
- **Stories de terceiros:** a API não lista stories de seguidores ou de outras contas, não dá acesso às mídias deles e não tem endpoint de "responder a um story". O que existe e foi implementado: quando alguém **responde a um story da conta** ou **menciona a conta em um story**, isso chega como mensagem no Direct (com link temporário da mídia, que expira) e pode ser respondido pelo Direct dentro da janela de 24 h — registrado no histórico como "Respondeu ao story". Não há tela de visualizador de stories, scraping, automação de navegador nem login/senha do Instagram.
- Curtir comentários pela conta, mensagens além das 20 mais recentes de cada conversa antiga e confirmação de entrega. As URLs de mídia expiram e são renovadas ao abrir a publicação.

### Contato do Instagram × Lead comercial
Três camadas separadas: **Instagram** (relacionamento: conversas e comentários) → **Kanban do Social Seller** (oportunidade) → **Kanban do Closer** (qualificado).
- Mensagem ou comentário cria apenas o **contato do Instagram** (deduplicado pelo identificador oficial). **Ninguém vira Lead nem entra no Kanban só por conversar.**
- **Transformar em Lead** (no Direct, no painel do contato e no comentário): Contato, Origem (Instagram Direct / Comentário), Produto de interesse, Etapa inicial, Responsável e Observação → "Adicionar ao Kanban". Sem duplicar: se o contato — ou outro contato com o mesmo @ — já é Lead, aparece "Este contato já é um Lead" com "Ver Lead".
- No Direct, a faixa abaixo do nome mostra "Não está no CRM · Transformar em Lead" ou "Lead no CRM · Etapa · Responsável · Ver Lead".
- **Entradas automáticas antigas:** os cartões criados pela regra anterior foram marcados (`relationship_entries.auto_created`) e **não foram apagados**. Eles não contam como Lead e aparecem com o selo "Entrada automática". O administrador vê o aviso no Social Seller → **Revisar**, com sinais de que a equipe já trabalhou o contato (respondeu, moveu, tem tarefa/anotação), e decide um a um (ou selecionando): *Manter como Lead* ou *Remover do Kanban* (fecha o cartão; contato, conversa e histórico continuam). Formulário, encaminhamento ao closer ou "Transformar em Lead" também confirmam o cartão.

### Fora do escopo (não implementado de propósito)
Assistir ou listar stories de terceiros, importar todos os seguidores, histórico integral de conversas anteriores à conexão e prospecção irrestrita por DM. Não há iframe, scraping, sessão automatizada nem botão de fachada para isso. Anexos no Direct exigem armazenamento de arquivos com URL pública e ficaram fora do MVP (o adaptador já conhece o formato da API).

## Testes e QA

```bash
npm test          # 103 testes em banco real (TEST_DATABASE_URL), limpa o banco a cada teste
npm run lint      # verificação de tipos
```

| Arquivo | Cobre |
|---|---|
| `tests/auth.test.ts` | login, mensagem genérica, bloqueio por tentativas, lembrar de mim, logout, desativação, recuperação de uso único, convites |
| `tests/permissions.test.ts` | isolamento entre organizações, seller × seller, closer via oportunidade, edição de funil, conexão só por admin, filtro do tempo real, caixa compartilhada |
| `tests/board.test.ts` | mover com histórico, conflito sem sobrescrever, histórico imutável no banco, uma entrada ativa por funil, editar/reordenar/arquivar etapas com destino, CSV com duplicidades, mesclagem |
| `tests/dashboard.test.ts` | zeros sem dados, métricas batendo com registros conhecidos, escopo e filtro por responsável, reabrir venda recalcula |
| `tests/instagram-leads.test.ts` | sincronização completa por cursor (400 conversas), busca por @/nome/ID/texto fora da lista carregada, rolagem sem pular nem repetir, Direct pessoal fora do Kanban, Transformar em Lead, sem duplicar (mesmo contato e mesmo @), revisão do administrador, Stories |
| `tests/instagram.test.ts` | **contrato** com adaptador falso: OAuth/state, status só após verificação, permissões, desconexão/revogação, assinatura, dedup, fora de ordem, idempotência, timeout/reconciliação, eco, janela de 24 h, contato sem identidade, respostas a comentários, modo demo |
| `tests/http.test.ts` | verificação do webhook, assinatura, sessão obrigatória, CSRF por Origin, nenhum segredo na API |

Os testes do Instagram são **de contrato** (o adaptador real é substituído por um falso, permitido apenas quando `VITEST=true`). Eles não substituem o teste real com conta autorizada.

QA no navegador (Playwright para Python, com o servidor rodando e a demo semeada):

```bash
python3 scripts/qa/screens.py http://localhost:3000 admin@demo.crmlabs.local SENHA        # capturas em qa-screenshots/
python3 scripts/qa/kanban_flow.py http://localhost:3000 admin@demo.crmlabs.local SENHA    # arrastar, menu, teclado, histórico
python3 scripts/qa/mobile_overflow.py http://localhost:3000 admin@demo.crmlabs.local SENHA # sem rolagem horizontal a 390 px
```

## Deploy

Nada de infraestrutura foi presumido. Qualquer ambiente que rode Node 20+ e um Postgres gerenciado serve. Dois processos:

1. **Web:** `npm ci && npm run build && npm run db:migrate && npm start`
2. **Worker:** `npm run worker` (processo contínuo; consome a fila de webhooks, renova tokens e aplica retenção)

Exemplos: Railway/Render/Fly.io (web + worker no mesmo projeto) com Postgres gerenciado; ou uma VM com Docker/systemd. Em plataformas serverless (ex.: Vercel), o webhook ainda processa a fila logo após recebê-la, mas o worker precisa rodar em outro lugar (ou um cron chamando o processamento) e o SSE pode ser encerrado pelo tempo máximo de função — nesse caso a interface continua funcionando, só atualiza ao focar a janela.

Checklist de produção: `NODE_ENV=production`, `APP_URL` com HTTPS, `ENCRYPTION_KEY` exclusiva e guardada em cofre, SMTP configurado, backups automáticos do Postgres ativados.

## Arquitetura

```
src/
  app/                    páginas (App Router) e rotas da API (src/app/api/**)
  components/             UI: shell, ui (design system), social, conversations, contacts, commercial, tasks, settings
  lib/                    cliente: chamadas à API, formatação pt-BR/America/Bahia, tempo real
  server/
    db/schema.ts          modelo de dados (todas as tabelas de negócio têm org_id)
    auth/                 sessões, convites, recuperação
    permissions.ts        matriz de papéis + filtros SQL de visibilidade
    services/             regras de negócio (contatos, quadro, etapas, tarefas, comercial, dashboard, conversas, comentários)
    integrations/instagram/
      client.ts           adaptador HTTP oficial (graph.instagram.com) + classificação de erros
      accounts.ts         contrato de capacidades por conexão
      oauth.ts            conexão, teste, desconexão, renovação, desautorização
      webhooks.ts         assinatura, fila durável, backoff, deduplicação
      processor.ts        eventos → contatos, conversas, mensagens, comentários
      retention.ts        política de retenção
drizzle/                  migrações SQL (incluindo trigger que torna o histórico imutável)
scripts/                  migrate, seeds, worker, QA
tests/                    testes automatizados
```

Princípios: a UI nunca decide permissão — toda leitura e mutação passa pelos serviços, que aplicam o escopo do papel na própria consulta SQL (listas, buscas, quadro, dashboard e tempo real). Eventos de tempo real só dizem “algo mudou” e são entregues apenas a quem pode ver o registro; o cliente recarrega pela API.

Métricas do dashboard (definições da especificação): *Novos interessados* = contatos distintos cuja **primeira** entrada na etapa de chave `novo-interessado` caiu no período; *Conversas ativas* = conversas abertas com ao menos uma mensagem no período; *Reuniões agendadas* = reuniões não canceladas com início no período; *Vendas fechadas* = soma das oportunidades ganhas pela data de fechamento (valor negociado, **não** recebimento). A distribuição por etapa é a posição atual e ignora o período.

## Segurança, retenção e backups

- Autorização no servidor em cada rota; CSRF por verificação de `Origin` + cookie `SameSite=Lax`; cabeçalhos de segurança (`X-Frame-Options: DENY`, `nosniff`, etc.).
- Tokens do Instagram só no servidor, criptografados, nunca em URL (enviados no cabeçalho `Authorization`), nunca no frontend nem nos logs (o logger remove `token`, `secret`, `password`).
- Histórico de etapas e auditoria são imutáveis por trigger no banco.
- **Retenção:** em Configurações → Organização define-se quantos dias manter mensagens e comentários depois de desconectar a conta (padrão: manter). Contatos, cartões, notas e histórico são preservados. Eventos brutos de webhook processados são apagados após 30 dias. Ao receber revogação ou pedido de exclusão da Meta, os tokens são apagados na hora.
- **Backup:** `pg_dump --format=custom "$DATABASE_URL" > crmlabs-$(date +%F).dump` (ou backups automáticos do provedor).
- **Restauração:** `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" crmlabs-AAAA-MM-DD.dump` e, em seguida, `npm run db:migrate`. A `ENCRYPTION_KEY` precisa ser a mesma da época do backup para que os tokens continuem legíveis (caso contrário, basta reconectar o Instagram).

## O que funciona, o que foi testado e o que falta

### Funciona (testado automaticamente e no navegador)
- Login, logout, lembrar de mim, bloqueio de abuso, convite e recuperação (com transporte de e-mail em modo console).
- Papéis e permissões no servidor, isolamento por organização, caixa compartilhada.
- Dashboard calculado de registros reais (zeros sem dados), com filtros e links para as listas.
- Social Seller: Kanban com etapas editáveis/coloridas/reordenáveis, arquivamento com destino, arrastar e soltar (mouse, toque, teclado), “Mover para etapa”, atualização otimista com rollback, conflito entre colegas, histórico imutável, filtros e busca, paginação por coluna.
- Painel de contato: dados, etapa, responsável, próxima ação, tags, tarefas, notas internas, histórico, encaminhar ao closer.
- Conversas (caixa central) e aba Direct com o mesmo componente, regras de elegibilidade e estados de envio.
- Comentários com ações separadas e elegibilidade da resposta privada.
- Contatos: lista paginada, filtros, importação CSV com prévia e relatório, mesclagem auditada.
- Comercial: funil separado, ganho/perda/reabertura, reuniões internas.
- Tarefas: Hoje, Atrasadas, Próximas, Concluídas; alertas internos.
- Responsividade (desktop, tablet com menu recolhido, celular com drawer) sem rolagem horizontal a 390 px.

### Testado com conta real do Instagram
- **Nada ainda.** Não havia credenciais da Meta nem URL HTTPS pública neste ambiente. Nenhuma mensagem foi enviada a clientes reais.

### Pendências externas
1. Criar/configurar o app na Meta e preencher `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
2. Publicar em HTTPS público e cadastrar as URLs de callback/webhooks.
3. Adicionar @olucaoferraz (ou uma conta de teste) como testadora e conectar pelo painel.
4. Validação real a fazer com essa conta (critérios de aceite ainda abertos): OAuth e revogação; mensagem recebida e resposta visualizada no app do Instagram; comentário recebido e resposta pública confirmada; resposta privada; confirmar se o `from.id` dos comentários coincide com o IGSID das mensagens (o código trata ambos como identificador oficial, mas só um teste real confirma); confirmar o envio do token por cabeçalho `Authorization` em todos os endpoints de `graph.instagram.com`.
5. Revisão do app pela Meta para uso com contas fora da lista de testadores.
6. Configurar um provedor SMTP para convites e recuperação em produção.
7. Substituir o **logo SVG provisório** (`src/components/brand/Logo.tsx` e `src/app/icon.svg`) pelo ativo oficial quando disponível.

### Evoluções futuras (não incluídas como botões sem comportamento)
Google Calendar, WhatsApp, checkout, IA, anexos no Direct, conversão histórica por coorte.

### Referências consultadas (04/10/2026)
- [Instagram API com Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
- [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Send Messages (Messaging API)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)
- [Private Replies](https://developers.facebook.com/docs/instagram-platform/private-replies)
