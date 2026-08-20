import { useEffect, useId, useRef, useState } from 'react';
import {
  X,
  Trash2,
  Loader2,
  Plus,
  Image as ImageIcon,
  Video,
  User,
  Upload,
  Link2,
  Check,
  ArrowRight,
  Download,
  FileSpreadsheet,
  UserPlus,
  Info,
  Copy,
  PhoneCall,
  Tags,
  ListFilter,
  MessageSquareText,
  Paperclip,
  DollarSign,
} from 'lucide-react';
import type { ClientRow, DisparoTagRow } from '../../integrations/supabase/database.types';
import {
  uploadDisparoMedia,
  removeDisparoMedia,
  disparoChecklistStages,
  nextStage,
  portalDisparoBlockReason,
  requestClientPortalAdjustment,
  approveClientPortalDemand,
  type DisparoTaskInput,
  type DisparoNumberInput,
  type DisparoTaskWithRelations,
  type DisparoMediaKind,
} from '../../services/disparoTasks.service';
import { createClientDemandFileUrl } from '../../services/clientDemandPortal.service';
import {
  ensureWithinInfobipLimit,
  prepareCampaignImage,
  prepareProfilePhoto,
  validateMediaType,
} from '../../lib/disparoMedia';
import {
  DEFAULT_SUPPLIER_UNIT_COST,
  getDisparoFinancialSettings,
} from '../../services/disparoFinance.service';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';
const sectionBaseClass = 'flex flex-col gap-3 rounded-xl border border-l-4 p-4';
const sectionStyles = {
  api: 'border-blue-500/30 border-l-blue-400 bg-blue-500/[0.045]',
  tags: 'border-violet-500/30 border-l-violet-400 bg-violet-500/[0.045]',
  links: 'border-cyan-500/30 border-l-cyan-400 bg-cyan-500/[0.045]',
  message: 'border-amber-500/30 border-l-amber-400 bg-amber-500/[0.045]',
  files: 'border-emerald-500/30 border-l-emerald-400 bg-emerald-500/[0.045]',
  finance: 'border-teal-500/30 border-l-teal-400 bg-teal-500/[0.045]',
} as const;
const sectionTitleClass = 'flex items-center gap-2 text-xs font-semibold uppercase tracking-wide';

const tagPresets = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#64748b'];

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const unitCostFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const MAX_QUANTITY = Number.MAX_SAFE_INTEGER;
const MAX_CLIENT_REVENUE = 999_999_999_999.99;
const MAX_SUPPLIER_UNIT_COST = 99_999_999.9999;

