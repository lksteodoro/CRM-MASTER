import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function providerError(payload: Record<string, unknown>, status: number) {
  const requestError = payload.requestError as { serviceException?: { text?: string } } | undefined;
  return requestError?.serviceException?.text ?? (typeof payload.message === 'string' ? payload.message : `Infobip HTTP ${status}`);
}

function normalizedCategory(value: unknown) {
  const category = String(value ?? '').toUpperCase();
  return ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category) ? category : null;
}

async function credentialKey(serviceKey: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`infobip:${serviceKey}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptCredential(value: string, serviceKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await credentialKey(serviceKey), new TextEncoder().encode(value)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...encrypted))}`;
}

async function decryptCredential(value: string, serviceKey: string) {
  const [ivPart, encryptedPart] = value.split('.');
  const iv = Uint8Array.from(atob(ivPart), (char) => char.charCodeAt(0));
  const encrypted = Uint8Array.from(atob(encryptedPart), (char) => char.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await credentialKey(serviceKey), encrypted);
  return new TextDecoder().decode(decrypted);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'missing_authorization' }, 401);
  const body = await req.json().catch(() => ({}));
  const requestedAction = String(body.action ?? 'submit');
  const action = ['sync_status', 'sync_senders', 'list_approved_templates', 'list_people_tags', 'config_get', 'config_save', 'config_test'].includes(requestedAction) ? requestedAction : 'submit';
  const requestedIds = Array.isArray(body.submissionIds) ? body.submissionIds.filter((id: unknown) => typeof id === 'string') : [];
  if (requestedIds.length > 50 || (action === 'submit' && requestedIds.length < 1)) return json({ error: 'invalid_submission_ids' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const credentialSecret = Deno.env.get('INFOBIP_CREDENTIALS_KEY') ?? serviceKey;
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: authData } = await caller.auth.getUser();
  if (!authData.user) return json({ error: 'not_authenticated' }, 401);
  const { data: profile } = await caller.from('profiles').select('role, organization_id').eq('id', authData.user.id).maybeSingle();
  if (profile?.role !== 'ADMIN' || !profile.organization_id) return json({ error: 'forbidden' }, 403);

  if (action === 'config_save') {
    const baseUrlInput = String(body.baseUrl ?? '').trim().replace(/\/$/, '');
    const apiKeyInput = String(body.apiKey ?? '').trim().replace(/^App\s+/i, '');
    try { if (new URL(baseUrlInput).protocol !== 'https:') throw new Error(); } catch { return json({ error: 'base_url_invalid' }, 400); }
    if (apiKeyInput.length < 16) return json({ error: 'api_key_invalid' }, 400);
    const apiKeyCiphertext = await encryptCredential(apiKeyInput, credentialSecret);
    const { error } = await admin.from('infobip_api_settings').upsert({ organization_id: profile.organization_id, base_url: baseUrlInput, api_key_ciphertext: apiKeyCiphertext, api_key_hint: apiKeyInput.slice(-4), updated_by: authData.user.id }, { onConflict: 'organization_id' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, configured: true, baseUrl: baseUrlInput, keyHint: apiKeyInput.slice(-4) });
  }

  const { data: savedConfig } = await admin.from('infobip_api_settings').select('base_url, api_key_ciphertext, api_key_hint, updated_at').eq('organization_id', profile.organization_id).maybeSingle();
  let baseUrl = (savedConfig?.base_url ?? Deno.env.get('INFOBIP_BASE_URL') ?? '').replace(/\/$/, '');
  let apiKey = Deno.env.get('INFOBIP_API_KEY') ?? '';
  if (savedConfig?.api_key_ciphertext) apiKey = await decryptCredential(savedConfig.api_key_ciphertext, credentialSecret);
  if (action === 'config_get') return json({ ok: true, configured: Boolean(baseUrl && apiKey), baseUrl, keyHint: savedConfig?.api_key_hint ?? (apiKey ? apiKey.slice(-4) : ''), updatedAt: savedConfig?.updated_at ?? null });
  if (!baseUrl || !apiKey) return json({ error: 'infobip_not_configured' }, 503);
  if (action === 'config_test') {
    const response = await fetch(`${baseUrl}/whatsapp/1/templates?limit=1`, { headers: { Authorization: `App ${apiKey}`, Accept: 'application/json' } });
    const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) return json({ error: providerError(provider, response.status) }, response.status);
    return json({ ok: true, connected: true });
  }

  if (action === 'list_approved_templates') {
    const sender = String(body.sender ?? '').replace(/\D/g, '');
    if (sender.length < 10) return json({ error: 'sender_invalid' }, 400);
    const response = await fetch(`${baseUrl}/whatsapp/2/senders/${encodeURIComponent(sender)}/templates`, { headers: { Authorization: `App ${apiKey}`, Accept: 'application/json' } });
    const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) return json({ error: providerError(provider, response.status) }, response.status);
    const candidates = (Array.isArray(provider) ? provider : provider.templates ?? provider.results ?? provider.items ?? []) as Array<Record<string, unknown>>;
    const templates = candidates.filter((template) => String(template.status ?? '').toUpperCase() === 'APPROVED').map((template) => ({ id: String(template.id ?? template.templateId ?? template.name ?? ''), name: String(template.name ?? template.templateName ?? ''), language: String(template.language ?? 'pt_BR'), category: String(template.category ?? ''), status: 'APPROVED' })).filter((template) => template.id && template.name);
    return json({ ok: true, sender, templates });
  }

  if (action === 'list_people_tags') {
    // People tags are the existing audience groups in Infobip. We retain only
    // their identifiers/counts in our draft; contact records stay in Infobip.
    const response = await fetch(`${baseUrl}/people/2/tags?limit=1000`, { headers: { Authorization: `App ${apiKey}`, Accept: 'application/json' } });
    const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) return json({ error: providerError(provider, response.status) }, response.status);
    const candidates = (Array.isArray(provider) ? provider : provider.tags ?? provider.results ?? provider.items ?? []) as Array<Record<string, unknown>>;
    const tags = candidates.map((tag) => {
      const rawCount = tag.persons ?? tag.peopleCount ?? tag.personCount ?? tag.count ?? null;
      const parsedCount = typeof rawCount === 'number' ? rawCount : Number(rawCount);
      return { id: String(tag.id ?? tag.tagId ?? ''), name: String(tag.name ?? tag.tagName ?? ''), peopleCount: Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : null };
    }).filter((tag) => tag.id && tag.name).sort((a, b) => a.name.localeCompare(b.name));
    return json({ ok: true, tags });
  }

  if (action === 'sync_senders') {
    const response = await fetch(`${baseUrl}/whatsapp/1/templates?limit=1000`, { headers: { Authorization: `App ${apiKey}`, Accept: 'application/json' } });
    const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) return json({ error: providerError(provider, response.status) }, response.status);
    const candidates = (Array.isArray(provider) ? provider : provider.templates ?? provider.results ?? provider.items ?? []) as Array<Record<string, unknown>>;
    const unique = new Map<string, Record<string, unknown>>();
    for (const template of candidates) {
      const senderValue = typeof template.sender === 'object' && template.sender ? (template.sender as Record<string, unknown>).sender ?? (template.sender as Record<string, unknown>).phoneNumber : template.sender ?? template.phoneNumber;
      const sender = String(senderValue ?? '').replace(/\D/g, '');
      if (!sender) continue;
      const wabaId = template.wabaId ?? template.waba_id ?? template.businessAccountId ?? template.businessAccountID ?? null;
      unique.set(sender, { sender, label: `Infobip +${sender}`, waba_id: wabaId, waba_label: wabaId ? `WABA ${wabaId}` : 'WABA Infobip' });
    }
    return json({ ok: true, senders: Array.from(unique.values()) });
  }
  let allowedQuery = caller.from('infobip_template_submissions').select('id').order('requested_at', { ascending: false }).limit(50);
  if (requestedIds.length) allowedQuery = allowedQuery.in('id', requestedIds);
  const { data: allowed, error } = await allowedQuery;
  if (error || !allowed || (requestedIds.length && allowed.length !== requestedIds.length)) return json({ error: 'not_found_or_forbidden' }, 403);

  const ids = requestedIds.length ? requestedIds : allowed.map((row) => row.id);
  const { data: submissions } = await admin.from('infobip_template_submissions').select('*, infobip_template_models(*)').in('id', ids);
  const results: Array<Record<string, unknown>> = [];

  for (const submission of submissions ?? []) {
    const model = submission.infobip_template_models;
    if (action === 'submit') {
      await admin.from('infobip_template_submissions').update({ status: 'SENDING', error_message: null }).eq('id', submission.id);
      const structure: Record<string, unknown> = { type: model.header_type === 'NONE' ? 'TEXT' : 'MEDIA', body: { text: model.body_text, examples: model.variable_examples } };
      if (model.header_type !== 'NONE') structure.header = { format: model.header_type, example: model.header_media_url };
      if (model.footer_text) structure.footer = { text: model.footer_text };
      if (submission.destination_url) structure.buttons = [{ type: 'URL', text: model.button_text || 'SAIBA MAIS', url: submission.destination_url }];
      // Impede que a Meta converta silenciosamente UTILITY em MARKETING.
      // Se o conteúdo não cumprir a categoria solicitada, a revisão deve rejeitar
      // e a tela mostrará o motivo/status real para correção.
      const payload = { name: submission.resolved_name, language: model.language, category: model.category, allowCategoryChange: false, structure };
      try {
        const response = await fetch(`${baseUrl}/whatsapp/2/senders/${encodeURIComponent(submission.sender)}/templates`, { method: 'POST', headers: { Authorization: `App ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
        const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) throw new Error(providerError(provider, response.status));
        const providerCategory = normalizedCategory(provider.category) ?? model.category;
        await admin.from('infobip_template_submissions').update({ status: 'SENT', provider_template_id: provider.id ?? null, provider_status: provider.status ?? 'PENDING', requested_category: model.category, provider_category: providerCategory, category_changed: providerCategory !== model.category, provider_response: provider, status_checked_at: new Date().toISOString(), sent_at: new Date().toISOString() }).eq('id', submission.id);
        results.push({ id: submission.id, status: 'SENT', providerStatus: provider.status ?? 'PENDING' });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Falha ao enviar para a Infobip.';
        await admin.from('infobip_template_submissions').update({ status: 'FAILED', error_message: message }).eq('id', submission.id);
        results.push({ id: submission.id, status: 'FAILED', error: message });
      }
      continue;
    }

    if (!submission.provider_template_id) {
      results.push({ id: submission.id, status: 'SKIPPED', reason: 'provider_template_id ausente' });
      continue;
    }
    try {
      const response = await fetch(`${baseUrl}/whatsapp/2/senders/${encodeURIComponent(submission.sender)}/templates/${encodeURIComponent(submission.provider_template_id)}`, { headers: { Authorization: `App ${apiKey}`, Accept: 'application/json' } });
      const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(providerError(provider, response.status));
      const providerCategory = normalizedCategory(provider.category) ?? submission.provider_category ?? submission.requested_category;
      const requestedCategory = submission.requested_category ?? model.category;
      await admin.from('infobip_template_submissions').update({ provider_status: provider.status ?? submission.provider_status, requested_category: requestedCategory, provider_category: providerCategory, category_changed: Boolean(providerCategory && requestedCategory && providerCategory !== requestedCategory), provider_response: provider, status_checked_at: new Date().toISOString() }).eq('id', submission.id);
      results.push({ id: submission.id, status: provider.status ?? submission.provider_status, category: providerCategory });
    } catch (caught) {
      results.push({ id: submission.id, status: 'CHECK_FAILED', error: caught instanceof Error ? caught.message : 'Falha ao consultar status.' });
    }
  }
  return json({ ok: true, action, results });
});
