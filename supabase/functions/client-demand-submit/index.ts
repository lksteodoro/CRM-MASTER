import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const bucket = 'client-demand-files';
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

type Mapping = { firstName: number; lastName: number; phone: number };

function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const parsed: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') { if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && source[index + 1] === '\n') index += 1; row.push(cell.trim()); if (row.some(Boolean)) parsed.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) parsed.push(row);
  return { headers: parsed[0] ?? [], rows: parsed.slice(1) };
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) digits = digits.slice(2);
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2)); const local = digits.slice(2);
  if (ddd < 11 || ddd > 99 || !/^[2-9]\d{7,8}$/.test(local)) return null;
  return `55${digits}`;
}

function clean(value: string) { return value.replace(/\s+/g, ' ').trim(); }
function splitName(name: string, last: string) { const full = clean(name); const explicit = clean(last); if (explicit) return [full, explicit]; const [first = '', ...rest] = full.split(' '); return [first, rest.join(' ')]; }
function csvCell(value: string) { const safe = /^[=+\-@]/.test(value) ? `'${value}` : value; return `"${safe.replace(/"/g, '""')}"`; }

function sanitize(rows: string[][], mapping: Mapping) {
  const contacts: Array<{ firstName: string; lastName: string; phone: string }> = [];
  const phones = new Set<string>(); let invalid = 0; let duplicates = 0;
  for (const row of rows) {
    const phone = normalizePhone(mapping.phone >= 0 ? row[mapping.phone] ?? '' : '');
    if (!phone) { invalid += 1; continue; }
    if (phones.has(phone)) { duplicates += 1; continue; }
    phones.add(phone);
    const [firstName, lastName] = splitName(mapping.firstName >= 0 ? row[mapping.firstName] ?? '' : '', mapping.lastName >= 0 ? row[mapping.lastName] ?? '' : '');
    contacts.push({ firstName, lastName, phone });
  }
  const csv = `\uFEFFnome;sobrenome;telefone;tag\r\n${contacts.map((contact) => [contact.firstName, contact.lastName, contact.phone, ''].map(csvCell).join(';')).join('\r\n')}`;
  return { contacts, invalid, duplicates, csv };
}

function pathAllowed(path: unknown, clientId: string, segment: 'incoming' | 'profile') {
  return typeof path === 'string' && new RegExp(`^${clientId}/${segment}/`).test(path);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'missing_authorization' }, 401);
  const body = await req.json().catch(() => ({}));
  const clientId = String(body.clientId ?? '');
  const sourcePath = String(body.sourcePath ?? '');
  const mapping = body.mapping as Mapping;
  if (!new RegExp(`^${uuidPattern}$`, 'i').test(clientId) || !pathAllowed(sourcePath, clientId, 'incoming') || !mapping || !Number.isInteger(mapping.phone) || mapping.phone < 0) return json({ error: 'invalid_request' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, service);
  const { data: userData } = await caller.auth.getUser();
  const user = userData.user;
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const { data: profile } = await caller.from('profiles').select('organization_id, role').eq('id', user.id).maybeSingle();
  const { data: membership } = await caller.from('client_users').select('client_id').eq('client_id', clientId).eq('user_id', user.id).eq('status', 'ACTIVE').maybeSingle();
  const { data: client } = await caller.from('clients').select('id, organization_id').eq('id', clientId).maybeSingle();
  const allowed = profile?.role === 'ADMIN' || Boolean(membership);
  if (!allowed || !client || client.organization_id !== profile?.organization_id) return json({ error: 'forbidden' }, 403);

  let cleanedPath: string | null = null;
  try {
    const profilePhotoPath = pathAllowed(body.profilePhotoPath, clientId, 'profile') ? body.profilePhotoPath : null;
    const profileCoverPath = pathAllowed(body.profileCoverPath, clientId, 'profile') ? body.profileCoverPath : null;
    const title = String(body.title ?? '').trim().slice(0, 160);
    const profileName = String(body.profileName ?? '').trim().slice(0, 160);
    const ddd = String(body.ddd ?? '').replace(/\D/g, '').slice(0, 3);
    const copy = String(body.copyText ?? '').trim().slice(0, 10000);
    const link = String(body.destinationLink ?? '').trim();
    const notes = String(body.notes ?? '').trim().slice(0, 5000);
    if (!title || !profileName || ddd.length < 2 || !copy) return json({ error: 'missing_required_fields' }, 400);
    try { new URL(link); } catch { return json({ error: 'destination_link_invalid' }, 400); }
    const { data: source, error: downloadError } = await admin.storage.from(bucket).download(sourcePath);
    if (downloadError || !source) return json({ error: 'source_file_not_found' }, 400);
    if (source.size > 16 * 1024 * 1024) return json({ error: 'source_file_too_large' }, 400);
    const parsed = parseCsv(await source.text());
    const headersLength = parsed.headers.length;
    if (!headersLength || parsed.rows.length === 0 || [mapping.firstName, mapping.lastName, mapping.phone].some((value) => !Number.isInteger(value) || value < -1 || value >= headersLength)) return json({ error: 'invalid_mapping_or_empty_list' }, 400);
    const result = sanitize(parsed.rows, mapping);
    if (!result.contacts.length) return json({ error: 'no_valid_contacts' }, 400);

    const taskId = crypto.randomUUID();
    cleanedPath = `${clientId}/demands/${taskId}/sanitized.csv`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(cleanedPath, new Blob([result.csv], { type: 'text/csv' }), { contentType: 'text/csv', upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const { data: task, error: insertError } = await admin.from('disparo_tasks').insert({
      id: taskId, organization_id: client.organization_id, created_by: user.id, client_id: clientId, title,
      scheduled_date: typeof body.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate) ? body.scheduledDate : null,
      scheduled_time: typeof body.scheduledTime === 'string' && /^\d{2}:\d{2}$/.test(body.scheduledTime) ? body.scheduledTime : null,
      status: 'pedido', position: 0, request_source: 'client_portal', client_portal_status: 'submitted', client_submitted_at: new Date().toISOString(), client_notes: notes || null,
      profile_name_snapshot: profileName, profile_ddd_snapshot: ddd, profile_photo_path: profilePhotoPath, profile_cover_path: profileCoverPath,
      full_link: link, instagram: String(body.instagram ?? '').trim().slice(0, 300) || null, copy_text: copy,
      source_list_path: cleanedPath, source_list_file_name: String(body.originalListFileName ?? 'lista.csv').slice(0, 255), source_list_mime_type: 'text/csv', contact_list_ref: 'Lista higienizada no portal do cliente',
      list_original_count: parsed.rows.length, list_valid_count: result.contacts.length, list_invalid_count: result.invalid, list_duplicate_count: result.duplicates,
      checklist: { 'pedido.cliente': true, 'pedido.volume': true, 'pedido.data_disparo': Boolean(body.scheduledDate), 'numero_perfil.nome_ddd': true, 'lista.lista_recebida': true, 'lista.duplicados_removidos': true },
    }).select('*').single();
    if (insertError) throw new Error(insertError.message);
    return json({ ok: true, task });
  } catch (cause) {
    if (cleanedPath) await admin.storage.from(bucket).remove([cleanedPath]);
    return json({ error: cause instanceof Error ? cause.message : 'submit_failed' }, 500);
  } finally {
    await admin.storage.from(bucket).remove([sourcePath]);
  }
});
