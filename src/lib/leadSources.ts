/**
 * Gráfico "Leads por fonte de tráfego" e filtros da página de Leads.
 * Sem dependência do servidor: usado pela lista, pelo gráfico e pelo backend.
 */
export const LEAD_PERIODS = ["7d", "30d", "90d", "all"] as const;
export type LeadPeriod = (typeof LEAD_PERIODS)[number];

export const LEAD_PERIOD_LABEL: Record<LeadPeriod, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  all: "Tudo",
};

/** Dias de cada período (contando hoje). */
export const PERIOD_DAYS: Record<Exclude<LeadPeriod, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Leads sem origem definida (formulário sem origem, importados, etc.). */
export const NO_SOURCE = { id: "none", name: "Sem origem", color: "gray" } as const;
