/**
 * Modelos de formulário. O modelo "Diagnóstico Estratégico — AXION" é a configuração inicial:
 * pesos, faixas e travas são hipóteses comerciais e podem ser editados no painel.
 */
import type { Appearance, ConsentSettings, QuizDefinition, QuizOption, QuizQuestion, Route, Tier } from "./types";

/** Etapas resolvidas para a organização (os modelos não conhecem ids). */
export type StageRefs = { relationship: (key: string) => string | null };

export const APPEARANCE_PRESETS: Record<"clean" | "dark", Omit<Appearance, "logoAssetId" | "coverAssetId" | "layout" | "review">> = {
  clean: { preset: "clean", primary: "#008a65", secondary: "#e5f6ef", background: "#ffffff", text: "#172b35", font: "poppins", radius: 16, buttonStyle: "solid", progressBar: true, animations: true, finalStyle: "celebration" },
  dark: { preset: "dark", primary: "#2fd39b", secondary: "#173a30", background: "#0d1714", text: "#eef6f3", font: "poppins", radius: 16, buttonStyle: "solid", progressBar: true, animations: true, finalStyle: "celebration" },
};

export const DEFAULT_APPEARANCE: Appearance = { ...APPEARANCE_PRESETS.clean, logoAssetId: null, coverAssetId: null, layout: "one_per_screen", review: true };

export const DEFAULT_COMPLETION =
  "Obrigado por compartilhar essas informações! Nossa equipe vai analisar o momento da sua operação para identificar qual solução da AXION faz mais sentido para seus objetivos.";

export const DEFAULT_CONSENT: ConsentSettings = {
  noticeText: "Li e estou ciente de que meus dados serão usados pela AXION para analisar minha solicitação e entrar em contato sobre ela.",
  marketingEnabled: true,
  marketingText: "Quero receber conteúdos e ofertas da AXION por e-mail e WhatsApp (opcional).",
  policyUrl: null,
  version: "2026-10-v1",
};

export const route = (r: Partial<Route> = {}): Route => ({
  mode: "relationship",
  stageId: null,
  salesStageId: null,
  assignMode: "round_robin",
  fixedAssigneeId: null,
  assigneeIds: [],
  notify: true,
  ...r,
});

