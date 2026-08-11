import type {
  AdAccount,
  Ad,
  AdSet,
  Campaign,
  Client,
  DailyMetric,
  HourlyMetric,
  Project,
  Vendedor,
} from '../types';

// Deterministic PRNG so the mocked dataset is stable across renders.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

export const clients: Client[] = [
  { id: 'client-1', name: 'Faculdade Horizonte', segment: 'Educação Superior' },
];

export const adAccounts: AdAccount[] = [
  { id: 'acc-1', clientId: 'client-1', name: 'Horizonte — Captação Graduação', metaAccountId: 'act_9182734651' },
  { id: 'acc-2', clientId: 'client-1', name: 'Horizonte — Pós & EAD', metaAccountId: 'act_9182734782' },
  { id: 'acc-3', clientId: 'client-1', name: 'Horizonte — Regional SP/RJ', metaAccountId: 'act_9182734890' },
];

const salespersonNames = [
  'Camila Duarte', 'Rodrigo Nunes', 'Beatriz Lima', 'Felipe Araújo', 'Juliana Rezende', 'Marcos Vinícius',
];

export const vendedores: Vendedor[] = salespersonNames.map((name, i) => ({
  id: `vendedor-client-1-${i + 1}`,
  clientId: 'client-1',
  name,
  salesGoal: 15 + Math.floor(rand() * 15),
  revenueGoal: (30 + Math.floor(rand() * 15)) * 1000,
}));

interface CourseDef {
  key: string;
  name: string;
  accountId: string;
}

const courseDefs: CourseDef[] = [
  { key: 'direito', name: 'Direito', accountId: 'acc-1' },
  { key: 'administracao', name: 'Administração', accountId: 'acc-1' },
  { key: 'enfermagem', name: 'Enfermagem', accountId: 'acc-1' },
  { key: 'psicologia', name: 'Psicologia', accountId: 'acc-3' },
  { key: 'pos-ead', name: 'Pós-Graduação EAD', accountId: 'acc-2' },
  { key: 'mba', name: 'MBA Gestão de Negócios', accountId: 'acc-2' },
];

export const campaigns: Campaign[] = [];
export const adSets: AdSet[] = [];
export const ads: Ad[] = [];
export const projects: Project[] = [];

const objectives: Campaign['objective'][] = ['Leads', 'Conversões', 'Tráfego'];
const creativeTypes: Ad['creativeType'][] = ['Imagem', 'Vídeo', 'Carrossel'];

const adNameParts = [
  'Inscrições Abertas', 'Última Chamada', 'Bolsa até 50%', 'Vestibular Online',
  'Depoimento Aluno', 'Vagas Limitadas', 'Comece Hoje', 'Nota de Corte',
  'Campus Tour', 'Financiamento Facilitado', 'Aulas ao Vivo', 'Grade Curricular',
];

for (const course of courseDefs) {
  const campaignCount = 1 + Math.floor(rand() * 2); // 1-2 campaigns per course
  const campaignIds: string[] = [];

  for (let c = 0; c < campaignCount; c++) {
    const campaignId = `cmp-${course.key}-${c + 1}`;
    campaigns.push({
      id: campaignId,
      adAccountId: course.accountId,
      name: `${course.name} — ${c === 0 ? 'Captação Leads' : 'Remarketing'}`,
      objective: c === 0 ? 'Leads' : pick(objectives),
      status: rand() > 0.15 ? 'active' : 'paused',
    });
    campaignIds.push(campaignId);

    const adSetCount = 2 + Math.floor(rand() * 2); // 2-3 ad sets
    for (let s = 0; s < adSetCount; s++) {
      const adSetId = `adset-${campaignId}-${s + 1}`;
      adSets.push({
        id: adSetId,
        campaignId,
        name: `${['Público Frio', 'Remarketing 7d', 'Lookalike 1%', 'Interesses'][s % 4]}`,
      });

      const adCount = 2 + Math.floor(rand() * 3); // 2-4 ads
      for (let a = 0; a < adCount; a++) {
        ads.push({
          id: `ad-${adSetId}-${a + 1}`,
          adSetId,
          campaignId,
          name: `${course.name} · ${pick(adNameParts)}`,
          creativeType: pick(creativeTypes),
        });
      }
    }
  }

  const leadGoal = 40 + Math.floor(rand() * 60);
  projects.push({
    id: `proj-${course.key}`,
    clientId: 'client-1',
    name: course.name,
    course: course.name,
    campaignIds,
    leadGoal,
    cplGoal: 25 + Math.floor(rand() * 20),
    // meta mensal fixa, independente do período visualizado no dashboard
    monthlyLeadGoal: Math.round(leadGoal * (30 / 7) * (0.85 + rand() * 0.3)),
  });
}

