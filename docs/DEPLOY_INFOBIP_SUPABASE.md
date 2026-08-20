# Publicar integração Infobip no Supabase

Siga a ordem abaixo uma única vez para ativar Templates, Transmissões e o
portal de demandas.

## 1. Aplicar o banco

1. Abra o projeto no [Supabase Dashboard](https://supabase.com/dashboard).
2. No menu lateral, abra **SQL Editor** → **New query**.
3. Abra o arquivo `supabase/UNIFIED_PENDING_DEPLOY.sql` deste projeto.
4. Copie todo o conteúdo, cole no editor e clique em **Run**.
5. Aguarde a mensagem de sucesso.

> Use o SQL unificado somente se as migrations `0032` a `0038` ainda não
> foram executadas separadamente nesse projeto.

## 2. Publicar as Edge Functions

No terminal, dentro da pasta `src` do projeto, execute:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy infobip-templates
npx supabase functions deploy client-demand-submit
```

O `SEU_PROJECT_REF` aparece em **Project Settings** → **General** →
**Reference ID** no painel Supabase.

Alternativamente, crie as duas funções pelo painel em **Edge Functions**,
copiando o conteúdo destes arquivos:

- `supabase/functions/infobip-templates/index.ts`
- `supabase/functions/client-demand-submit/index.ts`

## 3. Configurar segredo de cifragem

No terminal, gere um segredo novo e privado:

```powershell
[guid]::NewGuid().ToString('N')
```

Cadastre o resultado no Supabase:

```powershell
npx supabase secrets set INFOBIP_CREDENTIALS_KEY=COLE_O_SEGREDO_GERADO
```

Nunca coloque esse valor, a service role ou a API Key da Infobip em `.env` com
prefixo `VITE_`.

## 4. Configurar a API Infobip no CRM

1. Entre como administrador.
2. Abra **Disparo** → **Templates** → **Configurar API Infobip**.
3. Use a Base URL com HTTPS, sem barra final. Exemplo:

```text
https://k93n18.api-us.infobip.com
```

4. Cole a API Key da Infobip sem o prefixo `App`.
5. Clique em **Salvar credenciais**.
6. Clique em **Testar conexão**.

Para puxar templates e etiquetas, a API Key deve ter ao menos os escopos:

- `people:read` para buscar etiquetas/audiências do People;
- permissões de WhatsApp compatíveis com consulta/criação de templates;
- `whatsapp:message:send` somente quando o envio real for ativado.

## 5. Confirmar a integração

Após o teste bem-sucedido:

1. Abra **Transmissões**.
2. Informe um sender completo com DDI, por exemplo `5511999999999`.
3. Clique em **Puxar da Infobip**.
4. Selecione um template aprovado e uma etiqueta existente para cada
   apontamento.
5. Salve como rascunho.

Nenhum CSV é enviado nesta tela e nenhum disparo é iniciado automaticamente.

## Diagnóstico rápido

| Mensagem | Causa | Ação |
| --- | --- | --- |
| “A função Infobip ainda não foi publicada” | Edge Function ausente | Execute o passo 2. |
| “Base URL inválida” | URL com `http://` ou formato incorreto | Use `https://...` sem barra final. |
| “Nenhuma etiqueta encontrada” | People vazio ou sem permissão | Confira etiquetas no People e escopo `people:read`. |
| “Nenhum template aprovado” | Sender errado ou templates pendentes | Confirme o número com DDI e o status na Infobip. |
