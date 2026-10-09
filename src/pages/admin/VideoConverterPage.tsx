import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Film,
  FolderInput,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  Play,
  Square,
  Trash2,
  TriangleAlert,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import {
  codecLabel,
  formatBytes,
  formatDuration,
  META_MAX_BYTES,
  planConversion,
  VIDEO_PRESETS,
  type VideoPlan,
  type VideoPresetKey,
  type VideoProbe,
} from '../../lib/videoPlan';
import {
  ConversionCanceled,
  convertVideo,
  folderPickerAvailable,
  PARALLEL_JOBS,
  pickOutputFolder,
  probeVideo,
  webCodecsAvailable,
  type ConvertedVideo,
} from '../../lib/videoConverter';

type JobStatus = 'probing' | 'ready' | 'queued' | 'converting' | 'done' | 'error' | 'canceled';

type Job = {
  id: string;
  file: File;
  probe: VideoProbe | null;
  status: JobStatus;
  progress: number;
  result: ConvertedVideo | null;
  error: string | null;
  note: string | null;
};

type DestinationMode = 'folder' | 'download';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv', '3gp', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg'];
const ACCEPT = ['video/*', ...VIDEO_EXTENSIONS.map((extension) => `.${extension}`)].join(',');

const isVideoFile = (file: File) =>
  file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? '');

