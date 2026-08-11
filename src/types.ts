export interface AdAccount {
  id: string;
  clientId: string;
  name: string;
  metaAccountId: string;
}

export interface Campaign {
  id: string;
  adAccountId: string;
  name: string;
  objective: 'Leads' | 'Conversões' | 'Reconhecimento' | 'Tráfego';
  status: 'active' | 'paused';
}

export interface AdSet {
  id: string;
  campaignId: string;
  name: string;
}

export interface Ad {
  id: string;
  adSetId: string;
  campaignId: string;
  name: string;
  creativeType: 'Imagem' | 'Vídeo' | 'Carrossel';
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  course: string;
  campaignIds: string[];
  leadGoal: number; // meta de referência para o período selecionado no dashboard
  cplGoal: number;
  monthlyLeadGoal: number; // meta fixa do mês calendário, usada no ritmo (pacing)
}

export interface Client {
  id: string;
  name: string;
  segment: string;
}

export interface DailyMetric {
  date: string; // yyyy-mm-dd
  campaignId: string;
  spend: number;
  leads: number;
  formedLeads: number; // leads matriculados
  impressions: number;
  reach: number;
  linkClicks: number;
  pageViews: number;
  connectedLeads: number; // leads que atenderam/responderam contato
  sales: number;
}

export interface HourlyMetric {
  hour: number; // 0-23
  campaignId: string;
  leads: number;
  spend: number;
}

export interface AdPerformance {
  adId: string;
  spend: number;
  leads: number;
  sales: number;
  cpl: number;
}

export type LeadStatus = 'Novo' | 'Contatado' | 'Qualificado' | 'Negociação' | 'Matriculado' | 'Perdido';

export interface Vendedor {
  id: string;
  clientId: string;
  name: string;
  salesGoal: number; // meta de matrículas no mês, usada na competição de ranking
  revenueGoal: number; // meta de faturamento (R$) no mês, para ranking por dinheiro
}

export type PaymentMethod = 'Boleto' | 'Cartão de Crédito' | 'Pix' | 'Financiamento';

export type RankingMetric = 'pontos' | 'matriculas' | 'receita';

export interface RankingSettings {
  title: string;
  metric: RankingMetric;
  pointsPerSale: number; // regra de pontuação: pontos por venda registrada
  prizes: { first: string; second: string; third: string };
  bonusLabel: string; // destaque do 1º lugar, ex: "2X Comissão Dobrada"
}

// Ledger de lançamentos manuais: correções e ajustes nunca sobrescrevem o
// total — cada mudança é uma transação, preservando o histórico (auditoria).
export interface PointsTransaction {
  id: string;
  clientId: string;
  vendedorId: string;
  metric: RankingMetric;
  amount: number; // positivo = adicionar, negativo = retirar
  note: string;
  at: string; // ISO datetime
}

export interface Utm {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
}

export interface Lead {
  id: string;
  projectId: string;
  campaignId: string;
  adSetId: string;
  adId: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string; // ISO datetime
  status: LeadStatus;
  utm: Utm;
  assignedTo: string; // Vendedor.id responsável pelo lead
}

export interface Sale {
  id: string;
  leadId: string;
  projectId: string;
  campaignId: string;
  adSetId: string;
  adId: string;
  value: number;
  course: string;
  closedAt: string; // ISO datetime
  source: 'webhook' | 'manual';
  vendedorId: string;
  paymentMethod: PaymentMethod;
}

export interface Annotation {
  id: string;
  projectId: string;
  date: string; // yyyy-mm-dd
  text: string;
}

export type DateRangePreset = 'today' | 'yesterday' | '7d' | '14d' | '30d' | '180d' | 'custom';

export interface DateRange {
  preset: DateRangePreset;
  start: string;
  end: string;
}
