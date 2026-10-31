import { createContext, useContext, type ComponentType } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  CircleCheckBig,
  ExternalLink,
  GitBranch,
  ListChecks,
  MessageSquareText,
  Play,
  TextCursorInput,
  Webhook,
  Zap,
} from 'lucide-react';
import {
  NODE_LABELS,
  nodeTitle,
  type ConditionOperator,
  type FlowIssue,
  type QuizNode,
  type QuizNodeData,
  type QuizNodeType,
} from '../../../supabase/functions/_shared/quizFlow.ts';

export type FlowNode = Node<QuizNodeData & Record<string, unknown>, QuizNodeType>;

export const NODE_META: Record<QuizNodeType, { icon: ComponentType<{ size?: number; className?: string }>; color: string; description: string }> = {
  start: { icon: Play, color: '#22c55e', description: 'Onde o quiz começa' },
  message: { icon: MessageSquareText, color: '#38bdf8', description: 'Texto, imagem e botão continuar' },
  input: { icon: TextCursorInput, color: '#a78bfa', description: 'Nome, WhatsApp, e-mail, número ou texto' },
  choice: { icon: ListChecks, color: '#818cf8', description: 'Opções em cards; cada uma pode ter um caminho' },
  condition: { icon: GitBranch, color: '#f59e0b', description: 'Divide o caminho conforme as respostas' },
  action: { icon: Zap, color: '#f472b6', description: 'Qualifica, soma pontos, aplica tag ou grava variável' },
  webhook: { icon: Webhook, color: '#fb923c', description: 'Envia os dados para n8n, CRM ou outro sistema' },
  redirect: { icon: ExternalLink, color: '#4ade80', description: 'Leva para link do redirecionador, URL ou WhatsApp' },
  end: { icon: CircleCheckBig, color: '#94a3b8', description: 'Tela de resultado com botão de ação' },
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: 'é igual a',
  neq: 'é diferente de',
  contains: 'contém',
  not_contains: 'não contém',
  gt: 'maior que',
  gte: 'maior ou igual a',
  lt: 'menor que',
  lte: 'menor ou igual a',
  empty: 'está vazio',
  not_empty: 'está preenchido',
};

const INPUT_KIND_LABELS = { text: 'Texto', name: 'Nome', phone: 'WhatsApp', email: 'E-mail', number: 'Número' } as const;

export interface FlowEditorContextValue {
  issues: Map<string, FlowIssue[]>;
  linkName: (linkId: string | undefined) => string;
}

export const FlowEditorContext = createContext<FlowEditorContextValue>({ issues: new Map(), linkName: () => '' });

const handleClass = '!h-3 !w-3 !border-2 !border-[var(--color-panel)]';

function targetLabel(data: QuizNodeData, linkName: (id: string | undefined) => string) {
  if (data.target === 'link') return data.linkId ? `Link: ${linkName(data.linkId)}` : 'Escolha o link';
  if (data.target === 'url') return data.url || 'Informe a URL';
  if (data.target === 'whatsapp') return data.phone ? `WhatsApp ${data.phone}` : 'Informe o WhatsApp';
  return 'Sem destino';
}

export function describeOps(data: QuizNodeData) {
  return (data.ops ?? []).map((op) => {
    if (op.kind === 'qualify') return op.qualified ? 'Marca como qualificado' : 'Marca como não qualificado';
    if (op.kind === 'score') return `${op.amount >= 0 ? '+' : ''}${op.amount} pontos`;
    if (op.kind === 'tag') return `Tag “${op.tag}”`;
    return `${op.variable} = ${op.value}`;
  });
}

function QuizFlowNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const { issues, linkName } = useContext(FlowEditorContext);
  const meta = NODE_META[type];
  const Icon = meta.icon;
  const nodeIssues = issues.get(id) ?? [];
  const hasError = nodeIssues.some((issue) => issue.level === 'error');
  const asNode = { id, type, position: { x: 0, y: 0 }, data } as QuizNode;

  return (
    <div
      className={`w-[270px] rounded-2xl border bg-[var(--color-panel)] text-left shadow-[0_10px_30px_-18px_rgba(0,0,0,.6)] transition-shadow ${selected ? 'ring-2 ring-[var(--color-brand)]' : ''} ${hasError ? 'border-[var(--color-bad)]' : 'border-[var(--color-border)]'}`}
    >
      {type !== 'start' && <Handle type="target" position={Position.Top} className={handleClass} style={{ background: meta.color }} />}
      <div className="flex items-center gap-2.5 border-b border-[var(--color-border-soft)] px-3 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}><Icon size={15} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: meta.color }}>{NODE_LABELS[type]}</p>
          <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">{type === 'start' ? 'Início do quiz' : nodeTitle(asNode)}</p>
        </div>
        {nodeIssues.length > 0 && <AlertTriangle size={14} className={hasError ? 'text-[var(--color-bad)]' : 'text-[var(--color-warn)]'} />}
      </div>

      <div className="px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        {type === 'start' && <p>O lead começa aqui.</p>}
        {type === 'message' && <p className="line-clamp-3 whitespace-pre-line">{data.text || 'Sem texto'}</p>}
        {type === 'input' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-[var(--color-panel-2)] px-1.5 py-0.5">{INPUT_KIND_LABELS[data.inputKind ?? 'text']}</span>
            {data.variable && <span className="font-mono text-[var(--color-brand)]">{`{{${data.variable}}}`}</span>}
            {data.required === false && <span>opcional</span>}
          </div>
        )}
        {type === 'choice' && (
          <div className="space-y-1">
            {data.variable && <p className="font-mono text-[var(--color-brand)]">{`{{${data.variable}}}`}{data.multiple ? ' · várias' : ''}</p>}
            {(data.options ?? []).map((option) => (
              <div key={option.id} className="relative rounded-lg bg-[var(--color-panel-2)] px-2 py-1.5 pr-4 text-[var(--color-text)]">
                <span className="mr-1">{option.emoji}</span>{option.label || 'Opção sem texto'}
                {!data.multiple && <Handle type="source" position={Position.Right} id={option.id} className={handleClass} style={{ background: meta.color, right: -16 }} />}
              </div>
            ))}
            {!data.multiple && <p className="pt-1 text-right text-[10px] text-[var(--color-text-faint)]">Outras ↓</p>}
          </div>
        )}
        {type === 'condition' && (
          <div className="space-y-1">
            {(data.rules ?? []).map((rule, index) => (
              <p key={rule.id} className="font-mono text-[10.5px] text-[var(--color-text)]">
                {index > 0 && <span className="mr-1 font-sans font-bold text-[var(--color-warn)]">{data.combinator === 'or' ? 'OU' : 'E'}</span>}
                {rule.variable || '?'} <span className="font-sans text-[var(--color-text-muted)]">{OPERATOR_LABELS[rule.operator]}</span> {['empty', 'not_empty'].includes(rule.operator) ? '' : rule.value || '?'}
              </p>
            ))}
            {!(data.rules ?? []).length && <p>Sem regras</p>}
            <div className="flex justify-between pt-1 text-[10px] font-bold"><span className="text-[var(--color-good)]">SIM</span><span className="text-[var(--color-bad)]">NÃO</span></div>
          </div>
        )}
        {type === 'action' && (describeOps(data).length ? describeOps(data).map((text, index) => <p key={index}>• {text}</p>) : <p>Nenhuma ação</p>)}
        {type === 'webhook' && <p className="truncate font-mono">{data.url ? data.url.replace(/^https:\/\//, '') : 'Sem URL'}</p>}
        {type === 'redirect' && <p className="truncate">{targetLabel(data, linkName)}</p>}
        {type === 'end' && (
          <>
            <p className="line-clamp-2">{data.text || 'Sem texto'}</p>
            {data.ctaLabel && <p className="mt-1 truncate font-semibold text-[var(--color-text)]">Botão: {data.ctaLabel} → {targetLabel(data, linkName)}</p>}
          </>
        )}
      </div>

      {type === 'condition' ? (
        <>
          <Handle type="source" position={Position.Bottom} id="yes" className={handleClass} style={{ left: '22%', background: 'var(--color-good)' }} />
          <Handle type="source" position={Position.Bottom} id="no" className={handleClass} style={{ left: '78%', background: 'var(--color-bad)' }} />
        </>
      ) : type === 'redirect' || type === 'end' ? null : (
        <Handle type="source" position={Position.Bottom} id="next" className={handleClass} style={{ background: meta.color }} />
      )}
    </div>
  );
}

export const nodeTypes = Object.fromEntries(
  (Object.keys(NODE_META) as QuizNodeType[]).map((type) => [type, QuizFlowNode])
);
