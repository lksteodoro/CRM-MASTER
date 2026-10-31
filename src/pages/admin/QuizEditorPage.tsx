import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Cloud,
  History,
  Loader2,
  Monitor,
  Palette,
  Play,
  Rocket,
  Settings2,
  Smartphone,
  X,
} from 'lucide-react';
import {
  NODE_LABELS,
  shortId,
  validateFlow,
  type QuizFlow,
  type QuizNode,
  type QuizNodeData,
  type QuizNodeType,
} from '../../../supabase/functions/_shared/quizFlow.ts';
import { FlowEditorContext, NODE_META, nodeTypes, type FlowNode } from '../../components/quiz/flowNodes';
import { collectVariables, NodeInspector } from '../../components/quiz/NodeInspector';
import { QuizSettingsModal } from '../../components/quiz/QuizSettingsModal';
import { QuizRunner } from '../../components/quiz/QuizRunner';
import { ErrorView, LoadingView } from '../../components/ui/StateView';
import { listClients } from '../../services/clients.service';
import { listRedirectLinks, type RedirectLinkWithDestinations } from '../../services/redirectLinks.service';
import {
  getQuiz,
  listQuizProducts,
  listQuizVersions,
  publishQuiz,
  saveQuizDraft,
  type Quiz,
  type QuizVersion,
} from '../../services/quizzes.service';
import type { ClientRow, QuizProductRow } from '../../integrations/supabase/database.types';

const PALETTE: QuizNodeType[] = ['message', 'input', 'choice', 'condition', 'action', 'webhook', 'redirect', 'end'];

function defaultData(type: QuizNodeType): QuizNodeData {
  switch (type) {
    case 'message': return { text: '' };
    case 'input': return { label: '', inputKind: 'text', variable: '', required: true };
    case 'choice': return { label: '', variable: '', required: true, options: [{ id: shortId(), label: 'Opção 1', value: 'opcao_1' }, { id: shortId(), label: 'Opção 2', value: 'opcao_2' }] };
    case 'condition': return { combinator: 'and', rules: [{ id: shortId(), variable: '', operator: 'eq', value: '' }] };
    case 'action': return { ops: [{ id: shortId(), kind: 'qualify', qualified: true }] };
    case 'webhook': return { url: '' };
    case 'redirect': return { target: 'link' };
    case 'end': return { title: 'Obrigado!', text: '' };
    default: return {};
  }
}

function edgeStyle(sourceHandle: string | null | undefined): Partial<Edge> {
  const color = sourceHandle === 'yes' ? 'var(--color-good)' : sourceHandle === 'no' ? 'var(--color-bad)' : 'var(--color-text-faint)';
  return { type: 'smoothstep', style: { stroke: color, strokeWidth: 2 }, markerEnd: { type: 'arrowclosed' as never, color } };
}

function toRF(flow: QuizFlow) {
  return {
    nodes: flow.nodes.map((node): FlowNode => ({ id: node.id, type: node.type, position: node.position, data: node.data as FlowNode['data'], deletable: node.type !== 'start' })),
    edges: flow.edges.map((edge): Edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? 'next', ...edgeStyle(edge.sourceHandle) })),
  };
}

function fromRF(nodes: FlowNode[], edges: Edge[]): QuizFlow {
  return {
    nodes: nodes.map((node): QuizNode => ({ id: node.id, type: node.type, position: { x: Math.round(node.position.x), y: Math.round(node.position.y) }, data: node.data })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle ?? 'next', target: edge.target })),
  };
}

/** Compara conteúdo sem posição: arrastar bloco não conta como mudança a publicar. */
function contentKey(flow: QuizFlow | null | undefined, theme?: unknown) {
  if (!flow) return '';
  return JSON.stringify({ n: flow.nodes.map((node) => [node.id, node.type, node.data]), e: flow.edges.map((edge) => [edge.source, edge.sourceHandle ?? 'next', edge.target]).sort(), theme: theme ?? null });
}

export function QuizEditorPage() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>;
}

