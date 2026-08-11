# Leads Hub — Fase 1: Fundação, Autenticação e Multi-Cliente

Registro do que foi implementado a partir da especificação "Documentação de Implementação
01". Complementa o [DOCUMENTACAO.md](DOCUMENTACAO.md) (que descreve o protótipo/mock
original) — este arquivo cobre especificamente a camada de backend real.

---

## 1. Status

| Área | Status |
| --- | --- |
| Schema SQL (migrations 0001–0004) | ✅ Escrito **e aplicado** no projeto Supabase real |
| Hardening de segurança (migration 0005) | ✅ Escrito e aplicado — ver seção 8 |
| RLS por tabela | ✅ Aplicado — 22 políticas ativas, confirmadas via advisor |
| Triggers de auditoria | ✅ Aplicado, dispara no banco (não depende do front) |
| Camada de services (`src/services/*`) | ✅ Completa |
| AuthProvider + guards de rota | ✅ Completo |
| Login / recuperação de senha / `/projects` | ✅ Completo |
| Rotas `/project/:projectId/*` | ✅ Migrado |
| Área admin real (`/agency`, `/admin/*`) | ✅ Completa |
| Cenário de teste (Lucas ADMIN) | ✅ Semeado — Maria/João **pendentes**, ver seção 6 |
| Meta Marketing API, webhooks de leads/vendas | ❌ Fora de escopo desta fase (Fase 2) |
| **Testado ponta a ponta com banco real** | ⚠️ **Parcial** — ver seção 6 |

Projeto Supabase real: `project_ref: ibtdjnbefsltgguoopih`. As migrations 0001–0005 já
foram aplicadas diretamente nele via MCP. `npx supabase db pull` (ou o histórico de
migrations do painel) deve refletir esse mesmo conjunto.

---

## 2. O que muda na estrutura do projeto

```
supabase/
└── migrations/
    ├── 0001_init_schema.sql        tabelas, índices, constraints
    ├── 0002_functions_triggers.sql helpers de autorização, auditoria, updated_at
    ├── 0003_rls_policies.sql       Row Level Security de cada tabela
    └── 0004_seed_test_scenario.sql cenário obrigatório de teste (idempotente)

src/
├── integrations/supabase/
│   ├── client.ts              cliente supabase-js (só a anon key)
│   └── database.types.ts      tipos das tabelas (mesmo formato do gerador oficial)
├── services/                  única camada que fala com o Supabase
│   ├── auth.service.ts
│   ├── clients.service.ts
│   ├── projects.service.ts
│   ├── users.service.ts
│   ├── goals.service.ts
│   └── audit.service.ts
├── providers/AuthProvider.tsx sessão, profile, "ver como cliente"
├── hooks/
│   ├── useProjectAccess.ts    projeto + permissões efetivas da rota
│   └── useProjectPath.ts      monta links /project/:id/... sem hardcode
├── routes/guards.tsx          ProtectedRoute, AdminRoute, ProjectRoute
├── state/ProjectContext.tsx   projeto/metas/permissões reais da rota atual
└── pages/
    ├── auth/                  LoginPage, ResetPasswordPage, SupabaseSetupNotice
    ├── ProjectsPage.tsx       "Seus projetos" (entrada do CLIENT)
    └── admin/                 AgencyHomePage, ClientsListPage, ClientDetailPage,
                                AdminProjectsPage, AdminUsersPage, AuditLogPage,
                                NewProjectWizard, UserAccessModal
```

---

## 3. Decisões de implementação

### 3.1 SECURITY DEFINER para quebrar recursão de RLS

As políticas de `profiles` precisam saber o papel do próprio usuário — mas uma policy que
consulta `profiles` dentro de uma policy de `profiles` gera recursão infinita. Solução:
funções `is_admin()`, `has_client_access()`, `has_project_permission()` etc. são
`SECURITY DEFINER` (rodam ignorando RLS) e ficam com `search_path` fixo para não sofrer
sequestro de resolução de nomes. As policies chamam essas funções em vez de fazer
subquery direta.

### 3.2 Auditoria por trigger, não pelo front-end

