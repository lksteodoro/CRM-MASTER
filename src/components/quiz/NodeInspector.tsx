import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from 'lucide-react';
import {
  NODE_LABELS,
  shortId,
  SYSTEM_VARIABLES,
  toVariableName,
  type ActionOp,
  type ChoiceOption,
  type ConditionOperator,
  type ConditionRule,
  type InputKind,
  type QuizNodeData,
} from '../../../supabase/functions/_shared/quizFlow.ts';
import { NODE_META, OPERATOR_LABELS, type FlowNode } from './flowNodes';
import { inputClass, labelClass } from './quizStyles';


export interface VariableInfo {
  name: string;
  source: string;
  options?: ChoiceOption[];
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-faint)]">{hint}</p>}
    </div>
  );
}

function VariableField({ data, onChange }: { data: QuizNodeData; onChange: (patch: Partial<QuizNodeData>) => void }) {
  return (
    <Field label="Salvar resposta na variável" hint={<>Use <span className="font-mono text-[var(--color-brand)]">{`{{${data.variable || 'variavel'}}}`}</span> em textos, condições e webhooks.</>}>
      <input value={data.variable ?? ''} onChange={(event) => onChange({ variable: toVariableName(event.target.value) })} className={`${inputClass} font-mono`} placeholder="ex.: quantidade_contatos" />
    </Field>
  );
}