function Editor() {
  const { quizId = '' } = useParams();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [versions, setVersions] = useState<QuizVersion[]>([]);
  const [products, setProducts] = useState<QuizProductRow[]>([]);
  const [links, setLinks] = useState<RedirectLinkWithDestinations[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [panel, setPanel] = useState<'none' | 'issues' | 'versions'>('none');
  const [modal, setModal] = useState<'none' | 'settings' | 'appearance' | 'preview' | 'publish'>('none');
  const [previewFrame, setPreviewFrame] = useState<'mobile' | 'desktop'>('mobile');
  const [previewKey, setPreviewKey] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const lastSavedRef = useRef('');
  const { screenToFlowPosition, fitView } = useReactFlow();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [quizRow, versionRows, productRows, linkRows, clientRows] = await Promise.all([getQuiz(quizId), listQuizVersions(quizId), listQuizProducts(), listRedirectLinks(), listClients()]);
      setQuiz(quizRow);
      setVersions(versionRows);
      setProducts(productRows);
      setLinks(linkRows);
      setClients(clientRows);
      const flow = quizRow.draft_flow ?? versionRows.find((version) => version.id === quizRow.published_version_id)?.flow ?? { nodes: [], edges: [] };
      const rf = toRF(flow);
      setNodes(rf.nodes);
      setEdges(rf.edges);
      lastSavedRef.current = JSON.stringify(flow);
      window.setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 50);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Não foi possível abrir o quiz.');
    }
  }, [quizId, setNodes, setEdges, fitView]);

  useEffect(() => { void load(); }, [load]);

  const flow = useMemo(() => fromRF(nodes, edges), [nodes, edges]);
  const issues = useMemo(() => validateFlow(flow), [flow]);
  const issuesByNode = useMemo(() => {
    const map = new Map<string, typeof issues>();
    for (const issue of issues) if (issue.nodeId) map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue]);
    return map;
  }, [issues]);
  const errors = issues.filter((issue) => issue.level === 'error');
  const linkOptions = useMemo(() => links.map((link) => {
    const client = clients.find((item) => item.id === link.client_id);
    return { id: link.id, label: `${client ? `${client.name} · ` : ''}${link.name}${link.active ? '' : ' (pausado)'}`, slug: link.slug };
  }), [links, clients]);
  const linkName = useCallback((id: string | undefined) => linkOptions.find((link) => link.id === id)?.label ?? 'link removido', [linkOptions]);
  const published = versions.find((version) => version.id === quiz?.published_version_id) ?? null;
  const hasUnpublished = quiz ? contentKey(flow, quiz.theme) !== contentKey(published?.flow, published?.theme) : false;
  const variables = useMemo(() => collectVariables(nodes), [nodes]);
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  // Salvamento automático do rascunho.
  useEffect(() => {
    if (!quiz) return;
    const serialized = JSON.stringify(flow);
    if (serialized === lastSavedRef.current) return;
    setSaveState('pending');
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        await saveQuizDraft(quiz.id, flow);
        lastSavedRef.current = serialized;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [flow, quiz]);

  useEffect(() => {
    if (saveState === 'saved') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => {
      const handle = connection.sourceHandle ?? 'next';
      // Cada saída leva a um só lugar: ligar de novo substitui a ligação anterior.
      const without = current.filter((edge) => !(edge.source === connection.source && (edge.sourceHandle ?? 'next') === handle));
      return addEdge({ ...connection, sourceHandle: handle, id: `e_${shortId()}`, ...edgeStyle(handle) }, without);
    });
  }, [setEdges]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (connection.source === connection.target) return false;
    const target = nodes.find((node) => node.id === connection.target);
    return Boolean(target && target.type !== 'start');
  }, [nodes]);

  function addNode(type: QuizNodeType) {
    const pane = document.querySelector('.quiz-flow-canvas')?.getBoundingClientRect();
    const center = pane ? screenToFlowPosition({ x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 }) : { x: 0, y: 0 };
    const id = shortId();
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { id, type, position: { x: center.x - 135 + Math.random() * 40, y: center.y - 60 + Math.random() * 40 }, data: defaultData(type) as FlowNode['data'], selected: true }]);
    setSelectedId(id);
  }

  function updateNode(id: string, patch: Partial<QuizNodeData>) {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node));
    if (patch.options) {
      // Opção removida leva junto a ligação dela.
      const optionIds = new Set(patch.options.map((option) => option.id));
      setEdges((current) => current.filter((edge) => edge.source !== id || ['next', 'yes', 'no'].includes(edge.sourceHandle ?? 'next') || optionIds.has(edge.sourceHandle ?? '')));
    }
    if (patch.multiple) setEdges((current) => current.filter((edge) => edge.source !== id || (edge.sourceHandle ?? 'next') === 'next'));
  }

  function deleteNode(id: string) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId(null);
  }

  function duplicateNode(id: string) {
    const original = nodes.find((node) => node.id === id);
    if (!original) return;
    const copyId = shortId();
    const data = JSON.parse(JSON.stringify(original.data)) as FlowNode['data'];
    if (data.options) data.options = data.options.map((option) => ({ ...option, id: shortId() }));
    if (data.rules) data.rules = data.rules.map((rule) => ({ ...rule, id: shortId() }));
    if (data.ops) data.ops = data.ops.map((op) => ({ ...op, id: shortId() }));
    if (data.variable) data.variable = `${data.variable}_2`;
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { ...original, id: copyId, data, selected: true, position: { x: original.position.x + 40, y: original.position.y + 40 } }]);
    setSelectedId(copyId);
  }

  async function confirmPublish() {
    if (!quiz) return;
    setPublishing(true);
    try {
      // Garante que o rascunho no banco é exatamente o que está na tela.
      await saveQuizDraft(quiz.id, flow);
      lastSavedRef.current = JSON.stringify(flow);
      setSaveState('saved');
      const version = await publishQuiz(quiz.id);
      const [quizRow, versionRows] = await Promise.all([getQuiz(quiz.id), listQuizVersions(quiz.id)]);
      setQuiz(quizRow);
      setVersions(versionRows);
      setModal('none');
      setNotice({ tone: 'good', text: `Versão ${version.version} publicada. O link já mostra esta versão.` });
    } catch (caught) {
      setNotice({ tone: 'bad', text: caught instanceof Error ? caught.message : 'Não foi possível publicar.' });
    } finally {
      setPublishing(false);
    }
  }

  function restoreVersion(version: QuizVersion) {
    if (!window.confirm(`Trazer a versão ${version.version} para o rascunho? O rascunho atual será substituído (a versão publicada não muda até você publicar).`)) return;
    const rf = toRF(version.flow);
    setNodes(rf.nodes);
    setEdges(rf.edges);
    setSelectedId(null);
    setNotice({ tone: 'good', text: `Versão ${version.version} restaurada no rascunho.` });
    window.setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 50);
  }

  if (loadError) return <ErrorView message={loadError} onRetry={() => void load()} />;
  if (!quiz) return <LoadingView label="Abrindo o editor..." />;

  const describeTarget = (node: QuizNode) => {
    if (node.data.target === 'link') return `Redirecionador: ${linkName(node.data.linkId)}`;
    if (node.data.target === 'url') return node.data.url ?? '';
    if (node.data.target === 'whatsapp') return `WhatsApp ${node.data.phone ?? ''}`;
    return 'Sem destino';
  };

  return (
    <FlowEditorContext.Provider value={{ issues: issuesByNode, linkName }}>
      <main className="flex min-h-[640px] flex-1 flex-col">
        {/* Barra superior */}
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5">
          <Link to="/agency/ferramentas/quiz" className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Voltar para a lista"><ArrowLeft size={17} /></Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-[var(--color-text)]">{quiz.name}</h1>
            <p className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
              <span className="font-mono">/q/{quiz.slug}</span>
              {published ? <span className="rounded-full bg-[var(--color-good-soft)] px-1.5 text-[var(--color-good)]">v{published.version} no ar</span> : <span className="rounded-full bg-[var(--color-panel-2)] px-1.5">nunca publicado</span>}
              {hasUnpublished && <span className="rounded-full bg-[var(--color-warn-soft)] px-1.5 text-[var(--color-warn)]">alterações não publicadas</span>}
              {!quiz.active && <span className="rounded-full bg-[var(--color-panel-2)] px-1.5">pausado</span>}
            </p>
          </div>
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-text-faint)]">
            {saveState === 'saving' || saveState === 'pending' ? <><Loader2 size={12} className="animate-spin" /> Salvando rascunho</> : saveState === 'error' ? <span className="text-[var(--color-bad)]">Falha ao salvar</span> : <><Cloud size={12} /> Rascunho salvo</>}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setPanel(panel === 'issues' ? 'none' : 'issues')} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${errors.length ? 'border-[var(--color-bad)] text-[var(--color-bad)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
              {errors.length ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} className="text-[var(--color-good)]" />} {errors.length ? `${errors.length} erro${errors.length > 1 ? 's' : ''}` : 'Fluxo válido'}
            </button>
            <button type="button" onClick={() => setModal('appearance')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><Palette size={13} /> Aparência</button>
            <button type="button" onClick={() => setModal('settings')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><Settings2 size={13} /> Configurações</button>
            <button type="button" onClick={() => setPanel(panel === 'versions' ? 'none' : 'versions')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><History size={13} /> Versões</button>
            <button type="button" onClick={() => { setPreviewKey((key) => key + 1); setModal('preview'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><Play size={13} /> Testar</button>
            <button type="button" onClick={() => { if (errors.length) { setPanel('issues'); setNotice({ tone: 'bad', text: 'Corrija os erros do fluxo antes de publicar.' }); } else setModal('publish'); }} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"><Rocket size={13} /> Publicar</button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Paleta */}
          <aside className="hidden w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-panel)] p-3 md:flex">
            <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">Adicionar bloco</p>
            {PALETTE.map((type) => {
              const meta = NODE_META[type];
              const Icon = meta.icon;
              return (
                <button key={type} type="button" onClick={() => addNode(type)} title={meta.description} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}><Icon size={14} /></span>
                  <span><span className="block font-medium">{NODE_LABELS[type]}</span><span className="block text-[10px] leading-tight text-[var(--color-text-faint)]">{meta.description}</span></span>
                </button>
              );
            })}
            <p className="mt-auto px-1 pt-3 text-[10px] leading-relaxed text-[var(--color-text-faint)]">Arraste das bolinhas para ligar os blocos. Selecione e aperte Delete para excluir.</p>
          </aside>

          {/* Área do fluxo */}
          <div className="quiz-flow-canvas relative min-w-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onSelectionChange={({ nodes: chosen }) => setSelectedId(chosen.length === 1 ? chosen[0].id : null)}
              onBeforeDelete={async ({ nodes: toDelete, edges: edgesToDelete }) => ({ nodes: toDelete.filter((node) => node.type !== 'start'), edges: edgesToDelete })}
              deleteKeyCode={['Delete', 'Backspace']}
              colorMode="dark"
              fitView
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={22} size={1.2} color="var(--color-border)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(node) => NODE_META[(node.type as QuizNodeType) ?? 'message'].color} maskColor="rgba(0,0,0,.55)" className="!hidden lg:!block" />
            </ReactFlow>
            {/* Paleta compacta no celular */}
            <div className="absolute inset-x-2 top-2 flex gap-1 overflow-x-auto md:hidden">
              {PALETTE.map((type) => {
                const Icon = NODE_META[type].icon;
                return <button key={type} type="button" onClick={() => addNode(type)} className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-[11px] text-[var(--color-text)]"><Icon size={12} /> {NODE_LABELS[type]}</button>;
              })}
            </div>
            {notice && (
              <div role="status" className={`absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-lg ${notice.tone === 'good' ? 'border-[var(--color-good)] bg-[var(--color-good-soft)] text-[var(--color-good)]' : 'border-[var(--color-bad)] bg-[var(--color-bad-soft)] text-[var(--color-bad)]'}`}>{notice.text}</div>
            )}
          </div>

          {/* Painel direito */}
          {(selected || panel !== 'none') && (
            <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-sm border-l border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl lg:static lg:w-[340px] lg:shadow-none">
              {selected ? (
                <NodeInspector
                  key={selected.id}
                  node={selected}
                  variables={variables}
                  links={linkOptions}
                  onChange={(patch) => updateNode(selected.id, patch)}
                  onDelete={() => deleteNode(selected.id)}
                  onDuplicate={() => duplicateNode(selected.id)}
                  onClose={() => { setSelectedId(null); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); }}
                />
              ) : panel === 'issues' ? (
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3"><p className="text-sm font-semibold text-[var(--color-text)]">Verificação do fluxo</p><button type="button" onClick={() => setPanel('none')} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={16} /></button></div>
                  <div className="flex-1 space-y-2 overflow-y-auto p-4">
                    {issues.length === 0 && <p className="flex items-center gap-2 text-sm text-[var(--color-good)]"><Check size={15} /> Tudo certo para publicar.</p>}
                    {issues.map((issue, index) => (
                      <button key={index} type="button" onClick={() => { if (issue.nodeId) { setSelectedId(issue.nodeId); setNodes((current) => current.map((node) => ({ ...node, selected: node.id === issue.nodeId }))); fitView({ nodes: [{ id: issue.nodeId }], duration: 300, maxZoom: 1 }); } }} className={`flex w-full items-start gap-2 rounded-lg border p-2.5 text-left text-xs ${issue.level === 'error' ? 'border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] text-[var(--color-bad)]' : 'border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] text-[var(--color-warn)]'}`}>
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{issue.message}</span>
                      </button>
                    ))}
                    <div className="pt-3">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">Variáveis disponíveis</p>
                      <div className="flex flex-wrap gap-1">{variables.map((variable) => <button key={variable.name} type="button" title={`Copiar {{${variable.name}}}`} onClick={() => void navigator.clipboard.writeText(`{{${variable.name}}}`)} className="rounded-md bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-brand)] hover:brightness-125">{variable.name}</button>)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3"><p className="text-sm font-semibold text-[var(--color-text)]">Versões publicadas</p><button type="button" onClick={() => setPanel('none')} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={16} /></button></div>
                  <div className="flex-1 space-y-2 overflow-y-auto p-4">
                    {versions.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Nenhuma versão publicada ainda. O que você edita fica no rascunho até publicar.</p>}
                    {versions.map((version) => (
                      <div key={version.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                        <div className="flex items-center justify-between"><p className="text-sm font-semibold text-[var(--color-text)]">Versão {version.version}</p>{version.id === quiz.published_version_id && <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[10px] text-[var(--color-good)]">no ar</span>}</div>
                        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{new Date(version.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {version.flow.nodes.length} blocos</p>
                        <button type="button" onClick={() => restoreVersion(version)} className="mt-2 text-xs text-[var(--color-brand)] hover:underline">Restaurar no rascunho</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </main>

      {(modal === 'settings' || modal === 'appearance') && (
        <QuizSettingsModal
          quiz={quiz}
          products={products}
          initialTab={modal === 'appearance' ? 'appearance' : 'general'}
          onClose={() => setModal('none')}
          onSaved={(saved) => { setQuiz(saved); setModal('none'); setNotice({ tone: 'good', text: 'Configurações salvas.' }); }}
          onProductCreated={(product) => setProducts((current) => [...current, product].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      )}

      {modal === 'preview' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/75 p-3 sm:p-6">
          <div className="mx-auto mb-3 flex w-full max-w-5xl items-center gap-2">
            <p className="text-sm font-semibold text-white">Teste do rascunho</p>
            <span className="text-xs text-white/60">Nada é gravado e nenhum webhook é disparado.</span>
            <div className="ml-auto flex rounded-lg border border-white/20 p-0.5">
              <button type="button" onClick={() => setPreviewFrame('mobile')} className={`rounded-md p-1.5 ${previewFrame === 'mobile' ? 'bg-white/20 text-white' : 'text-white/60'}`} aria-label="Celular"><Smartphone size={15} /></button>
              <button type="button" onClick={() => setPreviewFrame('desktop')} className={`rounded-md p-1.5 ${previewFrame === 'desktop' ? 'bg-white/20 text-white' : 'text-white/60'}`} aria-label="Computador"><Monitor size={15} /></button>
            </div>
            <button type="button" onClick={() => setModal('none')} className="rounded-lg p-1.5 text-white/80 hover:bg-white/10" aria-label="Fechar teste"><X size={18} /></button>
          </div>
          {errors.length > 0 && <p className="mx-auto mb-2 w-full max-w-5xl rounded-lg bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">O fluxo tem {errors.length} erro(s); alguns caminhos podem não funcionar no teste.</p>}
          <div className={`mx-auto min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 shadow-2xl ${previewFrame === 'mobile' ? 'w-[390px] max-w-full' : 'w-full max-w-5xl'}`}>
            <div className="h-full [&>div]:min-h-full">
              <QuizRunner key={previewKey} mode="preview" flow={flow} theme={quiz.theme} title={quiz.title} describeTarget={describeTarget} />
            </div>
          </div>
        </div>
      )}

      {modal === 'publish' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-2xl">
            <h2 id="publish-title" className="font-semibold text-[var(--color-text)]">Publicar versão {(versions[0]?.version ?? 0) + 1}?</h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Quem abrir <span className="font-mono text-[var(--color-brand)]">/q/{quiz.slug}</span> passa a ver esta versão. Quem já está respondendo termina na versão em que começou.</p>
            {issues.length > 0 && <p className="mt-3 rounded-lg bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">{issues.length} aviso(s) no fluxo. Nenhum impede a publicação, mas vale revisar.</p>}
            {!quiz.active && <p className="mt-3 rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">O quiz está pausado: a versão fica pronta, mas o link só funciona depois de ativar em Configurações.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setModal('none')} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancelar</button>
              <button type="button" onClick={() => void confirmPublish()} disabled={publishing} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{publishing ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} Publicar</button>
            </div>
          </div>
        </div>
      )}
    </FlowEditorContext.Provider>
  );
}
