import { supabase } from "../integrations/supabase/client";
import type {
  InfobipSenderRow,
  InfobipTemplateModelRow,
  InfobipTemplateSubmissionRow,
} from "../integrations/supabase/database.types";

export type TemplateInput = Pick<
  InfobipTemplateModelRow,
  | "client_id"
  | "display_name"
  | "name_pattern"
  | "language"
  | "category"
  | "body_text"
  | "variable_examples"
  | "header_type"
  | "header_media_url"
  | "footer_text"
  | "button_text"
  | "button_url"
>;
export type SenderInput = Pick<
  InfobipSenderRow,
  "label" | "sender" | "waba_id" | "waba_label"
> & { client_id?: string | null };
export type TemplateBatchTarget = {
  sender: InfobipSenderRow;
  resolved_name?: string;
  destination_url?: string | null;
};
export type InfobipApiConfig = {
  configured: boolean;
  baseUrl: string;
  keyHint: string;
  updatedAt?: string | null;
};
export type ApprovedInfobipTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "APPROVED";
};
export type InfobipPeopleTag = {
  id: string;
  name: string;
  peopleCount: number | null;
};
export type BroadcastDraftInput = {
  name: string;
  sender: string;
  items: Array<{ tag: InfobipPeopleTag; template: ApprovedInfobipTemplate }>;
};

async function infobipFunctionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /failed to send a request to the edge function|functionsfetcherror|404/i.test(
      message,
    )
  ) {
    return new Error(
      "A função Infobip ainda não foi publicada no Supabase. Publique a Edge Function “infobip-templates” e tente novamente.",
    );
  }
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body.error === "string" && body.error) {
        const known: Record<string, string> = {
          infobip_not_configured:
            "As credenciais da Infobip ainda não foram salvas para esta organização.",
          not_authenticated:
            "Sua sessão expirou. Entre novamente e tente enviar.",
          forbidden:
            "Somente administradores podem enviar templates para a Infobip.",
          sender_invalid: "O sender precisa ter DDI, DDD e número completos.",
          invalid_submission_ids:
            "Não foi possível preparar os templates para o envio. Atualize a página e tente novamente.",
        };
        return new Error(known[body.error] || body.error);
      }
    } catch {
      // resposta de erro não era JSON; mantém a mensagem genérica abaixo.
    }
  }
  return error instanceof Error
    ? error
    : new Error("Não foi possível comunicar com a integração Infobip.");
}

async function invokeInfobip<T>(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke<T>(
    "infobip-templates",
    { body },
  );
  if (error) throw await infobipFunctionError(error);
  return data;
}

