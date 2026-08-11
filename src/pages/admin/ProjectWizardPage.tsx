import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useFilters } from '../../state/FiltersContext';
import { adAccounts, createCampaign } from '../../data/mockData';
import type { Campaign } from '../../types';
import { Stepper } from '../../components/ui/Stepper';
import { Card } from '../../components/ui/Card';

const steps = ['Projeto', 'Campanhas', 'Metas', 'Revisão'];

interface DraftCampaign {
  name: string;
  objective: Campaign['objective'];
  status: Campaign['status'];
}

const objectives: Campaign['objective'][] = ['Leads', 'Conversões', 'Reconhecimento', 'Tráfego'];

export function ProjectWizardPage() {
  const { clientId } = useParams();
  const { clients, createProject } = useFilters();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const client = clients.find((c) => c.id === clientId);
  const clientAccounts = adAccounts.filter((a) => a.clientId === clientId);

  const [name, setName] = useState('');
  const [adAccountId, setAdAccountId] = useState(clientAccounts[0]?.id ?? '');
  const [campaignsDraft, setCampaignsDraft] = useState<DraftCampaign[]>([]);
  const [leadGoal, setLeadGoal] = useState(70);
  const [cplGoal, setCplGoal] = useState(30);
  const [monthlyLeadGoal, setMonthlyLeadGoal] = useState(300);

  if (!client) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-muted)]">Cliente não encontrado.</p>
      </div>
    );
  }

  function addCampaignRow() {
    setCampaignsDraft((prev) => [...prev, { name: '', objective: 'Leads', status: 'active' }]);
  }

  function updateCampaignRow(i: number, patch: Partial<DraftCampaign>) {
    setCampaignsDraft((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function removeCampaignRow(i: number) {
    setCampaignsDraft((prev) => prev.filter((_, idx) => idx !== i));
  }

  const step1Valid = name.trim().length > 0 && adAccountId.length > 0;
  const validCampaigns = campaignsDraft.filter((c) => c.name.trim().length > 0);

  function finish() {
    const createdCampaignIds = validCampaigns.map(
      (c) => createCampaign(adAccountId, c.name.trim(), c.objective, c.status).id
    );
    const project = createProject({
      clientId: client!.id,
      name: name.trim(),
      course: name.trim(),
      campaignIds: createdCampaignIds,
      leadGoal,
      cplGoal,
      monthlyLeadGoal,
    });
    navigate(`/admin/clientes/${client!.id}`, { state: { newProjectId: project.id } });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <button
          onClick={() => navigate(`/admin/clientes/${client.id}`)}
          className="mb-3 flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ChevronLeft size={14} /> {client.name}
        </button>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Novo Projeto</h1>
        <p className="text-sm text-[var(--color-text-muted)]">para {client.name}</p>
      </div>

      <Stepper steps={steps} current={step} />

      <Card>
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--color-text-muted)]">Nome do projeto / curso</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Direito, MBA Gestão de Negócios..."
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
              />
            </label>

            {clientAccounts.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] p-3 text-xs text-[var(--color-warn)]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                Este cliente ainda não tem conta de anúncio cadastrada. Volte e adicione uma antes de
                continuar.
              </div>
            ) : (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--color-text-muted)]">Conta de anúncio</span>
                <select
                  value={adAccountId}
                  onChange={(e) => setAdAccountId(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
                >
                  {clientAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Registre manualmente as campanhas que já existem para este projeto na Meta Ads (opcional
              — quando a integração com a API estiver ativa, elas serão sincronizadas automaticamente).
            </p>
            {campaignsDraft.map((c, i) => (
              <div key={i} className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nome da campanha
                  <input
                    value={c.name}
                    onChange={(e) => updateCampaignRow(i, { name: e.target.value })}
                    placeholder="ex: Direito — Captação Leads"
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Objetivo
                  <select
                    value={c.objective}
                    onChange={(e) => updateCampaignRow(i, { objective: e.target.value as Campaign['objective'] })}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)]"
                  >
                    {objectives.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => removeCampaignRow(i)}
                  className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-faint)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              onClick={addCampaignRow}
              className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
            >
              <Plus size={13} /> Adicionar campanha
            </button>
            {campaignsDraft.length === 0 && (
              <p className="text-xs text-[var(--color-text-faint)]">
                Nenhuma campanha adicionada — tudo bem, você pode vincular depois em "Configurar".
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--color-text-muted)]">Meta de leads (período exibido no dashboard)</span>
              <input
                type="number"
                value={leadGoal}
                onChange={(e) => setLeadGoal(Number(e.target.value))}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--color-text-muted)]">Meta de custo por lead (R$)</span>
              <input
                type="number"
                value={cplGoal}
                onChange={(e) => setCplGoal(Number(e.target.value))}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--color-text-muted)]">Meta de leads (mês calendário — usada no Ritmo do Mês)</span>
              <input
                type="number"
                value={monthlyLeadGoal}
                onChange={(e) => setMonthlyLeadGoal(Number(e.target.value))}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
              />
            </label>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border-soft)] p-4">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--color-good)]" />
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {clientAccounts.find((a) => a.id === adAccountId)?.name}
                </p>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                Campanhas ({validCampaigns.length})
              </p>
              {validCampaigns.length === 0 ? (
                <p className="text-xs text-[var(--color-text-faint)]">Nenhuma — vincule depois em "Configurar".</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {validCampaigns.map((c, i) => (
                    <div key={i} className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)]">
                      {c.name} <span className="text-[var(--color-text-faint)]">· {c.objective}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2">
                <p className="text-[10px] text-[var(--color-text-faint)]">Meta leads (período)</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{leadGoal}</p>
              </div>
              <div className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2">
                <p className="text-[10px] text-[var(--color-text-faint)]">Meta CPL</p>
                <p className="text-sm font-medium text-[var(--color-text)]">R$ {cplGoal}</p>
              </div>
              <div className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2">
                <p className="text-[10px] text-[var(--color-text-faint)]">Meta mensal</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{monthlyLeadGoal}</p>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-0"
        >
          <ChevronLeft size={15} /> Voltar
        </button>

        {step < steps.length ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={(step === 1 && (!step1Valid || clientAccounts.length === 0))}
            className="flex items-center gap-1 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continuar <ChevronRight size={15} />
          </button>
        ) : (
          <button
            onClick={finish}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <CheckCircle2 size={15} /> Criar Projeto
          </button>
        )}
      </div>
    </div>
  );
}
