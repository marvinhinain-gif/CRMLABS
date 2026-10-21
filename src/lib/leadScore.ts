/**
 * Lead score por produto: em qual oferta o lead se encaixa.
 * Vem da sugestão do Quiz de Aplicação (ou do ajuste feito na resposta) e pode ser trocado à mão no lead.
 * Sem dependência do servidor: usado pela lista, pela ficha e pelo backend.
 */
export const LEAD_CLASSES = ["MENTORIA", "CONSULTORIA", "SESSAO", "NAO_ICP"] as const;
export type LeadClass = (typeof LEAD_CLASSES)[number];

export const LEAD_CLASS: Record<LeadClass, { label: string; cls: string; dot: string }> = {
  MENTORIA: { label: "Mentoria", cls: "bg-success-soft text-success", dot: "bg-success" },
  CONSULTORIA: { label: "Consultoria", cls: "bg-info-soft text-info", dot: "bg-info" },
  SESSAO: { label: "Sessões estratégicas", cls: "bg-[#e6f6f5] text-[#0b7a74]", dot: "bg-[#0b7a74]" },
  NAO_ICP: { label: "Não é nosso ICP", cls: "bg-[#fdecec] text-[#b42318]", dot: "bg-[#b42318]" },
};

/** Sem classe: não respondeu a aplicação, ou a sugestão pede análise da equipe. */
export const UNCLASSIFIED = { label: "A classificar", cls: "border border-dashed border-line bg-white text-muted" } as const;

/** Filtro da lista: uma classe ou "none" (a classificar). */
export const LEAD_CLASS_FILTERS = [...LEAD_CLASSES, "none"] as const;
export type LeadClassFilter = (typeof LEAD_CLASS_FILTERS)[number];

/**
 * Produto sugerido pelo quiz → classe. Compara pelo id e pelo nome do produto, para valer também
 * em formulários com produtos próprios (ex.: "Mentoria 90 dias"). Análise manual fica sem classe.
 */
export function classFromProduct(productId: string | null | undefined, productLabel?: string | null): LeadClass | null {
  const p = `${productId ?? ""} ${productLabel ?? ""}`.toLowerCase();
  if (/mentoria/.test(p)) return "MENTORIA";
  if (/consultoria/.test(p)) return "CONSULTORIA";
  if (/sess|sprint/.test(p)) return "SESSAO";
  if (/nutri|n[aã]o.{0,6}icp/.test(p)) return "NAO_ICP";
  return null;
}