export async function getInfobipApiConfig() {
  return invokeInfobip<InfobipApiConfig>({ action: "config_get" });
}
export async function saveInfobipApiConfig(baseUrl: string, apiKey: string) {
  return invokeInfobip<InfobipApiConfig>({
    action: "config_save",
    baseUrl,
    apiKey,
  });
}
export async function testInfobipApiConfig() {
  return invokeInfobip<{ connected: boolean }>({ action: "config_test" });
}
export type SchedulingProbe = {
  path: string;
  status?: number;
  body?: string;
  error?: string;
};
export async function diagnoseInfobipScheduling() {
  const data = await invokeInfobip<{ results: SchedulingProbe[] }>({
    action: "diagnose_scheduling",
  });
  return data?.results ?? [];
}
export async function listApprovedInfobipTemplates(rawSender: string) {
  const sender = rawSender.replace(/\D/g, "");
  if (sender.length < 10) throw new Error("Informe o sender completo com DDI.");
  const data = await invokeInfobip<{ templates: ApprovedInfobipTemplate[] }>({
    action: "list_approved_templates",
    sender,
  });
  return data?.templates ?? [];
}
export async function listInfobipPeopleTags() {
  const data = await invokeInfobip<{ tags: InfobipPeopleTag[] }>({
    action: "list_people_tags",
  });
  return data?.tags ?? [];
}
export async function createBroadcastDraft(input: BroadcastDraftInput) {
  const sender = input.sender.replace(/\D/g, "");
  if (!input.name.trim() || sender.length < 10 || !input.items.length)
    throw new Error(
      "Preencha nome, sender e pelo menos um apontamento de template e etiqueta.",
    );
  if (
    input.items.some(
      (item) => !item.tag.id || !item.tag.name || !item.template.id,
    )
  )
    throw new Error(
      "Selecione a etiqueta da Infobip e o template para cada item.",
    );
  const totalLeads = input.items.reduce(
    (sum, item) => sum + (item.tag.peopleCount ?? 0),
    0,
  );
  const { data: draft, error: draftError } = await supabase
    .from("infobip_broadcast_drafts")
    .insert({ name: input.name.trim(), sender, total_leads: totalLeads })
    .select()
    .single();
  if (draftError) throw draftError;
  try {
    const items = [] as Array<{
      label: string;
      file_name: string | null;
      file_url: string | null;
      lead_count: number | null;
      infobip_tag_id: string;
      infobip_tag_name: string;
      infobip_tag_people_count: number | null;
      template_id: string;
      template_name: string;
      template_language: string;
      position: number;
      draft_id: string;
    }>;
    for (let index = 0; index < input.items.length; index += 1) {
      const item = input.items[index];
      items.push({
        draft_id: draft.id,
        label: item.tag.name,
        file_name: null,
        file_url: null,
        lead_count: null,
        infobip_tag_id: item.tag.id,
        infobip_tag_name: item.tag.name,
        infobip_tag_people_count: item.tag.peopleCount,
        template_id: item.template.id,
        template_name: item.template.name,
        template_language: item.template.language,
        position: index,
      });
    }
    const { error } = await supabase
      .from("infobip_broadcast_items")
      .insert(items);
    if (error) throw error;
    return draft;
  } catch (caught) {
    await supabase.from("infobip_broadcast_drafts").delete().eq("id", draft.id);
    throw caught;
  }
}
export async function listBroadcastDrafts() {
  const { data: drafts, error } = await supabase
    .from("infobip_broadcast_drafts")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const ids = (drafts ?? []).map((draft) => draft.id);
  const { data: items, error: itemError } = ids.length
    ? await supabase
        .from("infobip_broadcast_items")
        .select("*")
        .in("draft_id", ids)
        .order("position")
    : { data: [], error: null };
  if (itemError) throw itemError;
  return (drafts ?? []).map((draft) => ({
    ...draft,
    items: (items ?? []).filter((item) => item.draft_id === draft.id),
  }));
}

