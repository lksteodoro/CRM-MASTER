import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FileVideo,
  Image,
  Info,
  KeyRound,
  Layers3,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import type {
  InfobipSenderRow,
  InfobipTemplateModelRow,
  InfobipTemplateSubmissionRow,
} from "../../integrations/supabase/database.types";
import {
  createBroadcastDraft,
  createInfobipSender,
  deleteTemplateModel,
  diagnoseInfobipScheduling,
  getInfobipApiConfig,
  getOrCreateInfobipSender,
  getVariableIndexes,
  listApprovedInfobipTemplates,
  listBroadcastDrafts,
  listInfobipPeopleTags,
  listInfobipSenders,
  listTemplateModels,
  listTemplateSubmissions,
  normalizeTemplateName,
  retryTemplateSubmissions,
  saveInfobipApiConfig,
  saveTemplateModel,
  submitTemplateBatch,
  syncInfobipSenders,
  syncTemplateStatuses,
  testInfobipApiConfig,
  uploadTemplateMedia,
} from "../../services/infobipTemplates.service";
import type {
  ApprovedInfobipTemplate,
  InfobipPeopleTag,
} from "../../services/infobipTemplates.service";

const inputClass =
  "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20";
const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] px-3.5 py-2.5 text-sm font-medium transition hover:border-[var(--color-brand)]/60 hover:bg-[var(--color-panel-2)] disabled:cursor-not-allowed disabled:opacity-50";
const sectionClass =
  "rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-sm sm:p-6";
type Category = "MARKETING" | "UTILITY" | "AUTHENTICATION";
type TemplateDraft = {
  display_name: string;
  language: string;
  category: Category;
  body_text: string;
  variable_examples: string[];
  header_type: "NONE" | "IMAGE" | "VIDEO";
  header_media_url: string;
  footer_text: string;
  button_text: string;
  button_url: string;
};
type BatchRow = { resolved_name: string; destination_url: string };
type BatchProgress = {
  status: "pending" | "sending" | "success" | "error";
  error?: string;
};
type NewSender = {
  label: string;
  sender: string;
  waba_id: string;
  waba_label: string;
};
export type BroadcastDraft = Awaited<
  ReturnType<typeof listBroadcastDrafts>
>[number];
const emptyForm: TemplateDraft = {
  display_name: "",
  language: "pt_BR",
  category: "UTILITY",
  body_text: "",
  variable_examples: [],
  header_type: "NONE",
  header_media_url: "",
  footer_text: "",
  button_text: "CLIQUE AQUI",
  button_url: "",
};
const emptySender: NewSender = {
  label: "",
  sender: "",
  waba_id: "",
  waba_label: "",
};
const categoryLabels: Record<Category, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)]">
      {children}
      {hint && (
        <Info
          size={12}
          className="text-[var(--color-text-faint)]"
          aria-label={hint}
        />
      )}
    </span>
  );
}
function isValidUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
function categoryRisk(model: Pick<TemplateDraft, "category" | "body_text">) {
  return (
    model.category === "UTILITY" &&
    /(oferta|desconto|promo|imperdível|compre|matrícul|condição especial|clique aqui)/i.test(
      model.body_text,
    )
  );
}

