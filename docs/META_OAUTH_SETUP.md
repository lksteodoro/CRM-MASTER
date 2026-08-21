# Conectar a agência à Meta Ads via OAuth

Este procedimento é feito uma vez por administrador. Funcionários usam a conexão e os perfis liberados pelo CRM; eles não recebem token, App Secret ou acesso às configurações de API.

## 1. Criar o aplicativo da Meta

1. Acesse [Meta for Developers](https://developers.facebook.com/apps/) com a conta administradora da agência.
2. Crie um aplicativo do tipo **Business**.
3. Adicione o produto **Facebook Login for Business** e o caso de uso **Marketing API**.
4. Em **Configurações > Básico**, copie o **App ID** e o **App Secret**. O App Secret nunca deve ser colocado no navegador ou no repositório.

## 2. Configurar o retorno OAuth

Em **Facebook Login for Business > Settings**, habilite Client OAuth Login e Web OAuth Login. Em **Valid OAuth Redirect URIs**, inclua exatamente:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/meta-oauth/callback
```

Para o ambiente publicado, substitua `SEU_PROJECT_REF` pelo projeto Supabase real. O endereço precisa ser HTTPS e corresponder caractere por caractere ao segredo `META_OAUTH_REDIRECT_URI`.

## 3. Configurar segredos da Edge Function

No painel do Supabase, adicione os segredos da função `meta-oauth`:

```text
META_APP_ID=seu_app_id
META_APP_SECRET=seu_app_secret
META_OAUTH_REDIRECT_URI=https://SEU_PROJECT_REF.supabase.co/functions/v1/meta-oauth/callback
APP_URL=https://seu-dominio.com
```

`APP_URL` é a URL pública do CRM para onde o usuário volta depois de autorizar a Meta. Para desenvolvimento local, use a URL do túnel HTTPS configurado na Meta; `localhost` não deve ser usado como retorno de produção.

## 4. Permissões e revisão

O login solicita `ads_read`, `ads_management`, `business_management`, `pages_show_list` e `pages_read_engagement`.

- Enquanto o app estiver em desenvolvimento, apenas administradores, desenvolvedores e testadores do app Meta conseguem conectar.
- Para clientes externos, solicite **Advanced Access/App Review** para as permissões usadas e conclua a verificação empresarial se a Meta pedir.
- A pessoa que conecta precisa ter acesso à BM, conta de anúncios e páginas que serão usadas.

## 5. Publicar a função e aplicar o banco

1. Aplique as migrations, incluindo `0040_meta_oauth_agency_connection.sql`.
2. Publique a Edge Function `meta-oauth`.
3. No CRM, entre como administrador em **Configurações > APIs > Meta Ads** e clique em **Conectar com Meta**.
4. Autorize a agência na janela da Meta. O CRM retorna à tela de APIs e mostra a conexão ativa.

## Segurança operacional

- O access token é gravado somente em `private.meta_oauth_secrets`; não existe policy de leitura pelo navegador.
- Apenas administradores iniciam ou reconectam OAuth e liberam ferramentas/perfis.
- Para revogar o acesso, remova a integração no painel da Meta e marque a conexão como revogada no CRM quando a rotina de validação detectar a falha.