export async function listTemplateModels() {
  const { data, error } = await supabase
    .from("infobip_template_models")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function saveTemplateModel(input: TemplateInput, id?: string) {
  const query = id
    ? supabase.from("infobip_template_models").update(input).eq("id", id)
    : supabase.from("infobip_template_models").insert(input);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}
export async function deleteTemplateModel(id: string) {
  const { error } = await supabase
    .from("infobip_template_models")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
export async function listInfobipSenders() {
  const { data, error } = await supabase
    .from("infobip_senders")
    .select("*")
    .eq("active", true)
    .order("label");
  if (error) throw error;
  return data ?? [];
}
export async function createInfobipSender(input: SenderInput) {
  const sender = input.sender.replace(/\D/g, "");
  const { data, error } = await supabase
    .from("infobip_senders")
    .insert({ ...input, sender })
    .select()
    .single();
  if (error) throw error;
  return data;
}
export async function getOrCreateInfobipSender(rawNumber: string) {
  const sender = rawNumber.replace(/\D/g, "");
  if (sender.length < 10)
    throw new Error("Informe o telefone completo com DDI.");
  const { data: existing, error: findError } = await supabase
    .from("infobip_senders")
    .select("*")
    .eq("sender", sender)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  try {
    return await createInfobipSender({
      client_id: null,
      sender,
      label: `Direto +${sender}`,
      waba_id: null,
      waba_label: "Envio direto",
    });
  } catch (caught) {
    const { data: concurrent, error } = await supabase
      .from("infobip_senders")
      .select("*")
      .eq("sender", sender)
      .maybeSingle();
    if (error || !concurrent) throw caught;
    return concurrent;
  }
}
export async function listTemplateSubmissions() {
  const { data, error } = await supabase
    .from("infobip_template_submissions")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

function slug(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "cliente"
  );
}
export function normalizeTemplateName(value: string) {
  return slug(value).slice(0, 512);
}
export function resolveTemplateName(
  pattern: string,
  clientName: string,
  sequence = 1,
) {
  const now = new Date();
  const date = `${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(-2)}`;
  return slug(
    pattern
      .replace(/CLIENTE/gi, slug(clientName))
      .replace(/DATA/gi, date)
      .replace(/X/gi, String(sequence).padStart(2, "0")),
  ).slice(0, 512);
}
export function getVariableIndexes(text: string) {
  return [...text.matchAll(/\{\{(\d+)\}\}/g)]
    .map((match) => Number(match[1]))
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a - b);
}
export async function uploadTemplateMedia(file: File) {
  if (file.size > 16 * 1024 * 1024)
    throw new Error("A mídia deve ter no máximo 16 MB.");
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
    throw new Error("Use uma imagem ou vídeo válido.");
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Sessão expirada.");
  const extension =
    file.name
      .split(".")
      .pop()
      ?.replace(/[^a-z0-9]/gi, "")
      .toLowerCase() || "bin";
  const path = `${userData.user.id}/templates/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from("disparo-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from("disparo-media").getPublicUrl(path).data
    .publicUrl;
}
export async function submitTemplateBatch(
  model: InfobipTemplateModelRow,
  targets: TemplateBatchTarget[],
  onQueued?: (rows: InfobipTemplateSubmissionRow[]) => void,
) {
  if (!targets.length || targets.length > 15)
    throw new Error("Selecione entre 1 e 15 templates.");
  const rows = targets.map((target, index) => ({
    model_id: model.id,
    sender_id: target.sender.id,
    sender: target.sender.sender,
    resolved_name: normalizeTemplateName(
      target.resolved_name ||
        `${model.display_name}_${String(index + 1).padStart(2, "0")}`,
    ),
    destination_url: target.destination_url || model.button_url || null,
    requested_category: model.category,
  }));
  const { data, error } = await supabase
    .from("infobip_template_submissions")
    .insert(rows)
    .select();
  if (error) throw error;
  onQueued?.((data ?? []) as InfobipTemplateSubmissionRow[]);
  const ids = (data ?? []).map((row: InfobipTemplateSubmissionRow) => row.id);
  const { data: result, error: invokeError } = await supabase.functions.invoke(
    "infobip-templates",
    { body: { action: "submit", submissionIds: ids } },
  );
  if (invokeError) throw await infobipFunctionError(invokeError);
  const failed = (
    result as { results?: Array<{ status?: string; error?: string }> } | null
  )?.results?.find((item) => item.status === "FAILED");
  if (failed)
    throw new Error(
      failed.error || "A Infobip rejeitou a criação do template.",
    );
  return result;
}

/** Reenvia registros já criados, sem gerar novas linhas nem duplicar o lote. */
export async function retryTemplateSubmissions(submissionIds: string[]) {
  const ids = [...new Set(submissionIds.filter(Boolean))];
  if (!ids.length) throw new Error("Não há templates com erro para reenviar.");
  const batches = Array.from(
    { length: Math.ceil(ids.length / 50) },
    (_, index) => ids.slice(index * 50, index * 50 + 50),
  );
  const results: Array<{ id?: string; status?: string; error?: string }> = [];
  for (const batch of batches) {
    const { data, error } = await supabase.functions.invoke<{
      results?: Array<{ id?: string; status?: string; error?: string }>;
    }>("infobip-templates", {
      body: { action: "submit", submissionIds: batch },
    });
    if (error) throw await infobipFunctionError(error);
    results.push(...(data?.results ?? []));
  }
  return results;
}

export async function syncTemplateStatuses(submissionIds?: string[]) {
  const { data, error } = await supabase.functions.invoke("infobip-templates", {
    body: { action: "sync_status", submissionIds: submissionIds ?? [] },
  });
  if (error) throw await infobipFunctionError(error);
  return data;
}

export async function syncInfobipSenders() {
  const { data, error } = await supabase.functions.invoke<{
    senders?: Array<{
      sender: string;
      label?: string;
      waba_id?: string | null;
      waba_label?: string | null;
    }>;
  }>("infobip-templates", { body: { action: "sync_senders" } });
  if (error) throw await infobipFunctionError(error);
  const existing = await listInfobipSenders();
  const byNumber = new Map(existing.map((item) => [item.sender, item]));
  for (const remote of data?.senders ?? []) {
    const number = String(remote.sender ?? "").replace(/\D/g, "");
    if (!number || byNumber.has(number)) continue;
    const created = await createInfobipSender({
      client_id: null,
      sender: number,
      label: remote.label || `Infobip +${number}`,
      waba_id: remote.waba_id ?? null,
      waba_label: remote.waba_label || "WABA Infobip",
    });
    byNumber.set(number, created);
  }
  return Array.from(byNumber.values()).sort(
    (a, b) =>
      (a.waba_label || "").localeCompare(b.waba_label || "") ||
      a.label.localeCompare(b.label),
  );
}
