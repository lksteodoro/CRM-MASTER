import type { Ad, AdSet, Campaign, Lead, LeadStatus, PaymentMethod, Sale, Utm } from '../types';
import { campaigns, adSets, ads, dailyMetrics, projects, vendedores } from './mockData';

// Separate deterministic PRNG stream so this module's generation is stable
// and independent of other mock generators.
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
const rand = mulberry32(101);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

const campaignToProject = new Map<string, string>();
for (const p of projects) {
  for (const cId of p.campaignIds) campaignToProject.set(cId, p.id);
}

const firstNames = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Fábio', 'Gabriela', 'Henrique',
  'Isabela', 'João', 'Karina', 'Leonardo', 'Mariana', 'Nathan', 'Otávio', 'Patrícia',
  'Rafael', 'Sabrina', 'Thiago', 'Vanessa', 'William', 'Yasmin', 'Camila', 'Eduardo',
  'Fernanda', 'Gustavo', 'Helena', 'Igor', 'Julia', 'Lucas',
];
const lastNames = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Pereira', 'Almeida', 'Ribeiro',
  'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa', 'Freitas', 'Cardoso', 'Teixeira',
];

interface Contact {
  name: string;
  email: string;
  phone: string;
}

function fakePerson(): Contact {
  const first = pick(firstNames);
  const last = pick(lastNames);
  const name = `${first} ${last}`;
  const email = `${first}.${last}${Math.floor(rand() * 90 + 10)}@gmail.com`.toLowerCase();
  const phone = `(${11 + Math.floor(rand() * 78)}) 9${Math.floor(1000 + rand() * 8999)}-${Math.floor(1000 + rand() * 8999)}`;
  return { name, email, phone };
}

const coursePricing: Record<string, number> = {
  Direito: 890,
  Administração: 620,
  Enfermagem: 750,
  Psicologia: 780,
  'Pós-Graduação EAD': 320,
  'MBA Gestão de Negócios': 480,
};

function weightForAdId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return 0.3 + ((h >>> 0) % 1000) / 1000;
}

function pickAdWeighted(campaignAds: Ad[]) {
  const weights = campaignAds.map((a) => weightForAdId(a.id));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < campaignAds.length; i++) {
    r -= weights[i];
    if (r <= 0) return campaignAds[i];
  }
  return campaignAds[campaignAds.length - 1];
}

function randomTimeOnDate(dateStr: string) {
  const hour = 7 + Math.floor(rand() * 15); // 07h–22h, mirrors intraday activity window
  const minute = Math.floor(rand() * 60);
  return `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function nonFinalStatus(daysAgo: number): LeadStatus {
  if (daysAgo <= 2) return rand() > 0.5 ? 'Novo' : 'Contatado';
  const r = rand();
  if (r < 0.3) return 'Contatado';
  if (r < 0.5) return 'Qualificado';
  if (r < 0.62) return 'Negociação';
  return 'Perdido';
}

function pickPaymentMethod(): PaymentMethod {
  const r = rand();
  if (r < 0.35) return 'Boleto';
  if (r < 0.6) return 'Cartão de Crédito';
  if (r < 0.8) return 'Pix';
  return 'Financiamento';
}

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const utmChannels: { source: string; medium: string }[] = [
  { source: 'facebook', medium: 'paid-social' },
  { source: 'instagram', medium: 'paid-social' },
  { source: 'messenger', medium: 'paid-social' },
];

function buildUtm(campaign: Campaign, adSet: AdSet, ad: Ad): Utm {
  const channel = pick(utmChannels);
  return {
    source: channel.source,
    medium: channel.medium,
    campaign: slugify(campaign.name),
    content: `${slugify(ad.name)}-${ad.id.slice(-4)}`,
    term: slugify(adSet.name),
  };
}

export const leads: Lead[] = [];
export const sales: Sale[] = [];

const todayMs = Date.now();

// Repeat-lead pool: the same person can submit the form more than once,
// across different campaigns/ads, so we keep a per-project contact pool
// and occasionally reuse an existing contact instead of minting a new one.
const contactPools = new Map<string, Contact[]>();
const REUSE_PROBABILITY = 0.18;

function contactFor(projectId: string): Contact {
  const pool = contactPools.get(projectId) ?? [];
  contactPools.set(projectId, pool);
  if (pool.length > 3 && rand() < REUSE_PROBABILITY) {
    return pick(pool);
  }
  const contact = fakePerson();
  pool.push(contact);
  return contact;
}

for (const project of projects) {
  const projectCampaigns = campaigns.filter((c) => project.campaignIds.includes(c.id));
  if (projectCampaigns.length === 0) continue;
  const basePrice = coursePricing[project.course] ?? 500;
  const clientVendedores = vendedores.filter((v) => v.clientId === project.clientId);

  const rows = dailyMetrics
    .filter((d) => project.campaignIds.includes(d.campaignId))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const row of rows) {
    const campaign = projectCampaigns.find((c) => c.id === row.campaignId)!;
    const campaignAds = ads.filter((a) => a.campaignId === campaign.id);
    if (campaignAds.length === 0) continue;

    const daysAgo = Math.round((todayMs - new Date(row.date).getTime()) / 86400000);
    const dayLeads: Lead[] = [];

    for (let i = 0; i < row.leads; i++) {
      const ad = pickAdWeighted(campaignAds);
      const adSet = adSets.find((s) => s.id === ad.adSetId)!;
      const { name, email, phone } = contactFor(project.id);
      const isFormed = i < row.formedLeads;
      const status: LeadStatus = isFormed ? 'Matriculado' : nonFinalStatus(daysAgo);

      const lead: Lead = {
        id: `lead-${campaign.id}-${row.date}-${i}`,
        projectId: project.id,
        campaignId: campaign.id,
        adSetId: ad.adSetId,
        adId: ad.id,
        name,
        email,
        phone,
        createdAt: randomTimeOnDate(row.date),
        status,
        utm: buildUtm(campaign, adSet, ad),
        assignedTo: clientVendedores.length > 0 ? pick(clientVendedores).id : '',
      };
      leads.push(lead);
      dayLeads.push(lead);
    }

    const formedLeadsToday = dayLeads.slice(0, row.formedLeads);
    const salesCount = Math.min(row.sales, formedLeadsToday.length);
    for (let i = 0; i < salesCount; i++) {
      const lead = formedLeadsToday[i];
      const closeDelayDays = Math.floor(rand() * 6);
      const closedDate = new Date(new Date(row.date).getTime() + closeDelayDays * 86400000);
      const closedIso = closedDate.toISOString().slice(0, 10);
      sales.push({
        id: `sale-${lead.id}`,
        leadId: lead.id,
        projectId: project.id,
        campaignId: campaign.id,
        adSetId: lead.adSetId,
        adId: lead.adId,
        value: Math.round(basePrice * (0.9 + rand() * 0.25) * 100) / 100,
        course: project.course,
        closedAt: randomTimeOnDate(closedIso),
        source: rand() > 0.15 ? 'webhook' : 'manual',
        vendedorId: lead.assignedTo,
        paymentMethod: pickPaymentMethod(),
      });
    }
  }
}

export function adSetName(id: string) {
  return adSets.find((a) => a.id === id)?.name ?? '—';
}

export function adName(id: string) {
  return ads.find((a) => a.id === id)?.name ?? '—';
}

export function campaignName(id: string) {
  return campaigns.find((c) => c.id === id)?.name ?? '—';
}
