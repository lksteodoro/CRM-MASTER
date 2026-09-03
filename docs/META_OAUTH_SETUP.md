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

## 6. Proxy da Graph API (obrigatório para publicar)

O criador de anúncios não fala direto com a Meta: toda chamada passa pela Edge
Function `meta-proxy`, que lê o token da conexão OAuth no servidor. Sem essa
função publicada, o criador abre em modo demonstração.

1. Aplique a migration `0041_meta_ads_compliance.sql` (cria o bucket
   `meta-ad-media`, as declarações obrigatórias e as funções que dão acesso ao
   segredo pelo servidor).
2. Publique as Edge Functions `meta-proxy` e `meta-deauthorize`.
3. Garanta que `META_APP_SECRET` e `META_APP_ID` estão nos segredos das duas
   funções — o `appsecret_proof` e a validação do `signed_request` dependem
   deles.

O vídeo de anúncio é enviado ao bucket privado `meta-ad-media` e a Meta o baixa
por URL assinada de uma hora. O arquivo é apagado logo depois.

## 7. Callbacks exigidos pela Meta

Em **Configurações › Básico** do aplicativo, preencha:

```text
Deauthorize Callback URL:      https://SEU_PROJECT_REF.supabase.co/functions/v1/meta-deauthorize
Data Deletion Request URL:     https://SEU_PROJECT_REF.supabase.co/functions/v1/meta-deauthorize/delete
```

Quando alguém remove o app na Meta, a conexão é marcada como revogada e o token
apagado automaticamente. Sem esses dois endereços a App Review é reprovada.

## 8. O que o operador precisa declarar em cada publicação

Duas informações não podem ser presumidas pelo sistema, e a publicação fica
bloqueada até que sejam preenchidas:

- **Categoria especial** (crédito, emprego, moradia, finanças, política,
  apostas ou nenhuma). Declarar errado restringe a conta de anúncios.
- **Anunciante pagador**, exigido pela Meta no Brasil. Quando o valor é apenas
  sugerido pelo sistema, o operador precisa confirmar antes de publicar.

## 9. Redirecionador e tráfego pago

Links do redirecionador interno (`/r/slug`) não podem ser usados como destino de
anúncio, porque podem alternar destinos e ser editados depois da aprovação — a
Meta trata isso como cloaking. O criador bloqueia esses links no campo de
destino. Se for realmente necessário usar um, marque a opção **"Este link será
usado como destino de anúncio pago"** ao criá-lo: o link passa a aceitar um
único destino, que não pode mais ser alterado.

## 10. Duas formas de conectar a agência

Ambas guardam a credencial no cofre do servidor e são aceitas pela Meta. A
escolha é operacional, não de conformidade.

| | Login da Meta (OAuth) | Token geral (usuário de sistema) |
|---|---|---|
| Como conecta | Botão "Conectar com Meta" | Token colado uma vez, validado na hora |
| Validade | Expira e pede reconexão | Não expira |
| Depende de | A pessoa que autorizou continuar com acesso | Nada além do usuário de sistema existir |
| Onde fica | `private.meta_oauth_secrets` | `private.meta_oauth_secrets` |

### Gerando o token geral

1. `business.facebook.com` › Configurações do Negócio › **Usuários do sistema**.
2. Crie um usuário de sistema administrador e dê a ele acesso à conta de
   anúncios e às páginas que serão usadas.
3. **Gerar novo token** › selecione **o aplicativo desta agência**.
4. Marque `ads_management`, `ads_read`, `pages_show_list` e
   `business_management`.
5. Cole em Configurações › APIs › Meta Ads › aba **Token geral**.

O sistema chama `debug_token` antes de aceitar e recusa o token se:

- ele tiver sido emitido para **outro aplicativo** — o caso mais comum é o token
  do Graph API Explorer. Token de outro app pertence a esse app, e usá-lo aqui é
  uso de credencial de terceiro, proibido pelas Platform Terms;
- estiver expirado ou revogado;
- faltar a permissão `ads_management`.

Colar token não é o problema — o problema seria guardá-lo no navegador ou pegá-lo
emprestado de outro aplicativo. Nenhuma das duas coisas acontece aqui.

### O que a aba "Token por projeto" faz

Nada relacionado a publicar. Ela alimenta a leitura de métricas de um projeto
específico (`meta_integrations`). Se só ela estiver configurada, o criador de
anúncios continua em modo demonstração — é preciso conectar a agência por uma
das duas formas acima.

## 11. Operando só com o token, sem App ID e App Secret

O App Secret deixa de ser obrigatório para conectar. A aba **Token geral**
funciona sozinha; o que muda é o quanto o servidor consegue confirmar sobre a
credencial. A validação tenta três caminhos, nesta ordem:

| Nível | Como valida | O que confirma |
|---|---|---|
| `app_secret` | `debug_token` com o app token | Token válido, permissões **e** que ele pertence a este aplicativo |
| `self` | `debug_token` com o próprio token | Token válido, permissões e o app de origem informado por ele mesmo |
| `permissions` | `GET /me/permissions` | Só que o token funciona e quais permissões tem |

Nos dois primeiros níveis, um token emitido por outro aplicativo é recusado. No
terceiro isso não é possível: a conexão é aceita, a tela mostra o aviso e a
própria linha da conexão guarda o registro de que a origem não foi verificada.

Em todos os níveis o token continua exigindo `ads_management` e continua
guardado só no servidor.

**Recomendação:** cadastrar `META_APP_ID` e `META_APP_SECRET` assim que possível.
Além de garantir a checagem de origem, é o que habilita o `appsecret_proof` (a
Meta pode exigi-lo se "Require App Secret" estiver ativo no app) e o login por
OAuth.