function TargetFields({ data, links, onChange }: { data: QuizNodeData; links: { id: string; label: string }[]; onChange: (patch: Partial<QuizNodeData>) => void }) {
  return (
    <>
      <Field label="Destino">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
          {([['link', 'Redirecionador'], ['url', 'URL'], ['whatsapp', 'WhatsApp']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => onChange({ target: value })} className={`rounded-md px-2 py-1.5 text-xs ${data.target === value ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{label}</button>
          ))}
        </div>
      </Field>
      {data.target === 'link' && (
        <Field label="Link do redirecionador" hint="O redirecionador conta o clique e faz o rodízio entre os destinos dele.">
          <select value={data.linkId ?? ''} onChange={(event) => onChange({ linkId: event.target.value || undefined })} className={inputClass}>
            <option value="">— Escolha um link —</option>
            {links.map((link) => <option key={link.id} value={link.id}>{link.label}</option>)}
          </select>
        </Field>
      )}
      {data.target === 'url' && (
        <Field label="URL" hint="Pode usar variáveis, ex.: https://site.com/?nome={{nome}}">
          <input value={data.url ?? ''} onChange={(event) => onChange({ url: event.target.value })} className={inputClass} placeholder="https://..." />
        </Field>
      )}
      {data.target === 'whatsapp' && (
        <>
          <Field label="Número do WhatsApp (com DDD)">
            <input value={data.phone ?? ''} onChange={(event) => onChange({ phone: event.target.value })} className={inputClass} placeholder="(45) 99999-9999" inputMode="tel" />
          </Field>
          <Field label="Mensagem pronta" hint="Já chega preenchida para o lead enviar.">
            <textarea value={data.message ?? ''} onChange={(event) => onChange({ message: event.target.value })} rows={3} className={inputClass} placeholder="Olá! Sou {{nome}} e quero saber mais sobre o disparo." />
          </Field>
        </>
      )}
    </>
  );
}

export function NodeInspector({ node, variables, links, onChange, onDelete, onDuplicate, onClose }: {
  node: FlowNode;
  variables: VariableInfo[];
  links: { id: string; label: string }[];
  onChange: (patch: Partial<QuizNodeData>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  const data = node.data;
  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const [variableTouched, setVariableTouched] = useState(Boolean(data.variable));

  const setOptions = (options: ChoiceOption[]) => onChange({ options });
  const setRules = (rules: ConditionRule[]) => onChange({ rules });
  const setOps = (ops: ActionOp[]) => onChange({ ops });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}><Icon size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-text)]">{NODE_LABELS[node.type]}</p>
          <p className="truncate text-[11px] text-[var(--color-text-muted)]">{meta.description}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar painel"><X size={16} /></button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {node.type !== 'start' && node.type !== 'input' && node.type !== 'choice' && (
          <Field label="Nome do bloco (só aparece no editor)">
            <input value={data.name ?? ''} onChange={(event) => onChange({ name: event.target.value })} className={inputClass} placeholder={NODE_LABELS[node.type]} />
          </Field>
        )}

        {node.type === 'start' && <p className="text-sm text-[var(--color-text-muted)]">Ligue a saída do Início à primeira tela do quiz. A tela de boas-vindas é configurada em <strong>Aparência</strong>.</p>}

        {node.type === 'message' && (
          <>
            <Field label="Texto" hint="Use {{nome}} para personalizar. Ótimo para dar um retorno positivo entre perguntas.">
              <textarea value={data.text ?? ''} onChange={(event) => onChange({ text: event.target.value })} rows={4} className={inputClass} placeholder="Perfeito, {{nome}}! Agora só mais duas perguntas." />
            </Field>
            <Field label="Imagem (URL, opcional)">
              <input value={data.imageUrl ?? ''} onChange={(event) => onChange({ imageUrl: event.target.value })} className={inputClass} placeholder="https://..." />
            </Field>
            <Field label="Texto do botão">
              <input value={data.buttonLabel ?? ''} onChange={(event) => onChange({ buttonLabel: event.target.value })} className={inputClass} placeholder="Continuar" />
            </Field>
          </>
        )}

        {(node.type === 'input' || node.type === 'choice') && (
          <>
            <Field label="Pergunta" hint="Pode usar variáveis de respostas anteriores, ex.: “Qual é o seu WhatsApp, {{nome}}?”">
              <textarea
                value={data.label ?? ''}
                onChange={(event) => {
                  const label = event.target.value;
                  onChange(variableTouched ? { label } : { label, variable: toVariableName(label).split('_').slice(0, 4).join('_') });
                }}
                rows={2}
                className={inputClass}
                placeholder="Qual é o seu nome?"
              />
            </Field>
            {node.type === 'input' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo de resposta">
                  <select value={data.inputKind ?? 'text'} onChange={(event) => onChange({ inputKind: event.target.value as InputKind })} className={inputClass}>
                    <option value="name">Nome</option>
                    <option value="phone">WhatsApp</option>
                    <option value="email">E-mail</option>
                    <option value="number">Número</option>
                    <option value="text">Texto livre</option>
                  </select>
                </Field>
                <Field label="Exemplo no campo">
                  <input value={data.placeholder ?? ''} onChange={(event) => onChange({ placeholder: event.target.value })} className={inputClass} placeholder="Digite aqui" />
                </Field>
              </div>
            )}
            <div onFocusCapture={() => setVariableTouched(true)}><VariableField data={data} onChange={onChange} /></div>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><input type="checkbox" checked={data.required !== false} onChange={(event) => onChange({ required: event.target.checked })} /> Resposta obrigatória</label>
          </>
        )}

        {node.type === 'choice' && (
          <>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><input type="checkbox" checked={Boolean(data.multiple)} onChange={(event) => onChange({ multiple: event.target.checked })} /> Permitir escolher várias opções</label>
            <div>
              <div className="mb-1 flex items-center justify-between"><span className={labelClass}>Opções</span><span className="text-[10px] text-[var(--color-text-faint)]">ícone · texto · valor</span></div>
              <div className="space-y-2">
                {(data.options ?? []).map((option, index, all) => (
                  <div key={option.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                    <div className="flex items-center gap-1.5">
                      <input value={option.emoji ?? ''} onChange={(event) => setOptions(all.map((item) => item.id === option.id ? { ...item, emoji: [...event.target.value].slice(-2).join('') } : item))} className={`${inputClass} w-11 px-1 text-center`} placeholder="😀" aria-label="Ícone" />
                      <input value={option.label} onChange={(event) => setOptions(all.map((item) => item.id === option.id ? { ...item, label: event.target.value, value: item.value && item.value !== toVariableName(item.label) ? item.value : toVariableName(event.target.value) } : item))} className={inputClass} placeholder={`Opção ${index + 1}`} />
                      <div className="flex flex-col">
                        <button type="button" disabled={index === 0} onClick={() => { const next = [...all]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setOptions(next); }} className="p-0.5 text-[var(--color-text-faint)] disabled:opacity-30" aria-label="Subir"><ArrowUp size={12} /></button>
                        <button type="button" disabled={index === all.length - 1} onClick={() => { const next = [...all]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; setOptions(next); }} className="p-0.5 text-[var(--color-text-faint)] disabled:opacity-30" aria-label="Descer"><ArrowDown size={12} /></button>
                      </div>
                      {all.length > 2 && <button type="button" onClick={() => setOptions(all.filter((item) => item.id !== option.id))} className="rounded p-1 text-[var(--color-text-faint)] hover:text-[var(--color-bad)]" aria-label="Remover opção"><Trash2 size={13} /></button>}
                    </div>
                    <input value={option.value} onChange={(event) => setOptions(all.map((item) => item.id === option.id ? { ...item, value: toVariableName(event.target.value) } : item))} className={`${inputClass} mt-1.5 py-1 font-mono text-xs`} placeholder="valor_da_opcao" aria-label="Valor usado nas condições" />
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setOptions([...(data.options ?? []), { id: shortId(), label: '', value: '' }])} className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"><Plus size={13} /> Adicionar opção</button>
              {!data.multiple && <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-faint)]">Cada opção tem uma saída própria no bloco (à direita). Opções sem ligação seguem pela saída “Outras”, embaixo.</p>}
            </div>
          </>
        )}

        {node.type === 'condition' && (
          <>
            <Field label="Combinar regras">
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
                {([['and', 'Todas (E)'], ['or', 'Qualquer uma (OU)']] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => onChange({ combinator: value })} className={`rounded-md px-2 py-1.5 text-xs ${(data.combinator ?? 'and') === value ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}>{label}</button>
                ))}
              </div>
            </Field>
            <div className="space-y-2">
              {(data.rules ?? []).map((rule, index, all) => {
                const variable = variables.find((item) => item.name === rule.variable);
                const update = (patch: Partial<ConditionRule>) => setRules(all.map((item) => item.id === rule.id ? { ...item, ...patch } : item));
                return (
                  <div key={rule.id} className="space-y-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[var(--color-text-faint)]"><span>{index === 0 ? 'Se' : data.combinator === 'or' ? 'Ou' : 'E'}</span><button type="button" onClick={() => setRules(all.filter((item) => item.id !== rule.id))} className="text-[var(--color-text-faint)] hover:text-[var(--color-bad)]" aria-label="Remover regra"><Trash2 size={12} /></button></div>
                    <select value={rule.variable} onChange={(event) => update({ variable: event.target.value, value: '' })} className={`${inputClass} font-mono text-xs`}>
                      <option value="">— variável —</option>
                      {variables.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.source}</option>)}
                    </select>
                    <select value={rule.operator} onChange={(event) => update({ operator: event.target.value as ConditionOperator })} className={`${inputClass} text-xs`}>
                      {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((operator) => <option key={operator} value={operator}>{OPERATOR_LABELS[operator]}</option>)}
                    </select>
                    {!['empty', 'not_empty'].includes(rule.operator) && (
                      variable?.options?.length ? (
                        <select value={rule.value} onChange={(event) => update({ value: event.target.value })} className={`${inputClass} text-xs`}>
                          <option value="">— opção —</option>
                          {variable.options.map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : rule.variable === 'qualificado' ? (
                        <select value={rule.value} onChange={(event) => update({ value: event.target.value })} className={`${inputClass} text-xs`}><option value="sim">sim</option><option value="não">não</option></select>
                      ) : (
                        <input value={rule.value} onChange={(event) => update({ value: event.target.value })} className={`${inputClass} text-xs`} placeholder="valor" />
                      )
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => setRules([...(data.rules ?? []), { id: shortId(), variable: '', operator: 'eq', value: '' }])} className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"><Plus size={13} /> Adicionar regra</button>
            <p className="text-[11px] leading-relaxed text-[var(--color-text-faint)]">Se as regras forem verdadeiras, o lead segue pela saída verde (Sim); senão, pela vermelha (Não). Para mais de dois caminhos, encadeie condições.</p>
          </>
        )}

        {node.type === 'action' && (
          <>
            <div className="space-y-2">
              {(data.ops ?? []).map((op, _, all) => {
                const replace = (next: ActionOp) => setOps(all.map((item) => item.id === op.id ? next : item));
                return (
                  <div key={op.id} className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                    <div className="flex-1 space-y-1.5">
                      {op.kind === 'qualify' && (
                        <select value={op.qualified ? 'yes' : 'no'} onChange={(event) => replace({ ...op, qualified: event.target.value === 'yes' })} className={`${inputClass} text-xs`}>
                          <option value="yes">Marcar como qualificado</option>
                          <option value="no">Marcar como não qualificado</option>
                        </select>
                      )}
                      {op.kind === 'score' && <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">Somar pontos <input type="number" value={op.amount} onChange={(event) => replace({ ...op, amount: event.target.valueAsNumber || 0 })} className={`${inputClass} w-24 text-xs`} /></label>}
                      {op.kind === 'tag' && <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">Tag <input value={op.tag} onChange={(event) => replace({ ...op, tag: event.target.value })} className={`${inputClass} text-xs`} placeholder="lead_quente" /></label>}
                      {op.kind === 'set' && (
                        <div className="grid grid-cols-2 gap-1.5">
                          <input value={op.variable} onChange={(event) => replace({ ...op, variable: toVariableName(event.target.value) })} className={`${inputClass} font-mono text-xs`} placeholder="variavel" />
                          <input value={op.value} onChange={(event) => replace({ ...op, value: event.target.value })} className={`${inputClass} text-xs`} placeholder="valor" />
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => setOps(all.filter((item) => item.id !== op.id))} className="p-1 text-[var(--color-text-faint)] hover:text-[var(--color-bad)]" aria-label="Remover ação"><Trash2 size={13} /></button>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => setOps([...(data.ops ?? []), { id: shortId(), kind: 'qualify', qualified: true }])} className="rounded-lg border border-dashed border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">+ Qualificação</button>
              <button type="button" onClick={() => setOps([...(data.ops ?? []), { id: shortId(), kind: 'score', amount: 10 }])} className="rounded-lg border border-dashed border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">+ Pontos</button>
              <button type="button" onClick={() => setOps([...(data.ops ?? []), { id: shortId(), kind: 'tag', tag: '' }])} className="rounded-lg border border-dashed border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">+ Tag</button>
              <button type="button" onClick={() => setOps([...(data.ops ?? []), { id: shortId(), kind: 'set', variable: '', value: '' }])} className="rounded-lg border border-dashed border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">+ Variável</button>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--color-text-faint)]">A pontuação fica em <span className="font-mono">{'{{pontuacao}}'}</span> e a qualificação em <span className="font-mono">{'{{qualificado}}'}</span>, ambas disponíveis nas condições.</p>
          </>
        )}

        {node.type === 'webhook' && (
          <>
            <Field label="URL do webhook" hint="Ex.: o webhook de um fluxo do n8n. Dispara uma vez por lead, assim que ele passa por este bloco.">
              <input value={data.url ?? ''} onChange={(event) => onChange({ url: event.target.value.trim() })} className={`${inputClass} font-mono text-xs`} placeholder="https://n8n.seudominio.com/webhook/..." />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cabeçalho de autenticação"><input value={data.headerName ?? ''} onChange={(event) => onChange({ headerName: event.target.value })} className={`${inputClass} text-xs`} placeholder="Authorization" /></Field>
              <Field label="Valor"><input type="password" value={data.headerValue ?? ''} onChange={(event) => onChange({ headerValue: event.target.value })} className={`${inputClass} text-xs`} placeholder="Bearer ..." autoComplete="off" /></Field>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Envia um <strong>POST</strong> em JSON com o evento, o quiz, as variáveis, as respostas, a qualificação, a pontuação, as tags e as UTMs. Se falhar, tenta mais 2 vezes. O histórico fica em <strong>Resultados → Webhooks</strong>. O endereço e a chave nunca vão para a página do lead.
            </div>
          </>
        )}

        {node.type === 'redirect' && <TargetFields data={data} links={links} onChange={onChange} />}

        {node.type === 'end' && (
          <>
            <Field label="Título do resultado" hint="Personalize: “{{nome}}, sua empresa tem o perfil ideal”.">
              <input value={data.title ?? ''} onChange={(event) => onChange({ title: event.target.value })} className={inputClass} placeholder="Obrigado, {{nome}}!" />
            </Field>
            <Field label="Texto">
              <textarea value={data.text ?? ''} onChange={(event) => onChange({ text: event.target.value })} rows={4} className={inputClass} placeholder="Explique o resultado e o próximo passo." />
            </Field>
            <Field label="Botão de ação (opcional)" hint="Uma tela final com ação clara converte mais do que só “obrigado”.">
              <input value={data.ctaLabel ?? ''} onChange={(event) => onChange({ ctaLabel: event.target.value, target: data.target ?? 'link' })} className={inputClass} placeholder="Quero conhecer a solução" />
            </Field>
            {data.ctaLabel?.trim() && <TargetFields data={data} links={links} onChange={onChange} />}
          </>
        )}
      </div>

      {node.type !== 'start' && (
        <div className="flex gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button type="button" onClick={onDuplicate} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><Copy size={13} /> Duplicar</button>
          <button type="button" onClick={onDelete} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]"><Trash2 size={13} /> Excluir</button>
        </div>
      )}
    </div>
  );
}

export function collectVariables(nodes: FlowNode[]): VariableInfo[] {
  const list: VariableInfo[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if ((node.type === 'input' || node.type === 'choice') && node.data.variable && !seen.has(node.data.variable)) {
      seen.add(node.data.variable);
      list.push({ name: node.data.variable, source: node.data.label?.slice(0, 40) || NODE_LABELS[node.type], options: node.type === 'choice' ? node.data.options : undefined });
    }
    for (const op of node.data.ops ?? []) {
      if (op.kind === 'set' && op.variable && !seen.has(op.variable)) {
        seen.add(op.variable);
        list.push({ name: op.variable, source: 'Ação' });
      }
    }
  }
  for (const name of SYSTEM_VARIABLES) if (!seen.has(name)) list.push({ name, source: 'sistema' });
  return list;
}