`fn_audit_changes()` roda em `AFTER INSERT/UPDATE/DELETE` sobre `clients`, `projects`,
`project_goals`, `project_settings`, `project_users`, `client_users` e `profiles`. Ela usa
`to_jsonb(old/new)` e grava **uma linha por campo alterado** em UPDATE — assim uma
alteração de `lead_goal` fica registrada como valor anterior → valor novo, sem depender de
o front-end lembrar de chamar um log manualmente. Isso também cobre alterações feitas
direto pela API/SQL, como pedido na especificação (seção 46).

### 3.3 Metas como histórico, nunca sobrescrita

`project_goals` tem `unique(project_id, period_start, period_end)`. Trocar a meta de um
período existente é um `UPDATE` (o trigger de auditoria grava o diff); criar metas para um
novo período é um `INSERT` novo. Nenhuma meta antiga é apagada.

### 3.4 Convite de usuário sem service_role key

A spec sugere `auth.admin.inviteUserByEmail`, que exige a `service_role` key — proibida no
front-end. `inviteUser()` usa `supabase.auth.signUp` com senha temporária aleatória; a
pessoa define a senha dela mesma ao clicar no link de confirmação (que cai em
`/redefinir-senha`). Funciona sem backend próprio, mas é um desvio conhecido: **o ideal em
produção é mover isso para uma Edge Function** que use a service_role key do lado do
servidor. Documentado como pendência.

### 3.5 "Ver como cliente" continua sendo só visual

`AuthProvider` guarda `previewClientId`, mas ele não é usado por nenhuma política de RLS —
a spec (seção 32) é explícita que isso deve ser modo de visualização, não mecanismo de
segurança. Quem decide o que o banco retorna é sempre `auth.uid()` mais as tabelas de
vínculo.

### 3.6 Ponte com os dados mockados (`bindDemoDataset`)

A especificação pede explicitamente (seção 47–48) para **não** trocar campanhas/leads/
vendas nesta fase — só cliente, projeto, usuários e metas viram reais. Como o dashboard
existente (`Dashboard`, `CampaignsPage`, `ComercialPage` etc.) foi construído em cima de um
dataset mockado fixo (`src/data/mockData.ts`), criei uma ponte: `FiltersContext.
bindDemoDataset(realProjectId, goals)` faz um hash estável do UUID do projeto real e
escolhe sempre o mesmo projeto mockado para "emprestar" os dados de campanha. As metas
reais (`lead_goal`, `cpl_goal`) sobrescrevem as do mock, então a meta que você define na
Fase 1 já aparece nos gauges do dashboard.

Isso é uma solda temporária. Quando a Fase 2 (Meta API) entrar, essa função e o dataset
mockado saem, e os componentes passam a ler direto das tabelas de campanha/lead/venda
reais — sem precisar reescrever os componentes visuais.

---

## 4. Como aplicar (passo a passo)

1. **Rodar as migrations** — SQL Editor do Supabase, nesta ordem exata:
   `0001_init_schema.sql` → `0002_functions_triggers.sql` → `0003_rls_policies.sql` →
   `0004_seed_test_scenario.sql`.

   > O arquivo 0004 **falha de propósito** se os usuários de teste ainda não existirem —
   > leia o comentário no topo dele antes de rodar.

2. **Criar os 3 usuários de teste** em Authentication → Users (marcar *Auto Confirm User*):
   - `lucas@agencia.com` → vira ADMIN
   - `maria@horizonte.com` → CLIENT
   - `joao@horizonte.com` → CLIENT