export function InfobipTemplatesPage() {
  const [models, setModels] = useState<InfobipTemplateModelRow[]>([]);
  const [senders, setSenders] = useState<InfobipSenderRow[]>([]);
  const [submissions, setSubmissions] = useState<
    InfobipTemplateSubmissionRow[]
  >([]);
  const [form, setForm] = useState<TemplateDraft>(emptyForm);
  const [editingId, setEditingId] = useState<string>();
  const [activeTab, setActiveTab] = useState<"create" | "batch" | "sent">(
    "batch",
  );
  const [batchModel, setBatchModel] = useState<InfobipTemplateModelRow>();
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchBaseName, setBatchBaseName] = useState("");
  const [batchSuffix, setBatchSuffix] = useState("_##");
  const [batchDefaultLink, setBatchDefaultLink] = useState("");
  const [batchProgress, setBatchProgress] = useState<BatchProgress[]>([]);
  const [batchSenderId, setBatchSenderId] = useState("");
  const [batchDirectSender, setBatchDirectSender] = useState("");
  const [newSender, setNewSender] = useState<NewSender>(emptySender);
  const [showNewSender, setShowNewSender] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [metaUpdated, setMetaUpdated] = useState(false);
  const [syncingSenders, setSyncingSenders] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyHint, setApiKeyHint] = useState("");
  const [apiConfigured, setApiConfigured] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);

  async function load() {
    const results = await Promise.allSettled([
      listTemplateModels(),
      listInfobipSenders(),
      listTemplateSubmissions(),
    ]);
    if (results[0].status === "fulfilled") setModels(results[0].value);
    if (results[1].status === "fulfilled") setSenders(results[1].value);
    if (results[2].status === "fulfilled") setSubmissions(results[2].value);
    if (results.some((result) => result.status === "rejected"))
      setMessage(
        "Aplique as migrations 0020, 0030, 0031, 0032 e 0033 para habilitar templates, API e transmissões.",
      );
  }
  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Falha ao carregar."),
    );
  }, []);
  const variableIndexes = useMemo(
    () => getVariableIndexes(form.body_text),
    [form.body_text],
  );
  const previewBody = variableIndexes.reduce(
    (text, index) =>
      text.replaceAll(
        `{{${index}}}`,
        form.variable_examples[index - 1] || `Exemplo ${index}`,
      ),
    form.body_text,
  );
  const clientSenders = senders;
  function updateForm(patch: Partial<TemplateDraft>) {
    setForm((current) => ({ ...current, ...patch }));
  }
  function resetForm() {
    setForm(emptyForm);
    setEditingId(undefined);
  }
  function addVariable() {
    const index = variableIndexes.length + 1;
    updateForm({
      body_text: `${form.body_text}${form.body_text && !/\s$/.test(form.body_text) ? " " : ""}{{${index}}}`,
    });
  }
  function edit(model: InfobipTemplateModelRow) {
    setEditingId(model.id);
    setForm({
      display_name: model.display_name,
      language: model.language,
      category: model.category,
      body_text: model.body_text,
      variable_examples: model.variable_examples,
      header_type: model.header_type,
      header_media_url: model.header_media_url ?? "",
      footer_text: model.footer_text ?? "",
      button_text: model.button_text ?? "CLIQUE AQUI",
      button_url: model.button_url ?? "",
    });
    setActiveTab("create");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save() {
    setError("");
    setMessage("");
    if (!form.display_name.trim() || !form.body_text.trim())
      return setError("Preencha o nome interno e o corpo da mensagem.");
    if (variableIndexes.some((value, index) => value !== index + 1))
      return setError("Use variáveis sequenciais: {{1}}, {{2}}, {{3}}.");
    if (form.header_type !== "NONE" && !form.header_media_url)
      return setError("Anexe a mídia de exemplo do cabeçalho.");
    if (form.button_url && !isValidUrl(form.button_url))
      return setError("O link padrão precisa começar com https://.");
    if (
      form.category === "AUTHENTICATION" &&
      (form.header_type !== "NONE" || form.button_url)
    )
      return setError(
        "Templates de autenticação não aceitam mídia ou link comum.",
      );
    setBusy(true);
    try {
      await saveTemplateModel(
        {
          ...form,
          client_id: null,
          name_pattern: "X",
          header_media_url:
            form.header_type === "NONE" ? null : form.header_media_url,
          footer_text: form.footer_text || null,
          button_text: form.button_url
            ? form.button_text.trim() || "CLIQUE AQUI"
            : null,
          button_url: form.button_url || null,
          variable_examples: variableIndexes.map(
            (_, index) =>
              form.variable_examples[index] || `Exemplo ${index + 1}`,
          ),
        },
        editingId,
      );
      resetForm();
      setActiveTab("batch");
      setMessage(
        "Modelo salvo na biblioteca. Clique em “Usar modelo” quando quiser criar templates.",
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  function formatBatchName(base: string, suffix: string, index: number) {
    const token = suffix.match(/#+/)?.[0];
    const renderedSuffix = token
      ? suffix.replace(token, String(index + 1).padStart(token.length, "0"))
      : `${suffix}${index + 1}`;
    return normalizeTemplateName(`${base}${renderedSuffix}`);
  }
  function buildBatchRows(
    model: InfobipTemplateModelRow,
    amount: number,
    base = normalizeTemplateName(model.display_name),
    suffix = "_##",
  ) {
    return Array.from({ length: amount }, (_, index) => ({
      resolved_name: formatBatchName(base, suffix, index),
      destination_url: model.button_url ?? "",
    }));
  }
  function openBatch(model: InfobipTemplateModelRow, amount: number) {
    const count = Math.min(Math.max(amount, 1), 15);
    const base = normalizeTemplateName(model.display_name);
    setBatchModel(model);
    setBatchBaseName(base);
    setBatchSuffix("_##");
    setBatchDefaultLink(model.button_url ?? "");
    setBatchRows(buildBatchRows(model, count, base, "_##"));
    setBatchProgress([]);
    setBatchSenderId(senders[0]?.id ?? "");
    setBatchDirectSender("");
    setNewSender(emptySender);
    setShowNewSender(false);
    setError("");
  }
  function changeBatchModel(model: InfobipTemplateModelRow) {
    const base = normalizeTemplateName(model.display_name);
    const defaultLink = model.button_url ?? "";
    setBatchModel(model);
    setBatchBaseName(base);
    setBatchDefaultLink(defaultLink);
    setBatchRows(
      buildBatchRows(model, batchRows.length || 1, base, batchSuffix),
    );
    setBatchProgress([]);
  }
  function resizeBatch(amount: number) {
    if (!batchModel) return;
    const count = Math.min(Math.max(amount, 1), 15);
    setBatchRows((current) =>
      Array.from(
        { length: count },
        (_, index) =>
          current[index] ?? {
            resolved_name: formatBatchName(batchBaseName, batchSuffix, index),
            destination_url: batchDefaultLink,
          },
      ),
    );
    setBatchProgress([]);
  }
  function renameBatch(base: string, suffix = batchSuffix) {
    setBatchBaseName(base);
    setBatchSuffix(suffix);
    setBatchRows((current) =>
      current.map((row, index) => ({
        ...row,
        resolved_name: formatBatchName(base, suffix, index),
      })),
    );
    setBatchProgress([]);
  }
  function changeBatchDefaultLink(value: string) {
    setBatchDefaultLink(value);
    setBatchRows((current) =>
      current.map((row) => ({ ...row, destination_url: value })),
    );
    setBatchProgress([]);
  }
  async function refreshInfobipNumbers(selectFirst = false) {
    setSyncingSenders(true);
    try {
      const rows = await syncInfobipSenders();
      setSenders(rows);
      if (selectFirst || !batchSenderId) setBatchSenderId(rows[0]?.id ?? "");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Não foi possível buscar os números na Infobip: ${caught.message}`
          : "Não foi possível buscar os números na Infobip.",
      );
    } finally {
      setSyncingSenders(false);
    }
  }
  async function addSender() {
    if (!batchModel) return;
    const number = newSender.sender.replace(/\D/g, "");
    if (
      number.length < 10 ||
      !newSender.label.trim() ||
      !newSender.waba_label.trim()
    )
      return setError(
        "Informe nome do remetente, WABA e número completo com DDI.",
      );
    setBusy(true);
    try {
      const created = await createInfobipSender({
        client_id: null,
        label: newSender.label.trim(),
        sender: number,
        waba_id: newSender.waba_id.trim() || null,
        waba_label: newSender.waba_label.trim(),
      });
      setSenders((current) => [...current, created]);
      setBatchSenderId(created.id);
      setNewSender(emptySender);
      setShowNewSender(false);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao cadastrar número.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function sendBatch(retryFailed = false) {
    if (!batchModel) return;
    const directNumber = batchDirectSender.replace(/\D/g, "");
    let selectedSender = senders.find((sender) => sender.id === batchSenderId);
    if (!selectedSender && directNumber.length < 10)
      return setError(
        "Selecione um remetente ou digite o telefone completo com DDI.",
      );
    if (batchRows.some((row) => !row.resolved_name.trim()))
      return setError("Informe o nome de todos os templates.");
    if (
      batchRows.some(
        (row) => row.destination_url && !isValidUrl(row.destination_url),
      )
    )
      return setError("Todos os links precisam começar com https://.");
    const uniqueNames = new Set(
      batchRows.map((row) => normalizeTemplateName(row.resolved_name)),
    );
    if (uniqueNames.size !== batchRows.length)
      return setError("Não repita o mesmo nome dentro do lote.");
    const indexes = batchRows
      .map((_, index) => index)
      .filter(
        (index) => !retryFailed || batchProgress[index]?.status === "error",
      );
    if (!indexes.length)
      return setError("Não há envios com falha para reenviar.");
    setBusy(true);
    setMetaUpdated(false);
    setError("");
    setMessage("");
    if (!selectedSender) {
      try {
        selectedSender = await getOrCreateInfobipSender(directNumber);
        setSenders((current) =>
          current.some((item) => item.id === selectedSender!.id)
            ? current
            : [...current, selectedSender!],
        );
        setBatchSenderId(selectedSender.id);
      } catch (caught) {
        setBusy(false);
        return setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível preparar o número para envio.",
        );
      }
    }
    const initial = batchRows.map((_, index) =>
      retryFailed && batchProgress[index]?.status === "success"
        ? batchProgress[index]
        : { status: "pending" as const },
    );
    setQueuedCount(0);
    setBatchProgress(initial);
    let accepted = 0;
    let rejected = 0;
    for (const index of indexes) {
      setBatchProgress((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { status: "sending" } : item,
        ),
      );
      try {
        const row = batchRows[index];
        await submitTemplateBatch(
          batchModel,
          [
            {
              sender: selectedSender,
              resolved_name: row.resolved_name,
              destination_url: row.destination_url || null,
            },
          ],
          () => setQueuedCount((value) => value + 1),
        );
        accepted += 1;
        setBatchProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { status: "success" } : item,
          ),
        );
      } catch (caught) {
        rejected += 1;
        const detail =
          caught instanceof Error ? caught.message : "Falha desconhecida.";
        setBatchProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { status: "error", error: detail } : item,
          ),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    setMessage(
      `${accepted} template(s) enviado(s); ${rejected} com falha.${rejected ? " Você pode reenviar somente os que falharam." : ""}`,
    );
    await load();
    setBusy(false);
    setQueuedCount(0);
  }
  async function refreshStatuses() {
    setSyncing(true);
    setError("");
    setMessage("");
    setMetaUpdated(false);
    try {
      await syncTemplateStatuses(
        submissions
          .filter((item) => item.provider_template_id)
          .map((item) => item.id),
      );
      await load();
      setMetaUpdated(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível consultar a Meta.",
      );
    } finally {
      setSyncing(false);
    }
  }
  async function retryFailedSubmissions(submissionIds: string[]) {
    setError("");
    setMessage("");
    setMetaUpdated(false);
    try {
      const results = await retryTemplateSubmissions(submissionIds);
      const accepted = results.filter((item) => item.status === "SENT").length;
      const rejected = results.filter(
        (item) => item.status === "FAILED",
      ).length;
      await load();
      setMessage(
        rejected
          ? `${accepted} template(s) reenviado(s); ${rejected} ainda com erro.`
          : `${accepted} template(s) reenviado(s) com sucesso.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível reenviar o lote.",
      );
      throw caught;
    }
  }
  async function openApiConfig() {
    setShowApiConfig(true);
    setApiBusy(true);
    setError("");
    try {
      const config = await getInfobipApiConfig();
      if (!config) throw new Error("Configuração indisponível.");
      setApiBaseUrl(config.baseUrl || "");
      setApiKeyHint(config.keyHint || "");
      setApiConfigured(config.configured);
    } catch {
      setApiBaseUrl("");
      setApiKeyHint("");
      setApiConfigured(false);
    } finally {
      setApiBusy(false);
    }
  }
  async function saveApiConfig() {
    if (!apiBaseUrl.trim() || !apiKey.trim())
      return setError("Informe a Base URL e a API Key da Infobip.");
    setApiBusy(true);
    setError("");
    try {
      const config = await saveInfobipApiConfig(
        apiBaseUrl.trim(),
        apiKey.trim(),
      );
      if (!config) throw new Error("A API não confirmou o salvamento.");
      setApiConfigured(true);
      setApiKeyHint(config.keyHint || apiKey.slice(-4));
      setApiKey("");
      setMessage("Credenciais da Infobip salvas com segurança no servidor.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar a configuração.",
      );
    } finally {
      setApiBusy(false);
    }
  }
  async function testApiConfig() {
    setApiBusy(true);
    setError("");
    try {
      await testInfobipApiConfig();
      setApiConfigured(true);
      setMessage("Conexão com a Infobip validada com sucesso.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao testar a Infobip.",
      );
    } finally {
      setApiBusy(false);
    }
  }

  async function diagnoseScheduling() {
    setApiBusy(true);
    setError("");
    setMessage("");
    try {
      const results = await diagnoseInfobipScheduling();
      const summary = results
        .map(
          (probe) =>
            `${probe.path} → ${probe.error ?? `HTTP ${probe.status}`}${probe.body ? ` · ${probe.body}` : ""}`,
        )
        .join("\n");
      setMessage(`Diagnóstico de agendamento:\n${summary}`);
      console.log("Diagnóstico de agendamento Infobip:", results);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao diagnosticar o agendamento.",
      );
    } finally {
      setApiBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
            <MessageSquareText size={15} /> Central de produção WhatsApp
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--color-text)]">
            Fábrica de templates
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Escolha um modelo, informe o sender e envie diretamente para a
            Infobip.
          </p>
        </div>
        <button className={buttonClass} onClick={() => void openApiConfig()}>
          <Settings size={15} /> Configurar API Infobip{" "}
          {apiConfigured && (
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          )}
        </button>
      </header>
      <nav className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-2">
        <div className="flex flex-wrap gap-1">
          <button
            className={`rounded-xl px-4 py-2 text-sm font-medium ${activeTab === "batch" ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "text-[var(--color-text-muted)]"}`}
            onClick={() => setActiveTab("batch")}
          >
            Biblioteca de modelos
          </button>
          <button
            className={`rounded-xl px-4 py-2 text-sm font-medium ${activeTab === "sent" ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "text-[var(--color-text-muted)]"}`}
            onClick={() => setActiveTab("sent")}
          >
            Templates enviados ({submissions.length})
          </button>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand)] px-3.5 py-2 text-sm font-semibold text-white"
          onClick={() => {
            resetForm();
            setActiveTab("create");
          }}
        >
          <Plus size={14} /> Novo modelo
        </button>
      </nav>
      {(error || message) && (
        <div
          role="alert"
          className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}
        >
          {error || message}
        </div>
      )}

      {activeTab === "create" ? (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
          <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl">
            <div className="sticky top-0 z-10 mb-5 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)] pb-4">
              <div>
                <h2 className="font-semibold text-[var(--color-text)]">
                  {editingId ? "Editar modelo" : "Criar modelo"}
                </h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Configure o conteúdo uma vez e reutilize na biblioteca.
                </p>
              </div>
              <button
                className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
                onClick={() => {
                  resetForm();
                  setActiveTab("batch");
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
              <div className="flex min-w-0 flex-col gap-5">
                <section className={sectionClass}>
                  <SectionTitle
                    icon={FileText}
                    tone="amber"
                    title="Informações do modelo"
                    subtitle="Este modelo é global e não fica preso a cliente, WABA ou número."
                  />
                  <div className="grid gap-4 md:grid-cols-3">
                    <label>
                      <FieldLabel>Nome interno para localizar</FieldLabel>
                      <input
                        className={`${inputClass} mt-1.5`}
                        placeholder="Ex.: captação graduação"
                        value={form.display_name}
                        onChange={(event) =>
                          updateForm({ display_name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <FieldLabel>Categoria solicitada</FieldLabel>
                      <select
                        className={`${inputClass} mt-1.5`}
                        value={form.category}
                        onChange={(event) =>
                          updateForm({
                            category: event.target.value as Category,
                          })
                        }
                      >
                        {Object.entries(categoryLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      <FieldLabel>Idioma</FieldLabel>
                      <select
                        className={`${inputClass} mt-1.5`}
                        value={form.language}
                        onChange={(event) =>
                          updateForm({ language: event.target.value })
                        }
                      >
                        <option value="pt_BR">Português (BR)</option>
                        <option value="en">Inglês</option>
                        <option value="es">Espanhol</option>
                      </select>
                    </label>
                  </div>
                  {categoryRisk(form) && (
                    <div className="mt-4 flex gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-xs text-amber-200">
                      <AlertTriangle size={15} className="shrink-0" /> O texto
                      parece promocional. A Meta pode rejeitar a categoria
                      Utilidade; o sistema verificará isso depois do envio.
                    </div>
                  )}
                </section>
                <section className={sectionClass}>
                  <SectionTitle
                    icon={Image}
                    tone="sky"
                    title="Cabeçalho"
                    subtitle="Mídia que permanece igual nas versões do lote."
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <label>
                      <FieldLabel>Tipo</FieldLabel>
                      <select
                        className={`${inputClass} mt-1.5`}
                        value={form.header_type}
                        onChange={(event) =>
                          updateForm({
                            header_type: event.target
                              .value as TemplateDraft["header_type"],
                            header_media_url: "",
                          })
                        }
                      >
                        <option value="NONE">Sem mídia</option>
                        <option value="IMAGE">Imagem</option>
                        <option value="VIDEO">Vídeo</option>
                      </select>
                    </label>
                    {form.header_type !== "NONE" && (
                      <label>
                        <FieldLabel>Mídia de exemplo</FieldLabel>
                        <span
                          className={`${buttonClass} mt-1.5 flex min-h-[43px] cursor-pointer`}
                        >
                          <Upload size={15} />
                          {form.header_media_url
                            ? "Trocar mídia"
                            : "Anexar mídia"}
                          <input
                            className="sr-only"
                            type="file"
                            accept={
                              form.header_type === "IMAGE"
                                ? "image/*"
                                : "video/*"
                            }
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              setBusy(true);
                              try {
                                updateForm({
                                  header_media_url:
                                    await uploadTemplateMedia(file),
                                });
                              } catch (caught) {
                                setError(
                                  caught instanceof Error
                                    ? caught.message
                                    : "Falha no upload.",
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          />
                        </span>
                      </label>
                    )}
                  </div>
                </section>
                <section className={sectionClass}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <SectionTitle
                      icon={MessageSquareText}
                      tone="violet"
                      title="Conteúdo fixo"
                      subtitle="Escreva uma vez e reaproveite sempre."
                    />
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={addVariable}
                    >
                      <Plus size={14} /> Variável
                    </button>
                  </div>
                  <label>
                    <div className="mb-1.5 flex justify-between">
                      <FieldLabel>Corpo da mensagem</FieldLabel>
                      <span className="text-[11px] text-[var(--color-text-faint)]">
                        {form.body_text.length}/1024
                      </span>
                    </div>
                    <textarea
                      className={`${inputClass} min-h-40 resize-y`}
                      maxLength={1024}
                      placeholder="Olá {{1}}, sua inscrição foi recebida."
                      value={form.body_text}
                      onChange={(event) =>
                        updateForm({ body_text: event.target.value })
                      }
                    />
                  </label>
                  {variableIndexes.length > 0 && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {variableIndexes.map((index) => (
                        <label key={index}>
                          <FieldLabel>
                            Exemplo {"{{"}
                            {index}
                            {"}}"}
                          </FieldLabel>
                          <input
                            className={`${inputClass} mt-1.5`}
                            value={form.variable_examples[index - 1] ?? ""}
                            onChange={(event) => {
                              const next = [...form.variable_examples];
                              next[index - 1] = event.target.value;
                              updateForm({ variable_examples: next });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="mt-4 block">
                    <FieldLabel>Rodapé</FieldLabel>
                    <input
                      className={`${inputClass} mt-1.5`}
                      maxLength={60}
                      value={form.footer_text}
                      onChange={(event) =>
                        updateForm({ footer_text: event.target.value })
                      }
                    />
                  </label>
                </section>
                <section className={sectionClass}>
                  <SectionTitle
                    icon={Link2}
                    tone="emerald"
                    title="Botão e link padrão"
                    subtitle="O texto fica salvo; o destino pode mudar em cada linha do lote."
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <label>
                      <FieldLabel>Texto do botão</FieldLabel>
                      <input
                        className={`${inputClass} mt-1.5`}
                        maxLength={25}
                        placeholder="CLIQUE AQUI"
                        value={form.button_text}
                        onChange={(event) =>
                          updateForm({ button_text: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <FieldLabel>Link padrão</FieldLabel>
                      <input
                        className={`${inputClass} mt-1.5`}
                        type="url"
                        placeholder="https://seusite.com/destino"
                        value={form.button_url}
                        onChange={(event) =>
                          updateForm({ button_url: event.target.value })
                        }
                      />
                    </label>
                  </div>
                </section>
                <div className="flex justify-end gap-2">
                  <button className={buttonClass} onClick={resetForm}>
                    Limpar
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={save}
                  >
                    <Save size={15} />{" "}
                    {editingId
                      ? "Salvar alterações"
                      : "Salvar modelo reutilizável"}
                  </button>
                </div>
              </div>
              <aside className="sticky top-5">
                <WhatsAppPreview form={form} body={previewBody} />
              </aside>
            </div>
          </div>
        </div>
      ) : activeTab === "batch" ? (
        <BatchWorkspace
          models={models}
          senders={senders}
          onOpen={openBatch}
          onCreate={() => {
            resetForm();
            setActiveTab("create");
          }}
          onEdit={edit}
          onDelete={async (model) => {
            if (confirm("Excluir este modelo?")) {
              await deleteTemplateModel(model.id);
              await load();
            }
          }}
        />
      ) : (
        <SentTemplates
          submissions={submissions}
          models={models}
          senders={senders}
          syncing={syncing}
          metaUpdated={metaUpdated}
          onRefresh={refreshStatuses}
          onRetryFailed={retryFailedSubmissions}
          onNew={() => {
            resetForm();
            setActiveTab("create");
          }}
        />
      )}

      {batchModel && (
        <BatchModal
          model={batchModel}
          models={models}
          rows={batchRows}
          progress={batchProgress}
          baseName={batchBaseName}
          suffix={batchSuffix}
          defaultLink={batchDefaultLink}
          directSender={batchDirectSender}
          senders={clientSenders}
          senderId={batchSenderId}
          syncingSenders={syncingSenders}
          busy={busy}
          queuedCount={queuedCount}
          showNewSender={showNewSender}
          newSender={newSender}
          onModelChange={changeBatchModel}
          onBaseNameChange={(value) => renameBatch(value)}
          onSuffixChange={(value) => renameBatch(batchBaseName, value)}
          onDefaultLinkChange={changeBatchDefaultLink}
          onDirectSenderChange={(value) => {
            setBatchDirectSender(value);
            if (value.replace(/\D/g, "")) setBatchSenderId("");
          }}
          onResize={resizeBatch}
          onSenderChange={(value) => {
            setBatchSenderId(value);
            if (value) setBatchDirectSender("");
          }}
          onRefreshSenders={() => void refreshInfobipNumbers()}
          onNewSenderChange={setNewSender}
          onShowNewSender={setShowNewSender}
          onAddSender={addSender}
          onRowsChange={setBatchRows}
          onClose={() => !busy && setBatchModel(undefined)}
          onSend={() => void sendBatch(false)}
          onRetry={() => void sendBatch(true)}
        />
      )}
      {showApiConfig && (
        <ApiConfigModal
          baseUrl={apiBaseUrl}
          apiKey={apiKey}
          keyHint={apiKeyHint}
          configured={apiConfigured}
          busy={apiBusy}
          error={error}
          onBaseUrlChange={setApiBaseUrl}
          onApiKeyChange={setApiKey}
          onSave={() => void saveApiConfig()}
          onTest={() => void testApiConfig()}
          onDiagnose={() => void diagnoseScheduling()}
          onClose={() => !apiBusy && setShowApiConfig(false)}
        />
      )}
    </main>
  );
}

function BatchWorkspace({
  models,
  senders,
  onOpen,
  onCreate,
  onEdit,
  onDelete,
}: {
  models: InfobipTemplateModelRow[];
  senders: InfobipSenderRow[];
  onOpen: (model: InfobipTemplateModelRow, amount: number) => void;
  onCreate: () => void;
  onEdit: (model: InfobipTemplateModelRow) => void;
  onDelete: (model: InfobipTemplateModelRow) => void;
}) {
  return (
    <section className={sectionClass}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers3 size={17} className="text-emerald-300" />
            <h2 className="font-semibold text-[var(--color-text)]">
              Biblioteca de modelos
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Escolha um modelo e configure quantidade, nomes, link e sender no
            painel de envio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--color-panel-2)] px-2.5 py-1 text-xs text-[var(--color-text-muted)]">
            {models.length} modelos
          </span>
          <button className={buttonClass} onClick={onCreate}>
            <Plus size={14} /> Criar modelo
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {models.map((model) => (
          <article
            key={model.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-bg)] px-4 py-3 transition hover:border-[var(--color-brand)]/30"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-panel-2)] text-[var(--color-text-muted)]">
              {model.header_type === "IMAGE" ? (
                <Image size={15} />
              ) : model.header_type === "VIDEO" ? (
                <FileVideo size={15} />
              ) : (
                <FileText size={15} />
              )}
            </span>
            <div className="min-w-[180px] flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                  {model.display_name}
                </p>
                <span className="rounded-full bg-[var(--color-panel-2)] px-2 py-0.5 text-[9px] text-[var(--color-text-muted)]">
                  {categoryLabels[model.category]}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-[var(--color-text-muted)]">
                {model.body_text}
              </p>
            </div>
            <span className="hidden text-[10px] text-[var(--color-text-faint)] sm:block">
              {senders.length} salvos · telefone direto disponível
            </span>
            <div className="ml-auto flex gap-1">
              <button
                className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
                title="Editar modelo"
                onClick={() => onEdit(model)}
              >
                <Settings size={14} />
              </button>
              <button
                className="rounded-lg p-2 text-red-300/70 hover:bg-red-500/10"
                title="Excluir modelo"
                onClick={() => onDelete(model)}
              >
                <Trash2 size={14} />
              </button>
              <button
                className="ml-1 inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-white"
                onClick={() => onOpen(model, 1)}
              >
                <Send size={14} /> Usar modelo
              </button>
            </div>
          </article>
        ))}
        {!models.length && (
          <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-[var(--color-border)] text-center">
            <div>
              <FileText
                size={22}
                className="mx-auto text-[var(--color-text-faint)]"
              />
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Nenhum modelo salvo.
              </p>
              <button
                className="mt-3 rounded-xl bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-white"
                onClick={onCreate}
              >
                Criar primeiro modelo
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function BroadcastWorkspace({
  drafts,
  onCreate,
}: {
  drafts: BroadcastDraft[];
  onCreate: () => void;
}) {
  return (
    <section className={sectionClass}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Send size={17} className="text-sky-300" />
            <h2 className="font-semibold text-[var(--color-text)]">
              Rascunhos de transmissão
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Cada rascunho aponta o sender, a etiqueta existente na Infobip e o
            template aprovado correspondente.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white"
          onClick={onCreate}
        >
          <Plus size={14} /> Nova transmissão
        </button>
      </div>
      <div className="space-y-3">
        {drafts.map((draft) => (
          <article
            key={draft.id}
            className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-bg)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-[var(--color-text)]">
                    {draft.name}
                  </p>
                  <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-semibold text-amber-300">
                    RASCUNHO
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Sender +{draft.sender} ·{" "}
                  {draft.total_leads.toLocaleString("pt-BR")} contatos estimados
                  · {draft.items.length} apontamento(s)
                </p>
              </div>
              <span className="text-[10px] text-[var(--color-text-faint)]">
                {new Date(draft.updated_at).toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {draft.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[var(--color-text)]">
                      #{item.infobip_tag_name || item.label}
                    </p>
                    <p className="truncate text-[10px] text-[var(--color-text-muted)]">
                      Tag da Infobip ·{" "}
                      {item.infobip_tag_people_count?.toLocaleString("pt-BR") ??
                        "quantidade não informada"}{" "}
                      contatos
                    </p>
                  </div>
                  <span
                    className="max-w-48 truncate rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] text-emerald-300"
                    title={item.template_name}
                  >
                    {item.template_name}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ))}
        {!drafts.length && (
          <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-[var(--color-border)] text-center">
            <div>
              <Send
                size={22}
                className="mx-auto text-[var(--color-text-faint)]"
              />
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Nenhuma transmissão em rascunho.
              </p>
              <button
                className="mt-3 rounded-xl bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-white"
                onClick={onCreate}
              >
                Criar transmissão
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type BroadcastTagItem = {
  id: string;
  tagId: string;
  templateId: string;
};
function TemplateComboBox({
  templates,
  value,
  onChange,
  disabled,
}: {
  templates: ApprovedInfobipTemplate[];
  value: string;
  onChange: (templateId: string) => void;
  disabled?: boolean;
}) {
  const selected = templates.find((template) => template.id === value) ?? null;
  const selectedLabel = selected
    ? `${selected.name} · ${selected.language}`
    : "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term || query === selectedLabel) return templates;
    return templates.filter((template) =>
      `${template.name} ${template.language}`.toLowerCase().includes(term),
    );
  }, [templates, query, selectedLabel]);
  const isDisabled = disabled || !templates.length;
  return (
    <div className="relative">
      <input
        type="text"
        className={`${inputClass} mt-1`}
        placeholder={
          templates.length
            ? "Digite para buscar o template"
            : "Busque os templates do sender"
        }
        value={query}
        disabled={isDisabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value) onChange("");
        }}
        onBlur={() => setOpen(false)}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-lg">
          {filtered.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="block w-full px-3.5 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(template.id);
                  setQuery(`${template.name} · ${template.language}`);
                  setOpen(false);
                }}
              >
                {template.name} · {template.language}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function BroadcastDraftModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [sender, setSender] = useState("");
  const [templates, setTemplates] = useState<ApprovedInfobipTemplate[]>([]);
  const [tags, setTags] = useState<InfobipPeopleTag[]>([]);
  const [items, setItems] = useState<BroadcastTagItem[]>([]);
  const [loadingAudience, setLoadingAudience] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function fetchAudience() {
    setLoadingAudience(true);
    setError("");
    setTemplates([]);
    setTags([]);
    setItems([]);
    const [templateResult, tagResult] = await Promise.allSettled([
      listApprovedInfobipTemplates(sender),
      listInfobipPeopleTags(),
    ]);
    if (templateResult.status === "fulfilled")
      setTemplates(templateResult.value);
    if (tagResult.status === "fulfilled") setTags(tagResult.value);
    if (
      templateResult.status === "rejected" ||
      tagResult.status === "rejected"
    ) {
      const templateMessage =
        templateResult.status === "rejected"
          ? templateResult.reason instanceof Error
            ? templateResult.reason.message
            : "Falha ao buscar templates."
          : null;
      const tagMessage =
        tagResult.status === "rejected"
          ? tagResult.reason instanceof Error
            ? tagResult.reason.message
            : "Falha ao buscar etiquetas."
          : null;
      setError(
        [
          templateMessage ? `Templates: ${templateMessage}` : null,
          tagMessage ? `Etiquetas: ${tagMessage}` : null,
        ]
          .filter(Boolean)
          .join(" — "),
      );
    } else if (!templateResult.value.length) {
      setError("Nenhum template aprovado foi encontrado para esse sender.");
    } else if (!tagResult.value.length) {
      setError("Nenhuma etiqueta foi encontrada no People da Infobip.");
    }
    setLoadingAudience(false);
  }
  function addMapping() {
    setItems((current) => [
      ...current,
      { id: crypto.randomUUID(), tagId: "", templateId: "" },
    ]);
  }
  async function saveDraft() {
    const normalizedSender = sender.replace(/\D/g, "");
    if (!name.trim() || normalizedSender.length < 10)
      return setError(
        "Informe o nome da transmissão e o sender completo com DDI.",
      );
    if (!items.length)
      return setError(
        "Adicione ao menos um apontamento de etiqueta e template.",
      );
    if (items.some((item) => !item.tagId || !item.templateId))
      return setError(
        "Selecione uma etiqueta da Infobip e um template para cada apontamento.",
      );
    setSaving(true);
    setError("");
    try {
      await createBroadcastDraft({
        name,
        sender: normalizedSender,
        items: items.map((item) => ({
          tag: tags.find((tag) => tag.id === item.tagId)!,
          template: templates.find(
            (template) => template.id === item.templateId,
          )!,
        })),
      });
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar o rascunho.",
      );
    } finally {
      setSaving(false);
    }
  }
  const total = items.reduce(
    (sum, item) =>
      sum + (tags.find((tag) => tag.id === item.tagId)?.peopleCount ?? 0),
    0,
  );
  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)] p-5">
          <div>
            <h2 className="font-semibold text-[var(--color-text)]">
              Nova transmissão em rascunho
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Escolha o sender, puxe os templates e etiquetas da Infobip e faça
              apenas o apontamento.
            </p>
          </div>
          <button
            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
            disabled={saving}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-5 p-5">
          {error && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-3 text-xs text-red-300">
              {error}
            </div>
          )}
          <section className="grid gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 md:grid-cols-2">
            <label>
              <FieldLabel>Nome da transmissão</FieldLabel>
              <input
                className={`${inputClass} mt-1.5`}
                placeholder="Ex.: Pós Agosto - Lote 01"
                value={name}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <FieldLabel>Sender Infobip</FieldLabel>
              <div className="mt-1.5 flex gap-2">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="5511999999999"
                  value={sender}
                  disabled={saving}
                  onChange={(event) => {
                    setSender(event.target.value);
                    setTemplates([]);
                    setTags([]);
                    setItems([]);
                  }}
                />
                <button
                  className={buttonClass}
                  disabled={
                    saving ||
                    loadingAudience ||
                    sender.replace(/\D/g, "").length < 10
                  }
                  onClick={() => void fetchAudience()}
                >
                  {loadingAudience ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}{" "}
                  Puxar da Infobip
                </button>
              </div>
            </label>
          </section>
          <section className="rounded-xl border border-sky-400/25 bg-sky-400/[0.05] p-4 text-sm text-[var(--color-text-muted)]">
            <b className="text-sky-200">Sem CSV nesta etapa.</b> A lista
            continua na Infobip: você só vincula cada etiqueta existente ao
            template aprovado desse sender. Nenhum contato é copiado para o CRM.
          </section>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Apontamento template × etiqueta
                </h3>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Cada linha usa uma audiência que já está na Infobip.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--color-text-muted)]">
                  {items.length} item(ns) · {total.toLocaleString("pt-BR")}{" "}
                  contatos estimados
                </span>
                <button
                  className={buttonClass}
                  disabled={saving || !templates.length || !tags.length}
                  onClick={addMapping}
                >
                  <Plus size={14} /> Adicionar apontamento
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="grid items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 md:grid-cols-[42px_1fr_1fr_42px]"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-sm font-bold text-[var(--color-brand)]">
                    {index + 1}
                  </span>
                  <label>
                    <FieldLabel>Etiqueta da Infobip</FieldLabel>
                    <select
                      className={`${inputClass} mt-1`}
                      value={item.tagId}
                      disabled={saving || !tags.length}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((row) =>
                            row.id === item.id
                              ? { ...row, tagId: event.target.value }
                              : row,
                          ),
                        )
                      }
                    >
                      <option value="">Selecione a etiqueta</option>
                      {tags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                          {tag.peopleCount !== null
                            ? ` · ${tag.peopleCount.toLocaleString("pt-BR")} contatos`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel>Template aprovado</FieldLabel>
                    <TemplateComboBox
                      templates={templates}
                      value={item.templateId}
                      disabled={saving}
                      onChange={(templateId) =>
                        setItems((current) =>
                          current.map((row) =>
                            row.id === item.id ? { ...row, templateId } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="grid h-[43px] place-items-center rounded-xl border border-red-500/20 text-red-300"
                    disabled={saving}
                    onClick={() =>
                      setItems((current) =>
                        current.filter((row) => row.id !== item.id),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <div className="flex justify-end gap-2">
            <button className={buttonClass} disabled={saving} onClick={onClose}>
              Cancelar
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={saving || !items.length}
              onClick={() => void saveDraft()}
            >
              {saving ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}{" "}
              Salvar rascunho
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  tone,
  title,
  subtitle,
}: {
  icon: typeof FileText;
  tone: "amber" | "sky" | "violet" | "emerald";
  title: string;
  subtitle: string;
}) {
  const colors = {
    amber: "bg-amber-400/10 text-amber-300",
    sky: "bg-sky-400/10 text-sky-300",
    violet: "bg-violet-400/10 text-violet-300",
    emerald: "bg-emerald-400/10 text-emerald-300",
  };
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className={`rounded-xl p-2.5 ${colors[tone]}`}>
        <Icon size={20} />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-[var(--color-text-muted)]">{subtitle}</p>
      </div>
    </div>
  );
}

function WhatsAppPreview({
  form,
  body,
}: {
  form: TemplateDraft;
  body: string;
}) {
  return (
    <section className={`${sectionClass} overflow-hidden p-0`}>
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex items-center gap-2">
          <MessageSquareText size={16} className="text-emerald-400" />
          <h2 className="font-semibold">Preview WhatsApp</h2>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Conteúdo atualizado em tempo real.
        </p>
      </div>
      <div className="min-h-[410px] bg-[#17211b] p-4">
        <div className="rounded-xl bg-[#202c27] px-3 py-2 text-xs text-white">
          <b>WhatsApp Business</b>
          <p className="text-[10px] text-white/50">online</p>
        </div>
        <div className="ml-auto mt-5 max-w-[310px] overflow-hidden rounded-2xl rounded-tr-sm bg-[#005c4b] text-sm text-white shadow-lg">
          {form.header_media_url && form.header_type === "IMAGE" ? (
            <img
              src={form.header_media_url}
              alt="Cabeçalho"
              className="h-36 w-full object-cover"
            />
          ) : form.header_type === "VIDEO" ? (
            <div className="grid h-24 place-items-center bg-black/20">
              <FileVideo size={24} />
            </div>
          ) : null}
          <div className="p-3">
            <p className="whitespace-pre-wrap break-words">
              {body || "Sua mensagem aparecerá aqui."}
            </p>
            {form.footer_text && (
              <p className="mt-2 text-xs text-white/55">{form.footer_text}</p>
            )}
            <p className="mt-1 text-right text-[10px] text-white/45">
              agora ✓✓
            </p>
          </div>
          {form.button_url && (
            <div className="border-t border-white/10 px-3 py-2.5 text-center text-xs font-semibold text-[#53bdeb]">
              <ExternalLink size={13} className="mr-1 inline" />
              {form.button_text || "CLIQUE AQUI"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function BatchModal({
  model,
  models,
  rows,
  progress,
  baseName,
  suffix,
  defaultLink,
  directSender,
  senders,
  senderId,
  syncingSenders,
  busy,
  queuedCount,
  showNewSender,
  newSender,
  onModelChange,
  onBaseNameChange,
  onSuffixChange,
  onDefaultLinkChange,
  onDirectSenderChange,
  onResize,
  onSenderChange,
  onRefreshSenders,
  onNewSenderChange,
  onShowNewSender,
  onAddSender,
  onRowsChange,
  onClose,
  onSend,
  onRetry,
}: {
  model: InfobipTemplateModelRow;
  models: InfobipTemplateModelRow[];
  rows: BatchRow[];
  progress: BatchProgress[];
  baseName: string;
  suffix: string;
  defaultLink: string;
  directSender: string;
  senders: InfobipSenderRow[];
  senderId: string;
  syncingSenders: boolean;
  busy: boolean;
  queuedCount: number;
  showNewSender: boolean;
  newSender: NewSender;
  onModelChange: (model: InfobipTemplateModelRow) => void;
  onBaseNameChange: (value: string) => void;
  onSuffixChange: (value: string) => void;
  onDefaultLinkChange: (value: string) => void;
  onDirectSenderChange: (value: string) => void;
  onResize: (amount: number) => void;
  onSenderChange: (value: string) => void;
  onRefreshSenders: () => void;
  onNewSenderChange: (value: NewSender) => void;
  onShowNewSender: (value: boolean) => void;
  onAddSender: () => void;
  onRowsChange: (rows: BatchRow[]) => void;
  onClose: () => void;
  onSend: () => void;
  onRetry: () => void;
}) {
  const updateRow = (index: number, patch: Partial<BatchRow>) =>
    onRowsChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  const completed = progress.filter(
    (item) => item.status === "success" || item.status === "error",
  ).length;
  const failed = progress.filter((item) => item.status === "error").length;
  const percent = progress.length
    ? Math.round((completed / progress.length) * 100)
    : 0;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)] p-5">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-brand)]">
              <Layers3 size={17} />
              <b>Subidor de templates WhatsApp</b>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Selecione o template e o remetente da Infobip, depois crie de 1 a
              15 cópias.
            </p>
          </div>
          <button
            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-5 p-5">
          <section className="grid gap-4 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] p-4 md:grid-cols-2">
            <label>
              <FieldLabel>Template salvo</FieldLabel>
              <select
                className={`${inputClass} mt-1.5`}
                value={model.id}
                disabled={busy}
                onChange={(event) => {
                  const selected = models.find(
                    (item) => item.id === event.target.value,
                  );
                  if (selected) onModelChange(selected);
                }}
              >
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name} · {categoryLabels[item.category]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Remetente salvo (opcional)</FieldLabel>
                <button
                  className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] disabled:opacity-50"
                  disabled={busy || syncingSenders}
                  onClick={onRefreshSenders}
                >
                  <RefreshCw
                    size={12}
                    className={syncingSenders ? "animate-spin" : ""}
                  />{" "}
                  Sincronizar
                </button>
              </div>
              <select
                className={`${inputClass} mt-1.5`}
                value={senderId}
                disabled={busy || syncingSenders}
                onChange={(event) => onSenderChange(event.target.value)}
              >
                <option value="">
                  {syncingSenders
                    ? "Buscando na Infobip..."
                    : "Usar telefone direto abaixo"}
                </option>
                {senders.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.waba_label || "WABA"} · {sender.label} · +
                    {sender.sender}
                  </option>
                ))}
              </select>
            </div>
            <label className="md:col-span-2">
              <FieldLabel>
                Ou digite o telefone remetente diretamente
              </FieldLabel>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text-muted)]">
                  +
                </span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="5511999999999"
                  value={directSender}
                  disabled={busy}
                  onChange={(event) => onDirectSenderChange(event.target.value)}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">
                Sem importação e sem sincronização. Informe DDI + DDD + número;
                ele precisa estar ativo na sua conta Infobip.
              </p>
            </label>
            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                Um único número será usado em todas as cópias deste envio.
              </p>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() => onShowNewSender(!showNewSender)}
              >
                <Plus size={14} /> Cadastro completo opcional
              </button>
            </div>
          </section>
          {showNewSender && (
            <section className="grid gap-3 rounded-xl border border-[var(--color-brand)]/25 bg-[var(--color-brand-soft)] p-4 md:grid-cols-5">
              <label>
                <FieldLabel>Nome</FieldLabel>
                <input
                  className={`${inputClass} mt-1`}
                  value={newSender.label}
                  onChange={(event) =>
                    onNewSenderChange({
                      ...newSender,
                      label: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <FieldLabel>Número com DDI</FieldLabel>
                <input
                  className={`${inputClass} mt-1`}
                  value={newSender.sender}
                  onChange={(event) =>
                    onNewSenderChange({
                      ...newSender,
                      sender: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <FieldLabel>WABA</FieldLabel>
                <input
                  className={`${inputClass} mt-1`}
                  value={newSender.waba_label}
                  onChange={(event) =>
                    onNewSenderChange({
                      ...newSender,
                      waba_label: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <FieldLabel>ID do WABA</FieldLabel>
                <input
                  className={`${inputClass} mt-1`}
                  value={newSender.waba_id}
                  onChange={(event) =>
                    onNewSenderChange({
                      ...newSender,
                      waba_id: event.target.value,
                    })
                  }
                />
              </label>
              <button
                className="mt-5 inline-flex h-[43px] items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-3 text-sm font-semibold text-white"
                disabled={busy}
                onClick={onAddSender}
              >
                <Check size={14} /> Salvar
              </button>
            </section>
          )}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">
                  Quantidade de cópias
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Cada cópia recebe um nome único e pode ter seu próprio link.
                </p>
              </div>
              <span className="rounded-xl bg-emerald-500 px-4 py-2 text-lg font-bold text-white">
                {rows.length}x
              </span>
            </div>
            <input
              className="mt-5 w-full accent-emerald-500"
              type="range"
              min="1"
              max="15"
              step="1"
              value={rows.length}
              disabled={busy}
              onChange={(event) => onResize(Number(event.target.value))}
            />
            <div className="mt-1 flex justify-between text-[10px] text-[var(--color-text-faint)]">
              {Array.from({ length: 15 }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label>
                <FieldLabel>Nome base</FieldLabel>
                <input
                  className={`${inputClass} mt-1.5 font-mono`}
                  value={baseName}
                  disabled={busy}
                  onChange={(event) =>
                    onBaseNameChange(normalizeTemplateName(event.target.value))
                  }
                />
              </label>
              <label>
                <FieldLabel>Padrão de sufixo</FieldLabel>
                <input
                  className={`${inputClass} mt-1.5 font-mono`}
                  value={suffix}
                  disabled={busy}
                  onChange={(event) => onSuffixChange(event.target.value)}
                />
                <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">
                  Use ## para 01, 02… ou # para 1, 2…
                </p>
              </label>
              <label className="md:col-span-2">
                <FieldLabel>Link padrão do lote</FieldLabel>
                <input
                  className={`${inputClass} mt-1.5`}
                  type="url"
                  placeholder="https://seusite.com/destino"
                  value={defaultLink}
                  disabled={busy}
                  onChange={(event) => onDefaultLinkChange(event.target.value)}
                />
                <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">
                  Aplicado a todas as cópias. Você ainda pode alterar
                  individualmente nas linhas abaixo.
                </p>
              </label>
            </div>
          </section>
          <section className="space-y-2">
            {rows.map((row, index) => {
              const state = progress[index]?.status ?? "pending";
              return (
                <div
                  key={index}
                  className={`grid items-end gap-3 rounded-xl border p-3 md:grid-cols-[42px_1fr_1.2fr_150px] ${state === "error" ? "border-red-500/30 bg-red-500/[0.04]" : state === "success" ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-[var(--color-border)] bg-[var(--color-bg)]"}`}
                >
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-sm font-bold text-[var(--color-brand)]">
                    {index + 1}
                  </div>
                  <label>
                    <FieldLabel>Nome do template</FieldLabel>
                    <input
                      className={`${inputClass} mt-1 font-mono text-xs`}
                      value={row.resolved_name}
                      disabled={busy}
                      onChange={(event) =>
                        updateRow(index, {
                          resolved_name: normalizeTemplateName(
                            event.target.value,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <FieldLabel>Link de destino</FieldLabel>
                    <input
                      className={`${inputClass} mt-1`}
                      type="url"
                      placeholder="https://..."
                      value={row.destination_url}
                      disabled={busy}
                      onChange={(event) =>
                        updateRow(index, {
                          destination_url: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="flex min-h-[43px] items-center gap-2 text-xs">
                    {state === "sending" ? (
                      <>
                        <LoaderCircle
                          size={16}
                          className="animate-spin text-sky-300"
                        />
                        <span>Enviando...</span>
                      </>
                    ) : state === "success" ? (
                      <>
                        <CheckCircle2 size={16} className="text-emerald-300" />
                        <span className="text-emerald-300">Enviado</span>
                      </>
                    ) : state === "error" ? (
                      <>
                        <XCircle size={16} className="text-red-300" />
                        <span
                          className="max-w-56 line-clamp-2 text-red-300"
                          title={progress[index]?.error}
                        >
                          {progress[index]?.error || "Erro no envio"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="h-2 w-2 rounded-full bg-[var(--color-text-faint)]" />
                        <span className="text-[var(--color-text-muted)]">
                          Pendente
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
          {progress.length > 0 && (
            <section className="rounded-xl border border-[var(--color-brand)]/25 bg-[var(--color-brand-soft)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    Progresso do envio
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {completed} de {progress.length} processados · {queuedCount}{" "}
                    enviados para a fila
                  </p>
                </div>
                <span className="text-sm font-bold text-[var(--color-brand)]">
                  {percent}%
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-bg)]">
                <div
                  className="h-full rounded-full bg-[var(--color-brand)] transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </section>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button className={buttonClass} disabled={busy} onClick={onClose}>
              Fechar
            </button>
            {failed > 0 && (
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-red-400/30 px-4 py-2.5 text-sm font-semibold text-red-300 disabled:opacity-50"
                disabled={busy}
                onClick={onRetry}
              >
                <RefreshCw size={14} /> Reenviar {failed} com falha
              </button>
            )}
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy}
              onClick={onSend}
            >
              {busy ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}{" "}
              Subir {rows.length} template(s)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiConfigModal({
  baseUrl,
  apiKey,
  keyHint,
  configured,
  busy,
  error,
  onBaseUrlChange,
  onApiKeyChange,
  onSave,
  onTest,
  onDiagnose,
  onClose,
}: {
  baseUrl: string;
  apiKey: string;
  keyHint: string;
  configured: boolean;
  busy: boolean;
  error: string;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onDiagnose: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[var(--color-border)] p-5">
          <div className="flex gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-300">
              <KeyRound size={18} />
            </span>
            <div>
              <h2 className="font-semibold text-[var(--color-text)]">
                Configurar API Infobip
              </h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                A chave fica cifrada no servidor e nunca é devolvida ao
                navegador.
              </p>
            </div>
          </div>
          <button
            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${configured ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300" : "border-amber-500/25 bg-amber-500/[0.06] text-amber-300"}`}
          >
            {configured ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
            {configured
              ? `Configurada${keyHint ? ` · chave final ${keyHint}` : ""}`
              : "Credenciais ainda não configuradas nesta organização."}
          </div>
          {error && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-3 text-xs text-red-300">
              {error}
            </div>
          )}
          <label>
            <FieldLabel>Base URL</FieldLabel>
            <input
              className={`${inputClass} mt-1.5`}
              type="url"
              placeholder="https://xxxxx.api.infobip.com"
              value={baseUrl}
              disabled={busy}
              onChange={(event) => onBaseUrlChange(event.target.value)}
            />
          </label>
          <label>
            <FieldLabel>API Key</FieldLabel>
            <input
              className={`${inputClass} mt-1.5 font-mono`}
              type="password"
              autoComplete="new-password"
              placeholder={
                configured
                  ? `••••••••••••${keyHint}`
                  : "Cole a API Key da Infobip"
              }
              value={apiKey}
              disabled={busy}
              onChange={(event) => onApiKeyChange(event.target.value)}
            />
            <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">
              Não inclua o prefixo “App”. Para trocar a chave, informe uma nova
              e salve.
            </p>
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              className={buttonClass}
              disabled={busy || !configured}
              onClick={onTest}
            >
              {busy ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}{" "}
              Testar conexão
            </button>
            <button
              className={buttonClass}
              disabled={busy || !configured}
              onClick={onDiagnose}
            >
              <Info size={14} /> Diagnosticar agendamento
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy || !baseUrl.trim() || !apiKey.trim()}
              onClick={onSave}
            >
              <Save size={14} /> Salvar credenciais
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SentTemplates({
  submissions,
  models,
  senders,
  syncing,
  metaUpdated,
  onRefresh,
  onRetryFailed,
  onNew,
}: {
  submissions: InfobipTemplateSubmissionRow[];
  models: InfobipTemplateModelRow[];
  senders: InfobipSenderRow[];
  syncing: boolean;
  metaUpdated: boolean;
  onRefresh: () => void;
  onRetryFailed: (submissionIds: string[]) => Promise<void>;
  onNew: () => void;
}) {
  const [filter, setFilter] = useState<
    "all" | "processing" | "sent" | "approved" | "error"
  >("all");
  const [retryingSender, setRetryingSender] = useState<string | null>(null);
  const [expandedSenders, setExpandedSenders] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [copiedSubmissionId, setCopiedSubmissionId] = useState<string | null>(
    null,
  );
  const pageSize = 15;
  const isError = (item: InfobipTemplateSubmissionRow) =>
    [item.status, item.provider_status]
      .filter(Boolean)
      .some((status) =>
        ["FAILED", "REJECTED", "DISABLED"].includes(
          String(status).toUpperCase(),
        ),
      );
  const isProcessing = (item: InfobipTemplateSubmissionRow) =>
    !isError(item) &&
    ["QUEUED", "SENDING", "PENDING"].includes(
      String(item.status).toUpperCase(),
    );
  const isSent = (item: InfobipTemplateSubmissionRow) =>
    !isError(item) &&
    !isProcessing(item) &&
    !isApproved(item) &&
    ["SENT"].includes(String(item.status).toUpperCase());
  const isApproved = (item: InfobipTemplateSubmissionRow) =>
    !isError(item) &&
    ["APPROVED", "ACTIVE"].includes(
      String(item.provider_status || item.status).toUpperCase(),
    );
  const counts = {
    all: submissions.length,
    processing: submissions.filter(isProcessing).length,
    sent: submissions.filter(isSent).length,
    approved: submissions.filter(isApproved).length,
    error: submissions.filter(isError).length,
  };
  const visibleSubmissions = submissions.filter((item) =>
    filter === "all"
      ? true
      : filter === "processing"
        ? isProcessing(item)
        : filter === "sent"
          ? isSent(item)
          : filter === "approved"
            ? isApproved(item)
            : isError(item),
  );
  const groupBySender = ["all", "sent", "approved", "error"].includes(filter);
  const orderedSubmissions = groupBySender
    ? [...visibleSubmissions].sort((a, b) =>
        a.sender.localeCompare(b.sender, "pt-BR"),
      )
    : visibleSubmissions;
  const senderGroups = useMemo(() => {
    const groups = new Map<string, InfobipTemplateSubmissionRow[]>();
    for (const submission of orderedSubmissions) {
      const sender = submission.sender || "sem-remetente";
      groups.set(sender, [...(groups.get(sender) ?? []), submission]);
    }
    return groups;
  }, [orderedSubmissions]);
  const pageCount = Math.max(
    1,
    Math.ceil(orderedSubmissions.length / pageSize),
  );
  const currentPage = Math.min(page, pageCount);
  const paginatedSubmissions = orderedSubmissions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  async function retrySenderBatch(
    sender: string,
    items: InfobipTemplateSubmissionRow[],
  ) {
    setRetryingSender(sender);
    try {
      await onRetryFailed(items.map((item) => item.id));
    } finally {
      setRetryingSender(null);
    }
  }
  function toggleSender(sender: string) {
    setExpandedSenders((current) =>
      current.includes(sender)
        ? current.filter((item) => item !== sender)
        : [...current, sender],
    );
  }
  async function copyTemplateName(id: string, name: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(name);
      } else {
        const input = document.createElement("textarea");
        input.value = name;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopiedSubmissionId(id);
      window.setTimeout(() => setCopiedSubmissionId(null), 1800);
    } catch {
      const input = document.createElement("textarea");
      input.value = name;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      setCopiedSubmissionId(id);
      window.setTimeout(() => setCopiedSubmissionId(null), 1800);
    }
  }
  const filters = [
    { id: "all" as const, label: "Todos" },
    { id: "processing" as const, label: "Enviando" },
    { id: "sent" as const, label: "Enviados" },
    { id: "approved" as const, label: "Aprovados" },
    { id: "error" as const, label: "Com erro" },
  ];
  return (
    <section className={sectionClass}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Templates enviados e status da Meta
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Confira WABA, remetente, link, aprovação e possível mudança de
            Utilidade para Marketing.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={
              metaUpdated
                ? "inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
                : buttonClass
            }
            disabled={
              syncing || !submissions.some((item) => item.provider_template_id)
            }
            onClick={onRefresh}
          >
            {syncing ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : metaUpdated ? (
              <CheckCircle2 size={14} />
            ) : (
              <RefreshCw size={14} />
            )}{" "}
            {syncing
              ? "Verificando..."
              : metaUpdated
                ? "Atualizado"
                : "Verificar na Meta"}
          </button>
          <button className={buttonClass} onClick={onNew}>
            <Plus size={14} /> Novo
          </button>
        </div>
      </div>
      <div
        className="mb-4 flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3"
        role="tablist"
        aria-label="Filtrar templates enviados"
      >
        {filters.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => {
              setFilter(item.id);
              setPage(1);
              setExpandedSenders([]);
            }}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${filter === item.id ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"}`}
          >
            {item.label} ({counts[item.id]})
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <thead className="text-[var(--color-text-muted)]">
            <tr>
              <th className="pb-3">Modelo / template</th>
              <th>WABA</th>
              <th>Remetente</th>
              <th>Link de destino</th>
              <th>Envio</th>
              <th>Status Meta</th>
              <th>Categoria</th>
              <th>Última consulta</th>
            </tr>
          </thead>
          <tbody>
            {paginatedSubmissions.map((submission, index) => {
              const model = models.find(
                (item) => item.id === submission.model_id,
              );
              const sender = senders.find(
                (item) => item.id === submission.sender_id,
              );
              const providerStatus = (
                submission.provider_status || submission.status
              ).toUpperCase();
              const senderKey = submission.sender || "sem-remetente";
              const isFirstForSender =
                groupBySender &&
                (index === 0 ||
                  (paginatedSubmissions[index - 1].sender ||
                    "sem-remetente") !== senderKey);
              const senderItems = senderGroups.get(senderKey) ?? [submission];
              const failedSenderItems = senderItems.filter(isError);
              const isRetrying = retryingSender === senderKey;
              const isExpanded = expandedSenders.includes(senderKey);
              return (
                <Fragment key={submission.id}>
                  {isFirstForSender && (
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-panel-2)]/50">
                      <td colSpan={8} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-panel)]"
                              onClick={() => toggleSender(senderKey)}
                            >
                              {isExpanded ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                              Remetente: +
                              {senderKey === "sem-remetente"
                                ? "não informado"
                                : senderKey}
                            </button>
                            <span className="ml-2 text-[10px] text-[var(--color-text-muted)]">
                              {senderItems.length} template(s){" "}
                              {filter === "error"
                                ? "com erro"
                                : filter === "approved"
                                  ? "aprovado(s)"
                                  : filter === "sent"
                                    ? "enviado(s)"
                                    : "no total"}
                            </span>
                          </div>
                          {failedSenderItems.length > 0 &&
                            (filter === "error" || filter === "all") && (
                              <button
                                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={retryingSender !== null}
                                onClick={() =>
                                  void retrySenderBatch(
                                    senderKey,
                                    failedSenderItems,
                                  )
                                }
                              >
                                <RefreshCw
                                  size={13}
                                  className={isRetrying ? "animate-spin" : ""}
                                />
                                {isRetrying
                                  ? "Reenviando..."
                                  : `Reenviar erros (${failedSenderItems.length})`}
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {(!groupBySender || isExpanded) && (
                    <tr className="border-t border-[var(--color-border)]">
                      <td className="py-3 pr-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="font-semibold text-[var(--color-text)]">
                            {submission.resolved_name}
                          </span>
                          <button
                            type="button"
                            aria-label="Copiar nome do template"
                            title="Copiar nome do template"
                            className="cursor-pointer rounded p-1 text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                            onClick={() =>
                              void copyTemplateName(
                                submission.id,
                                submission.resolved_name,
                              )
                            }
                          >
                            {copiedSubmissionId === submission.id ? (
                              <Check size={12} className="text-emerald-400" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </span>
                        <p className="text-[10px] text-[var(--color-text-muted)]">
                          Modelo: {model?.display_name ?? "removido"}
                        </p>
                      </td>
                      <td className="pr-3">
                        <p>{sender?.waba_label || "Não informado"}</p>
                        <p className="text-[10px] text-[var(--color-text-faint)]">
                          {sender?.waba_id || "sem ID"}
                        </p>
                      </td>
                      <td className="pr-3">+{submission.sender}</td>
                      <td className="max-w-48 pr-3">
                        {submission.destination_url ? (
                          <a
                            href={submission.destination_url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sky-300"
                          >
                            {submission.destination_url}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <StatusBadge status={submission.status} />
                      </td>
                      <td>
                        <StatusBadge status={providerStatus} />
                        {submission.error_message && (
                          <p className="mt-1 max-w-64 text-[10px] text-red-300">
                            {submission.error_message}
                          </p>
                        )}
                      </td>
                      <td>
                        {submission.category_changed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 font-semibold text-red-300">
                            <AlertTriangle size={12} />{" "}
                            {submission.requested_category} →{" "}
                            {submission.provider_category}
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">
                            {submission.provider_category ||
                              submission.requested_category ||
                              model?.category ||
                              "—"}
                          </span>
                        )}
                      </td>
                      <td className="text-[var(--color-text-muted)]">
                        {submission.status_checked_at
                          ? new Date(
                              submission.status_checked_at,
                            ).toLocaleString("pt-BR")
                          : "Ainda não consultado"}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!visibleSubmissions.length && (
          <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
            {filter === "error"
              ? "Nenhum template com erro."
              : filter === "processing"
                ? "Nenhum template em envio."
                : filter === "sent"
                  ? "Nenhum template enviado ainda."
                  : "Nenhum template enviado."}
          </div>
        )}
      </div>
      {visibleSubmissions.length > pageSize && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-muted)]">
          <span>
            Mostrando {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, visibleSubmissions.length)} de{" "}
            {visibleSubmissions.length} template(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              className={buttonClass}
              disabled={currentPage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <span>
              Página {currentPage} de {pageCount}
            </span>
            <button
              className={buttonClass}
              disabled={currentPage === pageCount}
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const good = ["SENT", "APPROVED", "ACTIVE"].includes(normalized);
  const bad = ["FAILED", "REJECTED", "DISABLED"].includes(normalized);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${good ? "bg-emerald-500/10 text-emerald-300" : bad ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}
    >
      {good ? (
        <CheckCircle2 size={12} />
      ) : bad ? (
        <XCircle size={12} />
      ) : (
        <LoaderCircle size={12} />
      )}
      {normalized === "SENT"
        ? "Enviado"
        : normalized === "APPROVED"
          ? "Aprovado"
          : normalized === "ACTIVE"
            ? "Ativo"
            : normalized}
    </span>
  );
}