let n = 0;
/** Identificador curto e estável para perguntas/alternativas criadas no editor. */
export function uid(prefix = "q") {
  n = (n + 1) % 1e6;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}${n.toString(36)}`;
}

const opt = (id: string, label: string, points: number): QuizOption => ({ id, label, points });

const q = (id: string, type: QuizQuestion["type"], title: string, extra: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id,
  type,
  title,
  required: true,
  scored: false,
  crmField: "none",
  description: null,
  placeholder: null,
  imageAssetId: null,
  showIf: null,
  ...extra,
});

export function blankDefinition(title = "Novo formulário"): QuizDefinition {
  return {
    schemaVersion: 1,
    sections: [
      {
        id: "secao_1",
        title: "Seus dados",
        description: null,
        questions: [
          q("nome", "short_text", "Qual é o seu nome completo?", { crmField: "name", placeholder: "Seu nome" }),
          q("email", "email", "Qual é o seu melhor e-mail?", { crmField: "email", placeholder: "nome@empresa.com" }),
          q("whatsapp", "phone", "Qual é o seu número de WhatsApp com DDD?", { crmField: "phone", placeholder: "(71) 99999-0000" }),
        ],
      },
    ],
    appearance: { ...DEFAULT_APPEARANCE },
    settings: {
      title,
      description: null,
      welcome: null,
      completion: DEFAULT_COMPLETION,
      redirectUrl: null,
      notifyUserIds: [],
      sourceId: null,
      productId: null,
      campaign: null,
      tags: [],
      defaultRoute: route(),
      consent: { ...DEFAULT_CONSENT },
    },
    scoring: { enabled: false, normalize: true, tiers: [] },
  };
}

export const AXION_TEMPLATE_KEY = "axion-diagnostico";

/** Diagnóstico Estratégico — AXION (duas etapas, 8 perguntas comerciais, 100 pontos). */
export function axionDefinition(refs: StageRefs): QuizDefinition {
  const base = blankDefinition("Diagnóstico Estratégico — AXION");
  const fat = q("faturamento", "single_choice", "Qual é o seu faturamento médio mensal com infoprodutos nos últimos 3 meses?", {
    scored: true,
    crmField: "custom:faturamento",
    options: [
      opt("fat_100k_mais", "Acima de R$ 100 mil", 20),
      opt("fat_50_100k", "De R$ 50 mil a R$ 100 mil", 17),
      opt("fat_20_50k", "De R$ 20 mil a R$ 50 mil", 12),
      opt("fat_5_20k", "De R$ 5 mil a R$ 20 mil", 6),
      opt("fat_ate_5k", "Abaixo de R$ 5 mil ou ainda não vendo", 0),
    ],
  });
  const margem = q("margem", "single_choice", "Qual é a margem de lucro líquido aproximada da sua operação?", {
    scored: true,
    options: [
      opt("mg_30_mais", "Acima de 30%", 8),
      opt("mg_15_30", "Entre 15% e 30%", 10),
      opt("mg_5_15", "Entre 5% e 15%", 8),
      opt("mg_zero", "Próxima de zero ou negativa", 6),
      opt("mg_nao_sei", "Não sei calcular", 2),
    ],
  });
  const tempo = q("tempo_operacao", "single_choice", "Há quanto tempo sua operação vende infoprodutos?", {
    scored: true,
    options: [
      opt("tp_2a_mais", "Há mais de 2 anos", 10),
      opt("tp_1_2a", "Entre 1 e 2 anos", 9),
      opt("tp_6_12m", "Entre 6 e 12 meses", 7),
      opt("tp_3_6m", "Entre 3 e 6 meses", 4),
      opt("tp_menos_3m", "Há menos de 3 meses ou ainda não comecei", 0),
    ],
  });
  const desafio = q("desafio", "single_choice", "Qual é o maior desafio que impede sua operação de crescer hoje?", {
    scored: true,
    crmField: "custom:dor_principal",
    options: [
      opt("ds_escalar", "Escalar vendas mantendo a lucratividade", 15),
      opt("ds_processos", "Estruturar processos, equipe e automações", 15),
      opt("ds_conversao", "Melhorar conversão, ofertas e aquisição", 12),
      opt("ds_validar", "Validar um produto ou encontrar a primeira oferta", 4),
      opt("ds_nao_sei", "Ainda não sei o que vender", 0),
    ],
  });
  const estrutura = q("estrutura", "single_choice", "Como sua operação está estruturada atualmente?", {
    scored: true,
    options: [
      opt("es_completa", "Tenho equipe, processos e indicadores", 10),
      opt("es_equipe", "Tenho equipe, mas os processos são desorganizados", 9),
      opt("es_prestadores", "Tenho alguns prestadores e faço parte da operação", 7),
      opt("es_sozinho", "Faço praticamente tudo sozinho", 3),
      opt("es_nenhuma", "Ainda não tenho operação", 0),
    ],
  });
  const resultado = q("resultado_90d", "single_choice", "Qual resultado você deseja alcançar nos próximos 90 dias?", {
    scored: true,
    crmField: "custom:objetivo",
    options: [
      opt("rs_escalar", "Escalar faturamento com margem de lucro", 10),
      opt("rs_organizar", "Organizar a operação para crescer com previsibilidade", 10),
      opt("rs_otimizar", "Otimizar oferta, tráfego e conversão", 8),
      opt("rs_primeiras", "Fazer as primeiras vendas", 2),
      opt("rs_sem_meta", "Ainda não tenho uma meta definida", 0),
    ],
  });
  const invest = q("investimento", "single_choice", "Quanto você tem disponível para investir em acompanhamento estratégico nos próximos 30 dias?", {
    scored: true,
    crmField: "custom:investimento",
    options: [
      opt("iv_35k_mais", "R$ 35 mil ou mais", 15),
      opt("iv_20_35k", "De R$ 20 mil a menos de R$ 35 mil", 12),
      opt("iv_10_20k", "De R$ 10 mil a menos de R$ 20 mil", 8),
      opt("iv_2_10k", "De R$ 2 mil a menos de R$ 10 mil", 3),
      opt("iv_ate_2k", "Menos de R$ 2 mil", 0),
    ],
  });
  const prazo = q("prazo", "single_choice", "Em quanto tempo pretende começar a implementar um plano de crescimento?", {
    scored: true,
    options: [
      opt("pz_imediato", "Imediatamente", 10),
      opt("pz_30d", "Nos próximos 30 dias", 8),
      opt("pz_30_90d", "Entre 30 e 90 dias", 5),
      opt("pz_90d_mais", "Daqui a mais de 90 dias", 2),
      opt("pz_pesquisando", "Estou apenas pesquisando possibilidades", 0),
    ],
  });

  const tiers: Tier[] = [
    {
      id: "icp_a",
      label: "ICP A — Lead quente",
      description: "Perfil maduro com potencial para mentoria.",
      min: 80,
      color: "green",
      qualified: true,
      requirements: [
        { id: "req_a_fat", label: "Faturamento de pelo menos R$ 20 mil mensais", questionId: "faturamento", optionIds: ["fat_100k_mais", "fat_50_100k", "fat_20_50k"] },
        { id: "req_a_tempo", label: "Operação com pelo menos 6 meses de atividade", questionId: "tempo_operacao", optionIds: ["tp_2a_mais", "tp_1_2a", "tp_6_12m"] },
        { id: "req_a_invest", label: "Investimento declarado de R$ 20 mil ou mais", questionId: "investimento", optionIds: ["iv_35k_mais", "iv_20_35k"] },
      ],
      demoteTo: "icp_b",
      tags: ["ICP A"],
      route: route({ mode: "sales", assignMode: "round_robin" }),
    },
    {
      id: "icp_b",
      label: "ICP B — Lead qualificado",
      description: "Potencial para consultoria estratégica.",
      min: 60,
      color: "blue",
      qualified: true,
      requirements: [
        { id: "req_b_invest", label: "Investimento declarado de pelo menos R$ 10 mil", questionId: "investimento", optionIds: ["iv_35k_mais", "iv_20_35k", "iv_10_20k"] },
        { id: "req_b_operacao", label: "Operação em funcionamento", questionId: "estrutura", optionIds: ["es_completa", "es_equipe", "es_prestadores", "es_sozinho"] },
      ],
      demoteTo: "icp_c",
      tags: ["ICP B"],
      route: route({ mode: "relationship", stageId: refs.relationship("em-qualificacao") }),
    },
    {
      id: "icp_c",
      label: "ICP C — Lead em desenvolvimento",
      description: "Enviar para nutrição comercial ou produtos de entrada.",
      min: 35,
      color: "yellow",
      qualified: false,
      requirements: [],
      demoteTo: null,
      tags: ["ICP C", "Nutrição"],
      route: route({ mode: "relationship", stageId: refs.relationship("em-relacionamento") }),
    },
    {
      id: "icp_d",
      label: "ICP D — Baixa aderência",
      description: "Não priorizar atendimento premium.",
      min: 0,
      color: "gray",
      qualified: false,
      requirements: [],
      demoteTo: null,
      tags: ["ICP D"],
      route: route({ mode: "none", assignMode: "none", notify: false }),
    },
  ];

  return {
    ...base,
    sections: [
      {
        id: "identificacao",
        title: "Identificação",
        description: "Conte um pouco sobre você.",
        questions: [
          q("nome", "short_text", "Qual é o seu nome completo?", { crmField: "name", placeholder: "Seu nome completo" }),
          q("email", "email", "Qual é o seu melhor e-mail?", { crmField: "email", placeholder: "nome@empresa.com" }),
          q("whatsapp", "phone", "Qual é o seu número de WhatsApp com DDD?", { crmField: "phone", placeholder: "(71) 99999-0000" }),
          q("instagram", "url", "Qual é o seu Instagram?", { crmField: "instagram", placeholder: "@seuperfil ou link do perfil" }),
          q("empresa", "short_text", "Qual é o nome da sua empresa ou operação?", { crmField: "company", placeholder: "Nome da empresa" }),
        ],
      },
      {
        id: "diagnostico",
        title: "Diagnóstico comercial",
        description: "Agora, o momento atual da sua operação.",
        questions: [fat, margem, tempo, desafio, estrutura, resultado, invest, prazo],
      },
    ],
    settings: {
      ...base.settings,
      title: "Diagnóstico Estratégico — AXION",
      description: "Queremos entender o momento atual do seu negócio, identificar seus principais desafios e avaliar como podemos ajudá-lo a alcançar o próximo nível.",
      welcome: "Leva cerca de 3 minutos. Suas respostas são confidenciais.",
      completion: DEFAULT_COMPLETION,
      tags: ["Diagnóstico AXION"],
    },
    appearance: { ...DEFAULT_APPEARANCE, layout: "one_per_screen" },
    scoring: { enabled: true, normalize: true, tiers },
  };
}

export const TEMPLATES = [
  { key: "blank", name: "Em branco", description: "Comece com nome, e-mail e WhatsApp." },
  { key: AXION_TEMPLATE_KEY, name: "Diagnóstico Estratégico — AXION", description: "Qualificação de consultoria com Lead Score de 100 pontos e classificação ICP A–D." },
] as const;