3. **Rodar o `.env`**:
   ```bash
   cp .env.example .env
   ```
   Preencher `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Project Settings → API).

4. `npm run dev` e testar o login com os 3 usuários.

---

## 5. Cenário de teste já semeado

| | Pós IA | Pós Engenharia de Dados | MBA Direito |
| --- | --- | --- | --- |
| **Maria** | ✅ (edita metas/config) | ✅ (só visualiza) | ❌ |
| **João** | ❌ | ✅ (edita metas) | ✅ (edita metas, exporta) |
| **Lucas (ADMIN)** | ✅ | ✅ | ✅ |

Isso cobre exatamente a matriz da seção 51 da especificação, incluindo a variação de
permissão *dentro* do mesmo cliente (Maria pode editar metas da Pós IA mas não da Pós
Dados).

---

## 6. O que ainda falta validar

Com o MCP do Supabase autenticado e write-capable, já apliquei o schema completo
(0001–0005) no projeto real (`ibtdjnbefsltgguoopih`) e confirmei via consulta direta:

- ✅ 9 tabelas criadas, RLS habilitada em todas (`list_tables`).
- ✅ Organização "Leads Hub", cliente "Faculdade Horizonte" e os 3 projetos
  (`pos-ia`, `pos-dados`, `mba-direito`) semeados, com metas do mês atual.
- ✅ `lucas@agencia.com` existe em `auth.users`, confirmado, com profile ADMIN.
- ✅ Advisors de segurança do Supabase: **zero** achados de função/RLS depois da
  migration 0005 (ver seção 8). Só resta 1 aviso, que é um toggle do painel Auth, não SQL.

Ainda **não dá para considerar validado ponta a ponta**, porque falta:

- **Maria e João não existem em `auth.users`** — a seção 5 desta tabela de permissões
  está semeada só na metade (o vínculo `client_users`/`project_users` deles não foi
  criado, porque o script de seed só roda a parte de um usuário se ele já existir). Você
  precisa criá-los em Authentication → Users no painel (marcando *Auto Confirm User*)
  antes de eu conseguir terminar o vínculo.
- Login real pelo navegador (login/logout/redirect por papel) — as tabelas/policies
  estão corretas e a UI está implementada, mas eu não tenho como logar como um usuário
  específico via MCP (as ferramentas de banco rodam com privilégio elevado, não como
  uma sessão de usuário real) — esse teste só rola com o app rodando + login de verdade.
- Tentar burlar o acesso trocando o `projectId` na URL como Maria/João, uma vez que
  existam.
- Fluxo de convite → e-mail de confirmação → ativação via `handle_user_confirmed`.

---

## 7. Débitos técnicos conhecidos

- **Convite de usuário via `signUp`** (seção 3.4) — migrar para Edge Function quando houver
  backend próprio para isso.
- **`bindDemoDataset`** (seção 3.6) — solda temporária que precisa sair na Fase 2.
- **Bundle sem code-splitting** — já um débito anterior à Fase 1, cresceu para ~285 KB
  gzip com a adição do supabase-js. Vale revisitar com `React.lazy` por rota.
- **Sem testes automatizados** de RLS — a especificação não pediu, mas seria o próximo
  passo natural antes de produção (ex: `pgTAP` ou testes de integração com um usuário de
  cada papel).
- **"Leaked Password Protection" desligado** — aviso do Auth advisor; é um toggle em
  Authentication → Policies no painel do Supabase, não dá para ligar via SQL/migration.

---

## 8. Migration 0005 — hardening de segurança

Depois de aplicar 0001–0004, rodei `get_advisors` e encontrei os seguintes achados, todos
corrigidos pela migration `0005_harden_security.sql`:

- **`function_search_path_mutable`** em `fn_set_updated_at()` — a função não fixava
  `search_path`, o que a deixa vulnerável a sequestro de resolução de nomes se alguém
  conseguir criar um objeto com o mesmo nome num schema anterior na busca. Corrigido
  adicionando `set search_path = public`.
- **`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable`**
  em `is_admin`, `has_client_access`, `has_project_permission`,
  `current_profile_role(_raw)`, `current_profile_status_raw`, `current_organization_id`
  — essas funções são `SECURITY DEFINER` (rodam ignorando RLS, ver seção 3.1) e moravam
  em `public`, então o PostgREST as expunha como endpoints RPC públicos
  (`/rest/v1/rpc/is_admin` etc.), chamáveis por qualquer usuário autenticado. Elas só
  deveriam ser usadas *internamente* pelas políticas de RLS. Corrigido movendo todas
  para um schema novo, `private`, que o PostgREST nunca expõe — RLS continua
  funcionando normalmente (a avaliação de policy é interna ao Postgres, não depende de
  exposição via API), mas ninguém consegue mais chamá-las direto pela API REST.
- O mesmo aviso apareceu nas funções de trigger (`fn_audit_changes`,
  `fn_create_default_project_settings`, `handle_new_user`, `handle_user_confirmed`).
  Essas continuam em `public` (precisam, porque disparam sobre tabelas de
  `public`/`auth`), mas revoguei o `EXECUTE` de `anon`/`authenticated` — disparo de
  trigger não depende desse privilégio, só chamada direta via RPC depende.

Resultado confirmado via `get_advisors` depois da correção: **0 achados de função/RLS**;
só resta o aviso de "Leaked Password Protection Disabled", que é configuração do painel
Auth (seção 7).