const engineBadge: Record<VideoPlan['engine'], { label: string; color: string; soft: string }> = {
  copy: { label: 'Só regravar', color: 'var(--color-good)', soft: 'var(--color-good-soft)' },
  encode: { label: 'Converter', color: 'var(--color-brand)', soft: 'var(--color-brand-soft)' },
  ffmpeg: { label: 'Conversor reserva', color: 'var(--color-warn)', soft: 'var(--color-warn-soft)' },
  blocked: { label: 'Não suportado', color: 'var(--color-bad)', soft: 'var(--color-bad-soft)' },
};

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function VideoConverterPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [presetKey, setPresetKey] = useState<VideoPresetKey>('meta');
  const canPickFolder = useMemo(() => folderPickerAvailable(), []);
  const fastEngine = useMemo(() => webCodecsAvailable(), []);
  const [mode, setMode] = useState<DestinationMode>(canPickFolder ? 'folder' : 'download');
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const preset = VIDEO_PRESETS[presetKey];

  // Sair da página no meio da conversão perderia o lote; o navegador confirma antes.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const plans = useMemo(() => {
    const map = new Map<string, VideoPlan>();
    for (const job of jobs) {
      if (job.status !== 'probing') map.set(job.id, planConversion(job.file.size, job.probe, preset));
    }
    return map;
  }, [jobs, preset]);

  const patchJob = (id: string, patch: Partial<Job>) =>
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));

  async function addFiles(list: FileList | File[]) {
    const all = Array.from(list);
    const videos = all.filter(isVideoFile);
    const skipped = all.length - videos.length;
    setMessage(skipped > 0 ? `${skipped} arquivo(s) ignorado(s) por não serem vídeo.` : null);
    if (videos.length === 0) return;

    const added: Job[] = videos.map((file) => ({
      id: crypto.randomUUID(),
      file,
      probe: null,
      status: 'probing',
      progress: 0,
      result: null,
      error: null,
      note: null,
    }));
    setJobs((current) => [...current, ...added]);
    setFinishedAt(null);

    // A leitura só abre o cabeçalho do arquivo; três por vez já é instantâneo.
    let cursor = 0;
    const reader = async () => {
      while (cursor < added.length) {
        const job = added[cursor++];
        const probe = await probeVideo(job.file).catch(() => null);
        patchJob(job.id, { probe, status: 'ready' });
      }
    };
    await Promise.all([reader(), reader(), reader()]);
  }

  async function chooseFolder() {
    try {
      setFolder(await pickOutputFolder());
      setMessage(null);
    } catch (caught) {
      // O Chrome devolve o mesmo erro quando a pessoa fecha a janela, quando recusa
      // a permissão de editar e quando a pasta é protegida; explica os três casos.
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setMessage(
          'Nenhuma pasta foi escolhida. Se o navegador recusou a pasta (algumas do sistema, como a raiz do disco, são bloqueadas), ' +
            'crie uma subpasta, por exemplo D:\\VIDEOS CONVERTIDOS, e escolha ela. Quando o navegador perguntar, clique em permitir editar os arquivos.',
        );
        return;
      }
      setMessage(`Não foi possível usar a pasta: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  const pending = jobs.filter(
    (job) => ['ready', 'error', 'canceled'].includes(job.status) && plans.get(job.id)?.engine !== 'blocked',
  );
  const needsFolder = mode === 'folder' && !folder;

  async function start() {
    if (running || pending.length === 0 || needsFolder) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const destination = mode === 'folder' && folder ? { kind: 'folder' as const, dir: folder } : { kind: 'memory' as const };
    const batch = pending.map((job) => ({ job, plan: plans.get(job.id)! }));
    const presetAtStart = preset;

    setRunning(true);
    setBatchIds(batch.map((item) => item.job.id));
    setStartedAt(Date.now());
    setFinishedAt(null);
    setMessage(null);
    setJobs((current) =>
      current.map((job) =>
        batch.some((item) => item.job.id === job.id)
          ? { ...job, status: 'queued', progress: 0, error: null, note: null, result: null }
          : job,
      ),
    );

    let cursor = 0;
    const worker = async () => {
      while (cursor < batch.length && !controller.signal.aborted) {
        const { job, plan } = batch[cursor++];
        patchJob(job.id, { status: 'converting' });
        let lastPercent = -1;
        try {
          const result = await convertVideo(job.file, plan, presetAtStart, {
            destination,
            signal: controller.signal,
            onProgress: (fraction) => {
              const percent = Math.floor(fraction * 100);
              if (percent === lastPercent) return;
              lastPercent = percent;
              patchJob(job.id, { progress: fraction });
            },
            onFallback: () => patchJob(job.id, { note: 'O navegador não conseguiu; o conversor reserva assumiu (mais lento).' }),
          });
          patchJob(job.id, {
            status: 'done',
            progress: 1,
            result,
            note: result.size > META_MAX_BYTES ? 'Ficou acima de 4 GB, o limite da Meta. Use o perfil Leve.' : null,
          });
        } catch (caught) {
          if (caught instanceof ConversionCanceled || controller.signal.aborted) {
            patchJob(job.id, { status: 'canceled', progress: 0 });
          } else {
            patchJob(job.id, { status: 'error', progress: 0, error: caught instanceof Error ? caught.message : String(caught) });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_JOBS, batch.length) }, worker));

    if (controller.signal.aborted) {
      setJobs((current) => current.map((job) => (job.status === 'queued' ? { ...job, status: 'canceled' } : job)));
    }
    abortRef.current = null;
    setRunning(false);
    setFinishedAt(Date.now());
  }

  function cancel() {
    abortRef.current?.abort();
  }

  async function downloadAll() {
    const ready = jobs.filter((job) => job.result?.blob);
    for (const job of ready) {
      downloadBlob(job.result!.blob!, job.result!.name);
      // O navegador agrupa downloads disparados no mesmo instante e pode descartar alguns.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  const done = jobs.filter((job) => job.status === 'done' && job.result);
  const sizeBefore = done.reduce((sum, job) => sum + job.file.size, 0);
  const sizeAfter = done.reduce((sum, job) => sum + (job.result?.size ?? 0), 0);
  const activeCount = jobs.filter((job) => job.status === 'queued' || job.status === 'converting').length;
  const batchJobs = jobs.filter((job) => batchIds.includes(job.id));
  const overall =
    (batchJobs.reduce((sum, job) => sum + (job.status === 'done' ? 1 : job.status === 'converting' ? job.progress : 0), 0) /
      Math.max(1, batchJobs.length)) * 100;
  const elapsed = startedAt ? ((finishedAt ?? Date.now()) - startedAt) / 1000 : 0;

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <header>
        <div className="flex items-center gap-2">
          <Film size={21} className="text-[var(--color-brand)]" />
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Conversor de vídeo</h1>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
          Converte vários vídeos de uma vez para MP4 com H.264 e áudio AAC, no tamanho certo para anúncio. O arquivo
          fica mais leve e sobe mais rápido no criador de anúncios. Tudo roda no seu computador: nada é enviado para o servidor.
        </p>
      </header>

      {!fastEngine && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          Este navegador não tem o conversor rápido. Os vídeos vão pelo conversor reserva, um por vez e bem mais devagar.
          Use o Chrome ou o Edge atualizados.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div
            role="button"
            tabIndex={0}
            onClick={() => filesInput.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') filesInput.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
            className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60 ${dragging ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-brand)]'}`}
          >
            <UploadCloud size={28} className="text-[var(--color-brand)]" />
            <p className="text-sm font-semibold text-[var(--color-text)]">Arraste os vídeos aqui ou clique para escolher</p>
            <p className="text-xs text-[var(--color-text-muted)]">MP4, MOV, MKV, WebM, AVI e outros · quantos quiser</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text)] transition hover:border-[var(--color-brand)]"
            >
              <FolderInput size={14} /> Selecionar uma pasta inteira
            </button>
            {jobs.length > 0 && !running && (
              <button
                type="button"
                onClick={() => {
                  setJobs([]);
                  setStartedAt(null);
                  setFinishedAt(null);
                  setMessage(null);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
              >
                <Trash2 size={14} /> Limpar lista
              </button>
            )}
          </div>
          <input
            ref={filesInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            className="hidden"
            {...{ webkitdirectory: '' }}
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </Card>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Perfil</p>
          <div className="mt-2 flex flex-col gap-2">
            {(Object.keys(VIDEO_PRESETS) as VideoPresetKey[]).map((key) => {
              const option = VIDEO_PRESETS[key];
              const active = key === presetKey;
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-faint)]'} ${running ? 'pointer-events-none opacity-60' : ''}`}
                >
                  <input
                    type="radio"
                    name="preset"
                    checked={active}
                    onChange={() => setPresetKey(key)}
                    disabled={running}
                    className="mt-1 accent-[var(--color-brand)]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--color-text)]">{option.label}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Onde salvar</p>
          <div className="mt-2 flex flex-col gap-2">
            {canPickFolder && (
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${mode === 'folder' ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)]'} ${running ? 'pointer-events-none opacity-60' : ''}`}>
                <input type="radio" name="destino" checked={mode === 'folder'} onChange={() => setMode('folder')} disabled={running} className="mt-1 accent-[var(--color-brand)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--color-text)]">Gravar direto numa pasta (recomendado)</span>
                  <span className="block text-xs text-[var(--color-text-muted)]">
                    Cada vídeo é salvo assim que fica pronto, sem ocupar memória. Nunca sobrescreve: se o nome já existir, acrescenta <code>_meta</code>.
                  </span>
                  {mode === 'folder' && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        void chooseFolder();
                      }}
                      className="mt-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:border-[var(--color-brand)]"
                    >
                      <FolderOpen size={14} className="shrink-0" />
                      <span className="truncate">{folder ? `Pasta: ${folder.name}` : 'Escolher pasta'}</span>
                    </button>
                  )}
                </span>
              </label>
            )}
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${mode === 'download' ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)]'} ${running ? 'pointer-events-none opacity-60' : ''}`}>
              <input type="radio" name="destino" checked={mode === 'download'} onChange={() => setMode('download')} disabled={running} className="mt-1 accent-[var(--color-brand)]" />
              <span>
                <span className="block text-sm font-semibold text-[var(--color-text)]">Baixar pelo navegador</span>
                <span className="block text-xs text-[var(--color-text-muted)]">
                  Vai para a pasta de downloads. Os vídeos prontos ficam na memória até você baixar; bom para poucos arquivos.
                </span>
              </span>
            </label>
          </div>
        </Card>
      </div>

      {message && (
        <p className="rounded-xl border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-4 py-2.5 text-sm text-[var(--color-warn)]">{message}</p>
      )}

      {jobs.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {jobs.length} vídeo(s) · {done.length} pronto(s)
                {activeCount > 0 && ` · ${activeCount} na fila`}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {running
                  ? `Convertendo ${PARALLEL_JOBS} por vez · ${formatDuration(elapsed)} decorrido. Não feche esta aba.`
                  : done.length > 0 && sizeBefore > 0
                    ? `De ${formatBytes(sizeBefore)} para ${formatBytes(sizeAfter)} (${sizeAfter <= sizeBefore ? '-' : '+'}${Math.abs(Math.round((1 - sizeAfter / sizeBefore) * 100))}%)${finishedAt && startedAt ? ` em ${formatDuration(elapsed)}` : ''}.${mode === 'folder' && folder ? ` Salvos na pasta "${folder.name}".` : ''}`
                    : 'Confira o plano de cada vídeo e clique em converter.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {mode === 'download' && done.some((job) => job.result?.blob) && !running && (
                <button
                  type="button"
                  onClick={() => void downloadAll()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text)] transition hover:border-[var(--color-brand)]"
                >
                  <Download size={16} /> Baixar todos
                </button>
              )}
              {running ? (
                <button
                  type="button"
                  onClick={cancel}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-bad)]/50 bg-[var(--color-bad-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--color-bad)] transition hover:brightness-125"
                >
                  <Square size={15} /> Cancelar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={pending.length === 0 || needsFolder || jobs.some((job) => job.status === 'probing')}
                  title={needsFolder ? 'Escolha a pasta de destino primeiro' : undefined}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play size={16} />
                  {needsFolder ? 'Escolha a pasta de destino' : `Converter ${pending.length} vídeo(s)`}
                </button>
              )}
            </div>
          </div>
          {running && (
            <div className="mt-3">
              <ProgressBar value={overall} color="var(--color-brand)" />
            </div>
          )}

          <ul className="mt-4 flex flex-col divide-y divide-[var(--color-border-soft)]">
            {jobs.map((job) => {
              const plan = plans.get(job.id);
              const badge = plan ? engineBadge[plan.engine] : null;
              const probe = job.probe;
              const details = probe
                ? [
                    probe.container === 'QuickTime File Format' ? 'MOV' : probe.container,
                    codecLabel(probe.videoCodec),
                    `${probe.width}×${probe.height}`,
                    probe.fps ? `${Math.round(probe.fps)} fps` : null,
                    formatDuration(probe.duration),
                  ].filter(Boolean).join(' · ')
                : job.status === 'probing'
                  ? 'Lendo o arquivo...'
                  : 'Formato não reconhecido pelo navegador';
              return (
                <li key={job.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]" title={job.file.name}>{job.file.name}</p>
                      <span className="text-xs text-[var(--color-text-faint)]">{formatBytes(job.file.size)}</span>
                      {badge && job.status !== 'done' && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: badge.color, background: badge.soft }}>
                          {plan?.engine === 'copy' && <Zap size={10} className="mr-1 inline" />}
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{details}</p>
                    {plan && job.status !== 'done' && plan.reasons.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-[var(--color-text-faint)]">{plan.reasons.join(' ')}</p>
                    )}
                    {job.note && <p className="mt-0.5 text-[11px] text-[var(--color-warn)]">{job.note}</p>}
                    {job.error && <p className="mt-0.5 text-[11px] text-[var(--color-bad)]">{job.error}</p>}
                    {job.status === 'converting' && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1"><ProgressBar value={job.progress * 100} color="var(--color-brand)" /></div>
                        <span className="w-9 text-right text-[11px] tabular-nums text-[var(--color-text-muted)]">{Math.floor(job.progress * 100)}%</span>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    {job.status === 'probing' && <LoaderCircle size={16} className="animate-spin text-[var(--color-text-muted)]" />}
                    {job.status === 'queued' && <span className="text-[var(--color-text-muted)]">Na fila</span>}
                    {job.status === 'converting' && <LoaderCircle size={16} className="animate-spin text-[var(--color-brand)]" />}
                    {job.status === 'canceled' && <span className="text-[var(--color-text-muted)]">Cancelado</span>}
                    {job.status === 'error' && <TriangleAlert size={16} className="text-[var(--color-bad)]" />}
                    {job.status === 'done' && job.result && (
                      <>
                        <CheckCircle2 size={16} className="text-[var(--color-good)]" />
                        <span className="text-[var(--color-text-muted)]">
                          {formatBytes(job.result.size)}
                          {' '}
                          <span className={job.result.size <= job.file.size ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'}>
                            ({job.result.size <= job.file.size ? '-' : '+'}{Math.abs(Math.round((1 - job.result.size / job.file.size) * 100))}%)
                          </span>
                        </span>
                        {job.result.blob ? (
                          <button
                            type="button"
                            onClick={() => downloadBlob(job.result!.blob!, job.result!.name)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 font-semibold text-[var(--color-text)] hover:border-[var(--color-brand)]"
                          >
                            <Download size={13} /> Baixar
                          </button>
                        ) : (
                          <span className="inline-flex max-w-48 items-center gap-1 truncate text-[var(--color-text-faint)]" title={job.result.name}>
                            <HardDrive size={12} className="shrink-0" /> {job.result.name}
                          </span>
                        )}
                      </>
                    )}
                    {!running && job.status !== 'converting' && (
                      <button
                        type="button"
                        aria-label={`Remover ${job.file.name}`}
                        onClick={() => setJobs((current) => current.filter((item) => item.id !== job.id))}
                        className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Para subir mais rápido">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--color-text-muted)]">
          <li><strong className="text-[var(--color-text)]">Só regravar</strong>: o vídeo já está em H.264 e no tamanho certo. Leva segundos e não perde qualidade.</li>
          <li><strong className="text-[var(--color-text)]">Converter</strong>: usa a placa de vídeo do computador. Vídeos 4K, 60 fps ou de iPhone (HEVC) caem aqui e costumam encolher bastante.</li>
          <li><strong className="text-[var(--color-text)]">Conversor reserva</strong>: para formatos que o navegador não lê. Só usa o processador, um por vez, e aceita até 750 MB.</li>
          <li>O nome do arquivo é mantido, então o criador de anúncios continua juntando as versões <code>_feed</code> e <code>_stories</code> sozinho.</li>
          <li>Escolha uma pasta em um disco com espaço livre e deixe esta aba aberta até terminar.</li>
        </ul>
      </Card>
    </main>
  );
}