function roundTo(value: number, decimalPlaces: number) {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function financialValidationError(form: DisparoTaskInput) {
  if (!Number.isSafeInteger(form.contracted_quantity) || form.contracted_quantity < 0) {
    return 'A quantidade contratada deve ser um número inteiro maior ou igual a zero.';
  }
  if (!Number.isSafeInteger(form.sent_quantity) || form.sent_quantity < 0) {
    return 'A quantidade enviada deve ser um número inteiro maior ou igual a zero.';
  }
  if (
    !Number.isFinite(form.supplier_unit_cost) ||
    form.supplier_unit_cost < 0 ||
    form.supplier_unit_cost > MAX_SUPPLIER_UNIT_COST
  ) {
    return 'O custo unitário deve estar entre zero e R$ 99.999.999,9999.';
  }
  if (
    !Number.isFinite(form.client_revenue) ||
    form.client_revenue < 0 ||
    form.client_revenue > MAX_CLIENT_REVENUE
  ) {
    return 'O valor cobrado deve estar entre zero e R$ 999.999.999.999,99.';
  }
  return null;
}

function readableTextColor(background: string) {
  const hex = background.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const darkContrast = (luminance + 0.05) / 0.053;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? '#0a0b0f' : '#ffffff';
}

function CopyField({
  label,
  value,
  placeholder,
  onChange,
  emphasized = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  emphasized?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const inputId = useId();

  async function copyValue() {
    if (!value.trim()) return;
    await navigator.clipboard.writeText(value.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          className={`${inputClass} pr-11 font-mono ${
            emphasized ? 'border-[var(--color-brand)] font-semibold' : ''
          }`}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          onClick={() => void copyValue()}
          disabled={!value.trim()}
          title={`Copiar ${label.toLowerCase()}`}
          className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand)] disabled:cursor-not-allowed disabled:text-[var(--color-border)]"
        >
          {copied ? <Check size={15} className="text-[var(--color-good)]" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

function PortalSummary({ label, value, emphasis }: { label: string; value: string; emphasis?: 'good' | 'warn' }) {
  return (
    <div className="rounded-lg border border-sky-500/15 bg-[var(--color-bg)]/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{label}</p>
      <p className={`mt-1 truncate text-xs font-medium ${emphasis === 'warn' ? 'text-[var(--color-warn)]' : emphasis === 'good' ? 'text-[var(--color-good)]' : 'text-[var(--color-text)]'}`}>{value}</p>
    </div>
  );
}

function PrivatePortalAsset({ label, url, image = false }: { label: string; url: string | null; image?: boolean }) {
  if (!url) return null;
  return <a href={url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 rounded-lg border border-sky-500/20 bg-[var(--color-bg)]/70 p-2 text-xs text-sky-300 hover:border-sky-400/60">{image && <img src={url} alt={label} className="h-9 w-9 rounded object-cover" />}<span>{label}</span><Download size={13} className="opacity-60 group-hover:opacity-100" /></a>;
}

function emptyInput(): DisparoTaskInput {
  return {
    title: '',
    client_id: null,
    scheduled_date: null,
    scheduled_time: null,
    contact_list_ref: null,
    list_tag: null,
    full_link: null,
    short_link: null,
    instagram: null,
    copy_text: null,
    copy_approved: false,
    final_report: null,
    contracted_quantity: 0,
    sent_quantity: 0,
    client_revenue: 0,
    supplier_unit_cost: DEFAULT_SUPPLIER_UNIT_COST,
    checklist: {},
    numbers: [],
    tagIds: [],
  };
}

function toInput(task: DisparoTaskWithRelations): DisparoTaskInput {
  return {
    title: task.title,
    client_id: task.client_id,
    scheduled_date: task.scheduled_date,
    scheduled_time: task.scheduled_time,
    contact_list_ref: task.contact_list_ref,
    list_tag: task.list_tag,
    full_link: task.full_link,
    short_link: task.short_link,
    instagram: task.instagram,
    copy_text: task.copy_text,
    copy_approved: task.copy_approved,
    final_report: task.final_report,
    contracted_quantity: task.contracted_quantity,
    sent_quantity: task.sent_quantity,
    client_revenue: task.client_revenue,
    supplier_unit_cost: task.supplier_unit_cost,
    checklist: task.checklist,
    numbers: task.disparo_task_numbers.map((n) => ({
      waba_label: n.waba_label,
      number: n.number,
      name: n.name,
      is_test: n.is_test,
    })),
    tagIds: task.disparo_task_tags.map((t) => t.tag_id),
  };
}

function MediaSlot({
  kind,
  label,
  description,
  icon,
  url,
  fileName,
  uploading,
  disabled,
  onUpload,
  onRemove,
}: {
  kind: DisparoMediaKind;
  label: string;
  description: string;
  icon: React.ReactNode;
  url: string | null;
  fileName?: string | null;
  uploading: boolean;
  disabled: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isVideo = kind === 'video';
  const isFile = kind === 'contact_list';
  const accept = isVideo
    ? 'video/*'
    : isFile
      ? '.csv,.txt,.xls,.xlsx,.zip,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'image/*';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (disabled) return;
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onUpload(file);
      }}
      className={`flex min-h-64 flex-col gap-3 rounded-xl p-3 transition-colors ${
        dragOver
          ? 'bg-emerald-500/10 ring-2 ring-emerald-400/60'
          : 'bg-[var(--color-bg)]/75'
      }`}
    >
      <div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-text-muted)]">{description}</p>
      </div>
      <div className="flex min-h-28 flex-1 items-center justify-center overflow-hidden rounded-lg bg-[var(--color-panel-2)]">
        {url ? (
          isVideo ? (
          <video src={url} controls className="h-32 w-full object-cover" />
        ) : isFile ? (
          <div className="flex flex-col items-center gap-2 px-3 text-center text-[var(--color-good)]">
            <FileSpreadsheet size={34} />
            <span className="max-w-full truncate text-xs text-[var(--color-text-muted)]">
              {fileName ?? 'Lista anexada'}
            </span>
          </div>
        ) : (
          <img src={url} alt={label} className="h-32 w-full object-cover" />
        )
      ) : (
        <div className="flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
          {icon}
          <span className="text-[11px]">Arraste ou selecione</span>
        </div>
      )}
      </div>
      <div className="grid w-full grid-cols-2 gap-2">
        <label className={`col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-2 text-xs font-medium text-emerald-300 transition-colors focus-within:ring-2 focus-within:ring-emerald-400/60 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-emerald-500/15 hover:text-emerald-200'}`}>
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {url ? 'Trocar arquivo' : 'Anexar arquivo'}
          <input
            type="file"
            accept={accept}
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
        </label>
        {url && (
          <>
            <button
              onClick={() => void handleCopyLink()}
              className="flex items-center justify-center gap-1 rounded-lg bg-[var(--color-panel-2)] py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              {copied ? <Check size={12} className="text-[var(--color-good)]" /> : <Link2 size={12} />}
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
            <a
              href={url}
              download={fileName ?? label}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1 rounded-lg bg-[var(--color-panel-2)] py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <Download size={12} />
              Baixar
            </a>
            <button
              onClick={onRemove}
              disabled={disabled}
              className="col-span-2 text-[11px] text-[var(--color-bad)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)] disabled:no-underline"
            >
              Remover arquivo
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function DisparoTaskModal({
  task,
  clients,
  tags,
  onCreateClient,
  onCreateTag,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onSaved,
  onAdvance,
}: {
  task: DisparoTaskWithRelations | null;
  clients: ClientRow[];
  tags: DisparoTagRow[];
  onCreateClient: (name: string) => Promise<ClientRow>;
  onCreateTag: (name: string, color: string) => Promise<DisparoTagRow>;
  onClose: () => void;
  onCreate: (input: DisparoTaskInput) => Promise<DisparoTaskWithRelations>;
  onUpdate: (id: string, input: DisparoTaskInput) => Promise<DisparoTaskWithRelations>;
  onDelete: (id: string) => Promise<void>;
  onSaved: (row: DisparoTaskWithRelations) => void;
  onAdvance: (task: DisparoTaskWithRelations) => Promise<DisparoTaskWithRelations | null>;
}) {
  const [localTask, setLocalTask] = useState<DisparoTaskWithRelations | null>(task);
  const [form, setForm] = useState<DisparoTaskInput>(task ? toInput(task) : emptyInput());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<DisparoMediaKind | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(tagPresets[0]);
  const [creatingTag, setCreatingTag] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [copiedNumbers, setCopiedNumbers] = useState(false);
  const [loadingFinancialDefault, setLoadingFinancialDefault] = useState(!task);
  const [financialDefaultError, setFinancialDefaultError] = useState<string | null>(null);
  const [financialDefaultReviewed, setFinancialDefaultReviewed] = useState(Boolean(task));
  const [usingFinancialFallback, setUsingFinancialFallback] = useState(false);
  const supplierCostTouched = useRef(false);
  const mutationLock = useRef(false);
  const formRef = useRef(form);
  const localTaskRef = useRef(localTask);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosavePending = useRef(false);
  const autosaveSnapshot = useRef<DisparoTaskInput | null>(null);
  const savedFormSignature = useRef(JSON.stringify(task ? toInput(task) : emptyInput()));
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [feedbackComment, setFeedbackComment] = useState(task?.client_feedback_comment ?? '');
  const [returningPending, setReturningPending] = useState(false);
  const [approvingPortal, setApprovingPortal] = useState(false);
  const [portalAssetUrls, setPortalAssetUrls] = useState<{ photo: string | null; cover: string | null; list: string | null }>({ photo: null, cover: null, list: null });

  const isMutating =
    saving || deleting || advancing || uploadingKind !== null || creatingTag || creatingClient || returningPending || approvingPortal;

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    localTaskRef.current = localTask;
  }, [localTask]);

  useEffect(() => {
    let active = true;
    if (localTask?.request_source !== 'client_portal') {
      setPortalAssetUrls({ photo: null, cover: null, list: null });
      return () => { active = false; };
    }
    void Promise.all([
      localTask.profile_photo_path ? createClientDemandFileUrl(localTask.profile_photo_path) : Promise.resolve(null),
      localTask.profile_cover_path ? createClientDemandFileUrl(localTask.profile_cover_path) : Promise.resolve(null),
      localTask.source_list_path ? createClientDemandFileUrl(localTask.source_list_path) : Promise.resolve(null),
    ]).then(([photo, cover, list]) => { if (active) setPortalAssetUrls({ photo, cover, list }); }).catch(() => { if (active) setPortalAssetUrls({ photo: null, cover: null, list: null }); });
    return () => { active = false; };
  }, [localTask?.id, localTask?.profile_photo_path, localTask?.profile_cover_path, localTask?.source_list_path, localTask?.request_source]);

  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
  }, []);

  useEffect(() => {
    if (localTask) {
      setLoadingFinancialDefault(false);
      setFinancialDefaultReviewed(true);
      return;
    }
    let cancelled = false;

    void getDisparoFinancialSettings()
      .then((settings) => {
        if (cancelled || supplierCostTouched.current) return;
        setForm((previous) => ({
          ...previous,
          supplier_unit_cost: settings.supplier_unit_cost,
        }));
        setFinancialDefaultReviewed(true);
        setFinancialDefaultError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setFinancialDefaultError('Não foi possível carregar o custo padrão. Revise o valor antes de salvar.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFinancialDefault(false);
      });

    return () => {
      cancelled = true;
    };
  }, [localTask]);

  const supplierCost = roundTo(form.sent_quantity * form.supplier_unit_cost, 2);
  const clientRevenue = roundTo(form.sent_quantity * form.client_revenue, 2);
  const grossProfit = roundTo(clientRevenue - supplierCost, 2);
  const grossMargin = clientRevenue > 0 ? (grossProfit / clientRevenue) * 100 : null;

  function normalizedInput(source: DisparoTaskInput): DisparoTaskInput {
    return {
      ...source,
      title: source.title.trim(),
      numbers: source.numbers.filter((number) => number.number.trim()),
      client_revenue: roundTo(source.client_revenue, 2),
      supplier_unit_cost: roundTo(source.supplier_unit_cost, 4),
    };
  }

  function formSignature(source: DisparoTaskInput) {
    return JSON.stringify(normalizedInput(source));
  }

  async function flushAutosave() {
    autosavePending.current = false;
    const currentTask = localTaskRef.current;
    if (!currentTask) return;
    if (mutationLock.current || loadingFinancialDefault || !financialDefaultReviewed) {
      autosavePending.current = true;
      autosaveTimer.current = setTimeout(() => void flushAutosave(), 400);
      return;
    }

    const snapshot = autosaveSnapshot.current ?? formRef.current;
    const snapshotSignature = formSignature(snapshot);
    if (snapshotSignature === savedFormSignature.current) return;
    if (!snapshot.title.trim()) {
      setError('Dá um nome pro evento do disparo.');
      return;
    }
    const financeError = financialValidationError(snapshot);
    if (financeError) {
      setError(financeError);
      return;
    }

    mutationLock.current = true;
    setSaving(true);
    setAutosaveState('saving');
    setError(null);
    try {
      const saved = await onUpdate(currentTask.id, normalizedInput(snapshot));
      const savedForm = toInput(saved);
      savedFormSignature.current = formSignature(savedForm);
      setLocalTask(saved);
      localTaskRef.current = saved;
      if (formSignature(formRef.current) === snapshotSignature) {
        formRef.current = savedForm;
        setForm(savedForm);
      }
      onSaved(saved);
      setAutosaveState('saved');
    } catch (e) {
      setAutosaveState('idle');
      setError(e instanceof Error ? e.message : 'Não foi possível salvar automaticamente.');
    } finally {
      setSaving(false);
      mutationLock.current = false;
      if (autosavePending.current) {
        autosaveTimer.current = setTimeout(() => void flushAutosave(), 350);
      }
    }
  }

  function scheduleAutosave(target: EventTarget | null) {
    if (!localTaskRef.current || !(target instanceof HTMLElement)) return;
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (target instanceof HTMLInputElement && target.type === 'file') return;
    if (target.id === 'disparo-new-client' || target.id === 'disparo-new-tag-name') return;
    autosaveSnapshot.current = formRef.current;
    autosavePending.current = true;
    setAutosaveState('idle');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void flushAutosave(), 350);
  }

  function set<K extends keyof DisparoTaskInput>(key: K, value: DisparoTaskInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateNumber(index: number, patch: Partial<DisparoNumberInput>) {
    setForm((prev) => ({
      ...prev,
      numbers: prev.numbers.map((n, i) => (i === index ? { ...n, ...patch } : n)),
    }));
  }

  function addNumber() {
    setForm((prev) => ({
      ...prev,
      numbers: [...prev.numbers, { waba_label: null, number: '', name: null, is_test: prev.numbers.length === 0 }],
    }));
  }

  function removeNumber(index: number) {
    setForm((prev) => ({ ...prev, numbers: prev.numbers.filter((_, i) => i !== index) }));
  }

  async function copyAllNumbers() {
    const text = form.numbers
      .filter((number) => number.number.trim())
      .map((number) =>
        [number.waba_label, number.number, number.name].filter((value) => value?.trim()).join(' · ')
      )
      .join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedNumbers(true);
    setTimeout(() => setCopiedNumbers(false), 1400);
  }

  function toggleTag(tagId: string) {
    setForm((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
  }

  async function handleCreateTag() {
    if (!newTagName.trim() || mutationLock.current || isMutating) return;
    mutationLock.current = true;
    setCreatingTag(true);
    try {
      const tag = await onCreateTag(newTagName.trim(), newTagColor);
      set('tagIds', [...form.tagIds, tag.id]);
      setNewTagName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar a etiqueta.');
    } finally {
      setCreatingTag(false);
      mutationLock.current = false;
    }
  }

  async function handleCreateClient() {
    const name = newClientName.trim();
    if (!name || mutationLock.current || isMutating) return;
    mutationLock.current = true;
    setCreatingClient(true);
    setError(null);
    try {
      const client = await onCreateClient(name);
      set('client_id', client.id);
      setNewClientName('');
      setShowNewClient(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível cadastrar o cliente.');
    } finally {
      setCreatingClient(false);
      mutationLock.current = false;
    }
  }

  async function handleSave() {
    if (mutationLock.current || isMutating) return;
    if (loadingFinancialDefault) {
      setError('Aguarde o carregamento do custo padrão antes de salvar.');
      return;
    }
    if (!financialDefaultReviewed) {
      setError('Revise ou confirme o custo unitário antes de salvar.');
      return;
    }
    if (!form.title.trim()) {
      setError('Dá um nome pro evento do disparo.');
      return;
    }
    const financeError = financialValidationError(form);
    if (financeError) {
      setError(financeError);
      return;
    }
    mutationLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const input = normalizedInput(form);
      const saved = localTask ? await onUpdate(localTask.id, input) : await onCreate(input);
      setLocalTask(saved);
      localTaskRef.current = saved;
      const savedForm = toInput(saved);
      savedFormSignature.current = formSignature(savedForm);
      formRef.current = savedForm;
      setForm(savedForm);
      onSaved(saved);
      setAutosaveState('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o card.');
    } finally {
      setSaving(false);
      mutationLock.current = false;
    }
  }

  async function handleAdvanceClick() {
    if (!localTask || mutationLock.current || isMutating) return;
    if (!form.title.trim()) {
      setError('Dá um nome pro evento do disparo.');
      return;
    }
    const portalReason = next && (next === 'disparo' || next === 'finalizado')
      ? portalDisparoBlockReason(localTask)
      : null;
    if (portalReason) {
      setError(portalReason);
      return;
    }
    const financeError = financialValidationError(form);
    if (financeError) {
      setError(financeError);
      return;
    }
    mutationLock.current = true;
    setAdvancing(true);
    setError(null);
    try {
      const input = normalizedInput(form);
      const saved = await onUpdate(localTask.id, input);
      setLocalTask(saved);
      localTaskRef.current = saved;
      const savedForm = toInput(saved);
      savedFormSignature.current = formSignature(savedForm);
      formRef.current = savedForm;
      setForm(savedForm);
      onSaved(saved);

      const advanced = await onAdvance(saved);
      if (advanced) {
        setLocalTask(advanced);
        localTaskRef.current = advanced;
        const advancedForm = toInput(advanced);
        savedFormSignature.current = formSignature(advancedForm);
        formRef.current = advancedForm;
        setForm(advancedForm);
        onSaved(advanced);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível avançar de etapa.');
    } finally {
      setAdvancing(false);
      mutationLock.current = false;
    }
  }

  async function handleDelete() {
    if (!localTask || mutationLock.current || isMutating) return;
    mutationLock.current = true;
    setDeleting(true);
    try {
      await onDelete(localTask.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setDeleting(false);
      mutationLock.current = false;
    }
  }

  async function handleReturnPending() {
    if (!localTask || localTask.request_source !== 'client_portal' || mutationLock.current || isMutating) return;
    if (!feedbackComment.trim()) {
      setError('Descreva a pendência antes de devolver ao cliente.');
      return;
    }
    mutationLock.current = true;
    setReturningPending(true);
    setError(null);
    try {
      const updated = await requestClientPortalAdjustment(localTask.id, feedbackComment);
      setLocalTask(updated);
      localTaskRef.current = updated;
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível devolver a pendência.');
    } finally {
      setReturningPending(false);
      mutationLock.current = false;
    }
  }

  async function handleApprovePortalDemand() {
    if (!localTask || localTask.request_source !== 'client_portal' || mutationLock.current || isMutating) return;
    mutationLock.current = true;
    setApprovingPortal(true);
    setError(null);
    try {
      const updated = await approveClientPortalDemand(localTask.id);
      setLocalTask(updated);
      localTaskRef.current = updated;
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível aprovar a demanda.');
    } finally {
      setApprovingPortal(false);
      mutationLock.current = false;
    }
  }

  async function handleUpload(kind: DisparoMediaKind, file: File) {
    if (!localTask || mutationLock.current || isMutating) return;
    mutationLock.current = true;
    setUploadingKind(kind);
    setError(null);
    try {
      validateMediaType(kind, file);
      let toSend = file;
      if (kind === 'profile_photo') toSend = await prepareProfilePhoto(file);
      else if (kind === 'image') toSend = await prepareCampaignImage(file);
      else ensureWithinInfobipLimit(file);
      const updated = await uploadDisparoMedia(localTask.id, kind, toSend);
      const merged = { ...localTask, ...updated };
      setLocalTask(merged);
      onSaved(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.');
    } finally {
      setUploadingKind(null);
      mutationLock.current = false;
    }
  }

  async function handleRemoveMedia(kind: DisparoMediaKind) {
    if (!localTask || mutationLock.current || isMutating) return;
    mutationLock.current = true;
    setUploadingKind(kind);
    setError(null);
    try {
      const updated = await removeDisparoMedia(localTask.id, kind);
      const merged = { ...localTask, ...updated };
      setLocalTask(merged);
      onSaved(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível remover o arquivo.');
    } finally {
      setUploadingKind(null);
      mutationLock.current = false;
    }
  }

  const next = localTask ? nextStage(localTask.status) : null;
  const nextLabel = next ? disparoChecklistStages.find((s) => s.key === next)?.label : null;
  const portalAdvanceBlock = localTask && next && (next === 'disparo' || next === 'finalizado')
    ? portalDisparoBlockReason(localTask)
    : null;

  return (
    <div className="disparo-task-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="disparo-task-modal-title"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 id="disparo-task-modal-title" className="text-sm font-medium text-[var(--color-text)]">
              {localTask ? 'Editar disparo' : 'Novo disparo'}
            </h3>
            {localTask && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-faint)]">
                <p>
                  Etapa atual:{' '}
                  <span className="text-[var(--color-brand)]">
                    {disparoChecklistStages.find((s) => s.key === localTask.status)?.label}
                  </span>
                </p>
                <p aria-live="polite" className="flex items-center gap-1">
                  {autosaveState === 'saving' || saving ? (
                    <><Loader2 size={11} className="animate-spin" /> Salvando automaticamente…</>
                  ) : autosaveState === 'saved' ? (
                    <><Check size={11} className="text-[var(--color-good)]" /> Alterações salvas</>
                  ) : (
                    'Salva ao sair do campo'
                  )}
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isMutating}
            aria-label="Fechar modal"
            className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4" onBlurCapture={(event) => scheduleAutosave(event.target)}>
          <div>
            <label htmlFor="disparo-event-title" className={labelClass}>Evento</label>
            <input
              id="disparo-event-title"
              className={inputClass}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Ex: Campanha Black Friday"
              autoFocus
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor={showNewClient ? 'disparo-new-client' : 'disparo-client'} className="text-xs font-medium text-[var(--color-text-muted)]">Cliente</label>
                <button
                  type="button"
                  onClick={() => setShowNewClient((value) => !value)}
                  className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline"
                >
                  <UserPlus size={12} />
                  Novo cliente
                </button>
              </div>
              {showNewClient ? (
                <div className="flex gap-1.5">
                  <input
                    id="disparo-new-client"
                    className={inputClass}
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateClient();
                    }}
                    placeholder="Nome do cliente"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateClient()}
                    disabled={isMutating || !newClientName.trim()}
                    className="rounded-lg bg-[var(--color-brand)] px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)]"
                  >
                    {creatingClient ? <Loader2 size={14} className="animate-spin" /> : 'Criar'}
                  </button>
                </div>
              ) : (
                <select
                  id="disparo-client"
                  className={inputClass}
                  value={form.client_id ?? ''}
                  onChange={(e) => set('client_id', e.target.value || null)}
                >
                  <option value="">Selecione</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label htmlFor="disparo-date" className={labelClass}>Data</label>
              <input
                id="disparo-date"
                type="date"
                className={inputClass}
                value={form.scheduled_date ?? ''}
                onChange={(e) => set('scheduled_date', e.target.value || null)}
              />
            </div>
            <div>
              <label htmlFor="disparo-time" className={labelClass}>Horário</label>
              <input
                id="disparo-time"
                type="time"
                className={inputClass}
                value={form.scheduled_time ?? ''}
                onChange={(e) => set('scheduled_time', e.target.value || null)}
              />
            </div>
          </div>

          {localTask?.request_source === 'client_portal' && (
            <section className={`${sectionBaseClass} border-sky-500/30 border-l-sky-400 bg-sky-500/[0.045]`} aria-labelledby="portal-demand-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sky-300">
                    <Info size={15} />
                    <h4 id="portal-demand-title" className="text-sm font-semibold">Recebido pelo portal do cliente</h4>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Snapshot enviado pelo cliente. Sender, etiqueta e template continuam definidos pela agência.</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${localTask.client_portal_status === 'action_required' ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' : 'bg-sky-500/15 text-sky-300'}`}>{localTask.client_portal_status === 'action_required' ? 'Aguardando ajuste do cliente' : 'Demanda enviada'}</span>
              </div>
              <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <PortalSummary label="Perfil / DDD" value={[localTask.profile_name_snapshot, localTask.profile_ddd_snapshot ? `DDD ${localTask.profile_ddd_snapshot}` : null].filter(Boolean).join(' · ') || 'Não informado'} />
                <PortalSummary label="Lista higienizada" value={localTask.source_list_file_name ?? 'Não anexada'} />
                <PortalSummary label="Contatos válidos" value={`${localTask.list_valid_count.toLocaleString('pt-BR')} de ${localTask.list_original_count.toLocaleString('pt-BR')}`} emphasis={localTask.list_valid_count < 1000 ? 'warn' : 'good'} />
                <PortalSummary label="Removidos" value={`${localTask.list_invalid_count.toLocaleString('pt-BR')} inválidos · ${localTask.list_duplicate_count.toLocaleString('pt-BR')} duplicados`} />
              </div>
              {(portalAssetUrls.photo || portalAssetUrls.cover || portalAssetUrls.list) && <div className="flex flex-wrap gap-3"><PrivatePortalAsset label="Foto de perfil" url={portalAssetUrls.photo} image /><PrivatePortalAsset label="Foto de capa" url={portalAssetUrls.cover} image /><PrivatePortalAsset label="Baixar lista higienizada" url={portalAssetUrls.list} /></div>}
              {localTask.full_link && <a href={localTask.full_link} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 truncate text-xs text-sky-300 hover:underline"><Link2 size={13} /> {localTask.full_link}</a>}
              {localTask.copy_text && <div className="rounded-lg bg-[var(--color-bg)]/70 p-3 text-xs leading-5 text-[var(--color-text-muted)]"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Copy recebida</span>{localTask.copy_text}</div>}
              {localTask.client_notes && <div className="rounded-lg bg-[var(--color-bg)]/70 p-3 text-xs leading-5 text-[var(--color-text-muted)]"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Observações do cliente</span>{localTask.client_notes}</div>}
              {localTask.list_valid_count < 1000 && <p className="rounded-lg bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">Esta demanda não pode entrar em Disparo: faltam {(1000 - localTask.list_valid_count).toLocaleString('pt-BR')} contatos válidos.</p>}
              <div className="border-t border-sky-500/15 pt-3">
                <label htmlFor="client-feedback-comment" className={labelClass}>Devolver pendência ao cliente</label>
                <div className="flex flex-col gap-2 sm:flex-row"><textarea id="client-feedback-comment" rows={2} value={feedbackComment} onChange={(event) => setFeedbackComment(event.target.value)} placeholder="Ex.: envie uma lista com pelo menos 1.000 contatos válidos." className={`${inputClass} flex-1 resize-y`} /><button type="button" onClick={() => void handleReturnPending()} disabled={isMutating || !feedbackComment.trim()} className="self-end rounded-lg border border-[var(--color-warn)] px-3 py-2 text-xs font-medium text-[var(--color-warn)] hover:bg-[var(--color-warn-soft)] disabled:cursor-not-allowed disabled:border-[var(--color-border)] disabled:text-[var(--color-text-faint)]">{returningPending ? <Loader2 size={14} className="animate-spin" /> : 'Enviar pendência'}</button></div>
                {localTask.client_portal_status !== 'approved' && <button type="button" onClick={() => void handleApprovePortalDemand()} disabled={isMutating} className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--color-good)] px-3 py-2 text-xs font-medium text-[var(--color-good)] hover:bg-[var(--color-good-soft)] disabled:cursor-not-allowed disabled:border-[var(--color-border)] disabled:text-[var(--color-text-faint)]">{approvingPortal ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Aprovar demanda para avanço</button>}
                {localTask.client_portal_status === 'action_required' && localTask.client_feedback_at && <p className="mt-2 text-[11px] text-[var(--color-warn)]">Pendência enviada ao cliente em {new Date(localTask.client_feedback_at).toLocaleString('pt-BR')}.</p>}
              </div>
            </section>
          )}

          <section className={`${sectionBaseClass} ${sectionStyles.finance}`} aria-labelledby="disparo-finance-title">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
                  <DollarSign size={15} />
                </span>
                <h4 id="disparo-finance-title" className="text-sm font-semibold text-[var(--color-text)]">
                  Financeiro
                </h4>
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                Registre os valores desta demanda. Custo, lucro e margem são calculados automaticamente.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="disparo-contracted-quantity" className={labelClass}>
                  Quantidade contratada
                </label>
                <input
                  id="disparo-contracted-quantity"
                  type="number"
                  min="0"
                  max={MAX_QUANTITY}
                  step="1"
                  inputMode="numeric"
                  aria-invalid={
                    !Number.isSafeInteger(form.contracted_quantity) || form.contracted_quantity < 0
                  }
                  aria-describedby="disparo-finance-limits"
                  className={inputClass}
                  value={form.contracted_quantity}
                  onChange={(event) =>
                    set(
                      'contracted_quantity',
                      Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber
                    )
                  }
                />
              </div>
              <div>
                <label htmlFor="disparo-sent-quantity" className={labelClass}>
                  Mensagens entregues
                </label>
                <input
                  id="disparo-sent-quantity"
                  type="number"
                  min="0"
                  max={MAX_QUANTITY}
                  step="1"
                  inputMode="numeric"
                  aria-invalid={!Number.isSafeInteger(form.sent_quantity) || form.sent_quantity < 0}
                  aria-describedby="disparo-finance-limits"
                  className={inputClass}
                  value={form.sent_quantity}
                  onChange={(event) =>
                    set(
                      'sent_quantity',
                      Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber
                    )
                  }
                />
              </div>
              <div>
                <label htmlFor="disparo-supplier-unit-cost" className={labelClass}>
                  Custo unitário total
                </label>
                <input
                  id="disparo-supplier-unit-cost"
                  type="number"
                  min="0"
                  max={MAX_SUPPLIER_UNIT_COST}
                  step="0.0001"
                  inputMode="decimal"
                  aria-invalid={
                    !Number.isFinite(form.supplier_unit_cost) ||
                    form.supplier_unit_cost < 0 ||
                    form.supplier_unit_cost > MAX_SUPPLIER_UNIT_COST ||
                    !financialDefaultReviewed
                  }
                  aria-describedby="disparo-supplier-cost-help disparo-finance-limits"
                  className={inputClass}
                  value={form.supplier_unit_cost}
                  onChange={(event) => {
                    supplierCostTouched.current = true;
                    setFinancialDefaultReviewed(true);
                    setFinancialDefaultError(null);
                    setUsingFinancialFallback(false);
                    setError(null);
                    set(
                      'supplier_unit_cost',
                      Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber
                    );
                  }}
                />
                <p
                  id="disparo-supplier-cost-help"
                  className={`mt-1 text-[10px] ${financialDefaultError ? 'text-[var(--color-bad)]' : 'text-[var(--color-text-muted)]'}`}
                >
                  {localTask
                    ? `Snapshot salvo: ${unitCostFormatter.format(form.supplier_unit_cost)} por envio.`
                    : loadingFinancialDefault
                      ? 'Carregando custo padrão da organização…'
                      : financialDefaultError
                        ? financialDefaultError
                        : usingFinancialFallback
                          ? `Fallback confirmado: ${unitCostFormatter.format(form.supplier_unit_cost)} por envio.`
                          : `Padrão da organização: ${unitCostFormatter.format(form.supplier_unit_cost)} por envio.`}
                </p>
                {financialDefaultError && !financialDefaultReviewed && (
                  <button
                    type="button"
                    onClick={() => {
                      supplierCostTouched.current = true;
                      set('supplier_unit_cost', DEFAULT_SUPPLIER_UNIT_COST);
                      setFinancialDefaultReviewed(true);
                      setUsingFinancialFallback(true);
                      setFinancialDefaultError(null);
                      setError(null);
                    }}
                    className="mt-1 rounded-md border border-teal-500/30 px-2 py-1 text-[10px] font-medium text-teal-200 hover:bg-teal-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
                  >
                    Confirmar fallback de {unitCostFormatter.format(DEFAULT_SUPPLIER_UNIT_COST)}
                  </button>
                )}
              </div>
              <div>
                <label htmlFor="disparo-client-revenue" className={labelClass}>
                  Preço por mensagem entregue
                </label>
                <input
                  id="disparo-client-revenue"
                  type="number"
                  min="0"
                  max={MAX_CLIENT_REVENUE}
                  step="0.01"
                  inputMode="decimal"
                  aria-invalid={
                    !Number.isFinite(form.client_revenue) ||
                    form.client_revenue < 0 ||
                    form.client_revenue > MAX_CLIENT_REVENUE
                  }
                  aria-describedby="disparo-finance-limits"
                  className={inputClass}
                  value={form.client_revenue}
                  onChange={(event) =>
                    set(
                      'client_revenue',
                      Number.isNaN(event.currentTarget.valueAsNumber) ? 0 : event.currentTarget.valueAsNumber
                    )
                  }
                />
              </div>
            </div>

            <p id="disparo-finance-limits" className="sr-only">
              Quantidades devem ser números inteiros não negativos. O preço por mensagem aceita até duas casas decimais e
              custo unitário aceita até quatro casas decimais.
            </p>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-teal-500/15 bg-black/10 px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Receita total
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{brlFormatter.format(clientRevenue)}</p>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  {form.sent_quantity.toLocaleString('pt-BR')} entregues × {brlFormatter.format(form.client_revenue)}
                </p>
              </div>
              <div className="rounded-lg border border-teal-500/15 bg-black/10 px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Custo total da operação
                </p>
                <p className="mt-1 text-sm font-semibold text-teal-200">{brlFormatter.format(supplierCost)}</p>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  {form.sent_quantity.toLocaleString('pt-BR')} entregues × {unitCostFormatter.format(form.supplier_unit_cost)}
                </p>
              </div>
              <div className="rounded-lg border border-teal-500/15 bg-black/10 px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Lucro bruto
                </p>
                <p
                  className={`mt-1 text-sm font-semibold ${grossProfit < 0 ? 'text-[var(--color-bad)]' : 'text-[var(--color-good)]'}`}
                >
                  {brlFormatter.format(grossProfit)}
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">Receita menos fornecedor + Infobip</p>
              </div>
              <div className="rounded-lg border border-teal-500/15 bg-black/10 px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Margem bruta
                </p>
                <p
                  className={`mt-1 text-sm font-semibold ${grossMargin !== null && grossMargin < 0 ? 'text-[var(--color-bad)]' : 'text-[var(--color-text)]'}`}
                >
                  {grossMargin === null
                    ? '—'
                    : `${grossMargin.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  Depósitos Infobip são abatidos somente no acerto com o fornecedor
                </p>
              </div>
            </div>
          </section>

          <section className={`${sectionBaseClass} ${sectionStyles.api}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-blue-300">
                    <PhoneCall size={15} />
                  </span>
                  <p className="text-sm font-semibold text-[var(--color-text)]">Números da API / WABA</p>
                  {form.numbers.length > 0 && (
                    <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                      {form.numbers.length}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  WABA identifica a conta do WhatsApp; o número da API é usado para configurar e testar o disparo na Infobip.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {form.numbers.some((number) => number.number.trim()) && (
                  <button
                    type="button"
                    onClick={() => void copyAllNumbers()}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-blue-300"
                  >
                    {copiedNumbers ? <Check size={13} className="text-[var(--color-good)]" /> : <Copy size={13} />}
                    {copiedNumbers ? 'Copiados' : 'Copiar todos'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={addNumber}
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                >
                  <Plus size={13} />
                  Adicionar
                </button>
              </div>
            </div>
            {form.numbers.length === 0 ? (
              <button
                onClick={addNumber}
                className="w-full rounded-lg bg-blue-500/10 py-3 text-xs font-medium text-blue-300 hover:bg-blue-500/15"
              >
                + Cadastrar primeiro número
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                {form.numbers.map((n, i) => (
                  <div
                    key={i}
                    className="grid gap-3 rounded-lg bg-[var(--color-bg)]/75 p-3 sm:grid-cols-[1fr_1.25fr_1fr_auto] sm:items-end"
                  >
                    <CopyField
                      label="WABA / API"
                      placeholder="WABA / API"
                      value={n.waba_label ?? ''}
                      onChange={(value) => updateNumber(i, { waba_label: value || null })}
                    />
                    <CopyField
                      label="Número da API"
                      placeholder="Número"
                      value={n.number}
                      onChange={(value) => updateNumber(i, { number: value })}
                      emphasized
                    />
                    <div>
                      <label
                        htmlFor={`disparo-number-name-${i}`}
                        className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
                      >
                        Identificação
                      </label>
                      <input
                        id={`disparo-number-name-${i}`}
                        className={inputClass}
                        placeholder="Nome do número"
                        value={n.name ?? ''}
                        onChange={(e) => updateNumber(i, { name: e.target.value || null })}
                      />
                    </div>
                    <div className="flex h-9 items-center justify-end gap-1.5">
                      <label
                        className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium ${
                          n.is_test
                            ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={n.is_test}
                          onChange={(e) => updateNumber(i, { is_test: e.target.checked })}
                        />
                        Teste
                      </label>
                      <button
                        type="button"
                        onClick={() => removeNumber(i)}
                        title="Remover número"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-faint)] hover:bg-[var(--color-bad-soft)] hover:text-[var(--color-bad)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`${sectionBaseClass} ${sectionStyles.tags}`}>
            <div className="mb-2 flex items-center justify-between">
              <div className={`${sectionTitleClass} text-violet-300`}>
                <Tags size={15} />
                <span>Etiquetas</span>
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)]">Clique para selecionar</span>
            </div>
            <div className="flex min-h-7 flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = form.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="rounded-full px-2 py-1 text-[11px] font-semibold transition-colors"
                    aria-pressed={active}
                    style={
                      active
                        ? { backgroundColor: tag.color, color: readableTextColor(tag.color) }
                        : {
                            backgroundColor: `${tag.color}18`,
                            color: 'var(--color-text)',
                            boxShadow: `inset 0 0 0 1px ${tag.color}66`,
                          }
                    }
                  >
                    {tag.name}
                  </button>
                );
              })}
              {tags.length === 0 && (
                <span className="text-xs text-[var(--color-text-muted)]">Nenhuma etiqueta cadastrada.</span>
              )}
            </div>
            <details className="mt-1 pt-1">
              <summary className="cursor-pointer list-none text-[11px] font-medium text-violet-300 hover:text-violet-200">
                + Criar nova etiqueta
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="disparo-new-tag-name" className="sr-only">
                  Nome da etiqueta
                </label>
                <input
                  id="disparo-new-tag-name"
                  className={`${inputClass} min-w-48 flex-1`}
                  placeholder="Nome da etiqueta"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                />
                <div className="flex gap-1.5">
                  {tagPresets.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewTagColor(c)}
                      aria-label={`Usar cor ${c}`}
                      aria-pressed={newTagColor === c}
                      className="h-6 w-6 shrink-0 rounded-full transition-transform hover:scale-110"
                      style={{ background: c, outline: newTagColor === c ? '2px solid white' : 'none' }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateTag()}
                  disabled={isMutating || !newTagName.trim()}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)]"
                >
                  {creatingTag ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Criar
                </button>
              </div>
            </details>
          </section>

          <section className={`${sectionBaseClass} ${sectionStyles.links}`}>
            <div className={`${sectionTitleClass} text-cyan-300`}>
              <ListFilter size={15} />
              <span>Lista e links</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="disparo-contact-list" className={labelClass}>Lista (contatos)</label>
                <input
                  id="disparo-contact-list"
                  className={inputClass}
                  value={form.contact_list_ref ?? ''}
                  onChange={(e) => set('contact_list_ref', e.target.value || null)}
                />
              </div>
              <div>
                <label htmlFor="disparo-list-tag" className={labelClass}>Tag da lista</label>
                <input
                  id="disparo-list-tag"
                  className={inputClass}
                  value={form.list_tag ?? ''}
                  onChange={(e) => set('list_tag', e.target.value || null)}
                />
              </div>
              <div>
                <CopyField
                  label="Link completo"
                  placeholder="https://..."
                  value={form.full_link ?? ''}
                  onChange={(value) => set('full_link', value || null)}
                />
              </div>
              <div>
                <CopyField
                  label="Link encurtado"
                  placeholder="https://..."
                  value={form.short_link ?? ''}
                  onChange={(value) => set('short_link', value || null)}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="disparo-instagram" className={labelClass}>Instagram</label>
                <input
                  id="disparo-instagram"
                  className={inputClass}
                  value={form.instagram ?? ''}
                  onChange={(e) => set('instagram', e.target.value || null)}
                  placeholder="instagram.com/usuario"
                />
              </div>
            </div>
          </section>

          <section className={`${sectionBaseClass} ${sectionStyles.message}`}>
            <div className="flex items-center justify-between">
              <div className={`${sectionTitleClass} text-amber-300`}>
                <MessageSquareText size={15} />
                <span>Mensagem</span>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <input
                  type="checkbox"
                  checked={form.copy_approved}
                  onChange={(e) => set('copy_approved', e.target.checked)}
                />
                Mensagem aprovada
              </label>
            </div>
            <textarea
              aria-label="Texto da mensagem"
              className={inputClass}
              rows={4}
              value={form.copy_text ?? ''}
              onChange={(e) => set('copy_text', e.target.value || null)}
              placeholder="Texto que vai no disparo"
            />
          </section>

          {localTask ? (
            <section className={`${sectionBaseClass} ${sectionStyles.files}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className={`${sectionTitleClass} text-emerald-300`}>
                    <Paperclip size={15} />
                    <span>Arquivos do disparo</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Cada arquivo gera um link público pronto para colar na Infobip.
                  </p>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                  <Info size={12} />
                  Limite de 16 MB por arquivo
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MediaSlot
                  kind="profile_photo"
                  label="Foto de perfil"
                  description="Imagem inteira reduzida para 600 × 600 px, sem corte"
                  icon={<User size={32} />}
                  url={localTask.profile_photo_url}
                  uploading={uploadingKind === 'profile_photo'}
                  disabled={isMutating}
                  onUpload={(f) => void handleUpload('profile_photo', f)}
                  onRemove={() => void handleRemoveMedia('profile_photo')}
                />
                <MediaSlot
                  kind="image"
                  label="Imagem"
                  description="Otimizada automaticamente quando passar de 16 MB"
                  icon={<ImageIcon size={32} />}
                  url={localTask.image_url}
                  uploading={uploadingKind === 'image'}
                  disabled={isMutating}
                  onUpload={(f) => void handleUpload('image', f)}
                  onRemove={() => void handleRemoveMedia('image')}
                />
                <MediaSlot
                  kind="video"
                  label="Vídeo"
                  description="MP4 ou outro formato de vídeo, até 16 MB"
                  icon={<Video size={32} />}
                  url={localTask.video_url}
                  uploading={uploadingKind === 'video'}
                  disabled={isMutating}
                  onUpload={(f) => void handleUpload('video', f)}
                  onRemove={() => void handleRemoveMedia('video')}
                />
                <MediaSlot
                  kind="contact_list"
                  label="Lista de contatos"
                  description="CSV, TXT, XLS, XLSX ou ZIP, até 16 MB"
                  icon={<FileSpreadsheet size={32} />}
                  url={localTask.list_file_url}
                  fileName={localTask.list_file_name}
                  uploading={uploadingKind === 'contact_list'}
                  disabled={isMutating}
                  onUpload={(f) => void handleUpload('contact_list', f)}
                  onRemove={() => void handleRemoveMedia('contact_list')}
                />
              </div>
            </section>
          ) : (
            <section className={`${sectionBaseClass} ${sectionStyles.files}`}>
              <div className={`${sectionTitleClass} text-emerald-300`}>
                <Paperclip size={15} />
                <span>Arquivos do disparo</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Salve o card primeiro para anexar foto, imagem, vídeo ou lista de contatos.
              </p>
            </section>
          )}

          <div className="flex flex-col gap-3 pt-1">
            <label htmlFor="disparo-final-report" className={labelClass}>Relatório final</label>
            <textarea
              id="disparo-final-report"
              className={inputClass}
              rows={3}
              value={form.final_report ?? ''}
              onChange={(e) => set('final_report', e.target.value || null)}
              placeholder="Resultado do disparo, observações finais"
            />
          </div>

          {error && (
            <p role="alert" aria-live="assertive" className="text-xs text-[var(--color-bad)]">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {localTask ? (
            <button
              onClick={() => void handleDelete()}
              disabled={isMutating}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)]"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Excluir
            </button>
          ) : (
            <span />
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={onClose}
              disabled={isMutating}
              className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Fechar
            </button>
            {localTask && next && (
              <button
                onClick={() => void handleAdvanceClick()}
                disabled={isMutating || Boolean(portalAdvanceBlock)}
                title={portalAdvanceBlock ?? undefined}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-good)] px-4 py-2 text-sm font-medium text-[var(--color-good)] disabled:cursor-not-allowed disabled:border-[var(--color-border)] disabled:text-[var(--color-text-faint)]"
              >
                {advancing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                Avançar para {nextLabel}
              </button>
            )}
            {!localTask && (
              <button
                onClick={() => void handleSave()}
                disabled={isMutating || loadingFinancialDefault || !financialDefaultReviewed}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)]"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Criar demanda
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