// ---------- Daily metrics (last 60 days) ----------
export const DAYS_OF_HISTORY = 60;

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export const dailyMetrics: DailyMetric[] = [];

const today = new Date();
today.setHours(0, 0, 0, 0);

for (const campaign of campaigns) {
  const baseSpend = 80 + rand() * 220;
  const baseLeadRate = 0.02 + rand() * 0.03; // leads per R$ spend approx
  let trend = 1;

  for (let i = DAYS_OF_HISTORY - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dow = date.getDay();
    const weekendFactor = dow === 0 || dow === 6 ? 0.55 : 1;
    trend += (rand() - 0.48) * 0.02;
    trend = Math.max(0.6, Math.min(1.6, trend));

    const spend = campaign.status === 'paused' && i < 10
      ? baseSpend * 0.1 * weekendFactor
      : baseSpend * weekendFactor * trend * (0.85 + rand() * 0.3);

    const impressions = Math.round(spend * (18 + rand() * 10));
    const reach = Math.round(impressions * (0.55 + rand() * 0.2));
    const linkClicks = Math.round(impressions * (0.018 + rand() * 0.02));
    const pageViews = Math.round(linkClicks * (0.65 + rand() * 0.25));
    const leads = Math.max(0, Math.round(pageViews * (0.12 + baseLeadRate) * (0.8 + rand() * 0.4)));
    const connectedLeads = Math.round(leads * (0.45 + rand() * 0.35));
    const formedLeads = Math.round(connectedLeads * (0.18 + rand() * 0.22));
    const sales = Math.round(formedLeads * (0.55 + rand() * 0.3));

    dailyMetrics.push({
      date: fmtDate(date),
      campaignId: campaign.id,
      spend: Math.round(spend * 100) / 100,
      leads,
      formedLeads,
      impressions,
      reach,
      linkClicks,
      pageViews,
      connectedLeads,
      sales,
    });
  }
}

// ---------- Hourly metrics (today's intraday wave) ----------
export const hourlyShape = [
  0.2, 0.1, 0.05, 0.05, 0.05, 0.1, 0.3, 0.6, 1.1, 1.6, 1.9, 1.7,
  1.5, 1.6, 1.8, 1.9, 1.7, 1.4, 1.6, 2.1, 2.4, 2.0, 1.2, 0.6,
];

export const hourlyMetrics: HourlyMetric[] = [];

for (const campaign of campaigns) {
  const dayTotal = dailyMetrics.find(
    (d) => d.campaignId === campaign.id && d.date === fmtDate(today)
  );
  const totalLeads = dayTotal?.leads ?? 5;
  const totalSpend = dayTotal?.spend ?? 100;
  const shapeSum = hourlyShape.reduce((a, b) => a + b, 0);

  for (let hour = 0; hour < 24; hour++) {
    const weight = hourlyShape[hour] / shapeSum;
    const jitter = 0.7 + rand() * 0.6;
    hourlyMetrics.push({
      hour,
      campaignId: campaign.id,
      leads: Math.round(totalLeads * weight * jitter),
      spend: Math.round(totalSpend * weight * jitter * 100) / 100,
    });
  }
}

// ---------- Creation helpers (used by the onboarding wizards) ----------
// New records start with no historical metrics/leads — that data only
// exists once the real Meta API/webhook is wired up for that account.
let newEntityCounter = 0;
function nextId(prefix: string) {
  newEntityCounter += 1;
  return `${prefix}-${Date.now()}-${newEntityCounter}`;
}

export function createClient(name: string, segment: string): Client {
  const newClient: Client = { id: nextId('client'), name, segment };
  clients.push(newClient);
  return newClient;
}

export function createAdAccount(clientId: string, name: string, metaAccountId: string): AdAccount {
  const account: AdAccount = { id: nextId('acc'), clientId, name, metaAccountId };
  adAccounts.push(account);
  return account;
}

export function createCampaign(
  adAccountId: string,
  name: string,
  objective: Campaign['objective'],
  status: Campaign['status']
): Campaign {
  const campaign: Campaign = { id: nextId('cmp'), adAccountId, name, objective, status };
  campaigns.push(campaign);
  return campaign;
}

export function createVendedor(clientId: string, name: string, salesGoal: number): Vendedor {
  const vendedor: Vendedor = { id: nextId('vendedor'), clientId, name, salesGoal, revenueGoal: salesGoal * 800 };
  vendedores.push(vendedor);
  return vendedor;
}

export function setVendedorGoal(vendedorId: string, salesGoal: number) {
  const vendedor = vendedores.find((v) => v.id === vendedorId);
  if (vendedor) vendedor.salesGoal = salesGoal;
}

export function setVendedorRevenueGoal(vendedorId: string, revenueGoal: number) {
  const vendedor = vendedores.find((v) => v.id === vendedorId);
  if (vendedor) vendedor.revenueGoal = revenueGoal;
}
