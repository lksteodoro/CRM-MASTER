/**
 * Contas do resumo diário, no formato da planilha de acompanhamento:
 * uma linha por dia de cada conta de anúncio (projeto).
 */

export interface DayInput {
  /** AAAA-MM-DD */
  date: string;
  /** Custo do dia, somando as campanhas escolhidas da conta. */
  spend: number;
  /** Leads que o gerenciador de anúncios registrou. */
  metaLeads: number;
  /** Leads que o operador lançou do CRM; null = ainda não preenchido. */
  crmLeads: number | null;
}

export interface DayRow extends DayInput {
  /** Gerenciador − CRM. null enquanto o CRM não foi preenchido. */
  diff: number | null;
  /** Soma dos (leads do CRM − meta diária) até este dia. null sem CRM ou sem meta. */
  gap: number | null;
  /** Custo ÷ leads do gerenciador. */
  cplMeta: number | null;
  /** Custo ÷ leads do CRM. */
  cplCrm: number | null;
  /** Custo ÷ leads do gerenciador nos últimos 3 dias (inclui o dia). */
  cpl3d: number | null;
}

const ratio = (spend: number, leads: number | null) => (leads != null && leads > 0 ? spend / leads : null);

/** Devolve os dias em ordem crescente, já com as colunas calculadas. */
export function buildAccountDays(days: DayInput[], dailyGoal: number | null): DayRow[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let gap = 0;
  return sorted.map((day, index) => {
    const hasCrm = day.crmLeads != null;
    if (hasCrm && dailyGoal != null) gap += (day.crmLeads as number) - dailyGoal;

    const window = sorted.slice(Math.max(0, index - 2), index + 1);
    const windowSpend = window.reduce((sum, item) => sum + item.spend, 0);
    const windowLeads = window.reduce((sum, item) => sum + item.metaLeads, 0);

    return {
      ...day,
      diff: hasCrm ? day.metaLeads - (day.crmLeads as number) : null,
      gap: hasCrm && dailyGoal != null ? gap : null,
      cplMeta: ratio(day.spend, day.metaLeads),
      cplCrm: ratio(day.spend, day.crmLeads),
      cpl3d: ratio(windowSpend, windowLeads),
    };
  });
}

export interface PeriodTotals {
  spend: number;
  metaLeads: number;
  /** Soma só dos dias com CRM preenchido. */
  crmLeads: number;
  daysWithCrm: number;
  cplMeta: number | null;
  cplCrm: number | null;
}

export function totalsOf(rows: DayRow[]): PeriodTotals {
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const metaLeads = rows.reduce((sum, row) => sum + row.metaLeads, 0);
  const withCrm = rows.filter((row) => row.crmLeads != null);
  const crmLeads = withCrm.reduce((sum, row) => sum + (row.crmLeads as number), 0);
  // O CPL do CRM só compara dias que têm CRM, senão o custo dos outros dias distorce.
  const spendWithCrm = withCrm.reduce((sum, row) => sum + row.spend, 0);
  return {
    spend,
    metaLeads,
    crmLeads,
    daysWithCrm: withCrm.length,
    cplMeta: ratio(spend, metaLeads),
    cplCrm: ratio(spendWithCrm, crmLeads),
  };
}
