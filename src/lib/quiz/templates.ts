/**
 * Modelos de formulário. O modelo "Diagnóstico Estratégico — AXION" é a configuração inicial:
 * pesos, faixas e travas são hipóteses comerciais e podem ser editados no painel.
 */
import {
  INTENT_CONFLICT,
  INTENT_REF,
  PRODUCT_REF,
  SCORE_REF,
  type Appearance,
  type Condition,
  type ConsentSettings,
  type QuizDefinition,
  type QuizOption,
  type QuizQuestion,
  type RecProduct,
  type RecRequirement,
  type Route,
  type ShowIf,
  type Tier,
} from "./types";

/** Etapas resolvidas para a organização (os modelos não conhecem ids). */
export type StageRefs = { relationship: (key: string) => string | null };

export type PresetKey = "clean" | "dark" | "axion" | "axion_card";
export const APPEARANCE_PRESETS: Record<PresetKey, Omit<Appearance, "logoAssetId" | "coverAssetId" | "layout" | "review" | "counter">> = {
  clean: { preset: "clean", primary: "#008a65", secondary: "#e5f6ef", background: "#ffffff", text: "#172b35", font: "poppins", radius: 16, buttonStyle: "solid", progressBar: true, animations: true, finalStyle: "celebration", frame: "page" },
  dark: { preset: "dark", primary: "#2fd39b", secondary: "#173a30", background: "#0d1714", text: "#eef6f3", font: "poppins", radius: 16, buttonStyle: "solid", progressBar: true, animations: true, finalStyle: "celebration", frame: "page" },
  /** Preto/grafite com dourado (identidade AXION). */
  axion: { preset: "axion", primary: "#d4af37", secondary: "#1c1a14", background: "#0b0b0b", text: "#f5f3ee", font: "poppins", radius: 18, buttonStyle: "pill", progressBar: true, animations: true, finalStyle: "simple", frame: "page" },
  /** Cartão branco sobre cinza-claro, marca "A." com ponto dourado e botão com contorno dourado (padrão). */
  axion_card: { preset: "axion_card", primary: "#d39b38", secondary: "#fbf4e6", background: "#f7f7f7", surface: "#ffffff", text: "#111111", font: "poppins", radius: 18, buttonStyle: "outline", progressBar: true, animations: true, finalStyle: "simple", frame: "card" },
};

export const DEFAULT_APPEARANCE: Appearance = { ...APPEARANCE_PRESETS.axion_card, logoAssetId: null, coverAssetId: null, layout: "one_per_screen", review: true, counter: "question" };

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

const opt = (id: string, label: string, points: number, signal?: string): QuizOption => (signal ? { id, label, points, signal } : { id, label, points });

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
      // Com descrição, o formulário abre na tela do cartão (marca, título, botão e "N perguntas").
      description: "Responda algumas perguntas rápidas para que nossa equipe entenda o seu momento.",
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

// ---------- Quiz de Aplicação AXION (Mentoria, Consultoria e Sessões) ----------

export const AXION_APPLICATION_KEY = "axion-aplicacao";

const cond = (questionId: string, op: Condition["op"], v?: string | number | string[]): Condition =>
  Array.isArray(v) ? { questionId, op, values: v } : v === undefined ? { questionId, op } : { questionId, op, value: v };
const all = (...conditions: Condition[]): ShowIf => ({ mode: "all", conditions });
const any = (...conditions: Condition[]): ShowIf => ({ mode: "any", conditions });
const reqm = (id: string, label: string, when: ShowIf, failProduct: string | null = null): RecRequirement => ({ id, label, when, failProduct });

/**
 * Configuração inicial do documento “Quiz de Aplicação AXION”: 11 perguntas, score de 100 pontos,
 * prioridade por faixa e recomendação de produto por regras. Tudo editável no painel.
 */
export function axionApplicationDefinition(refs: StageRefs): QuizDefinition {
  const base = blankDefinition("Aplicação AXION");
  const questions: QuizQuestion[] = [
    q("full_name", "short_text", "Qual é o seu nome completo?", { crmField: "name", placeholder: "Seu nome completo" }),
    q("whatsapp", "phone", "Qual é o seu WhatsApp com DDD?", { crmField: "phone", placeholder: "(00) 00000-0000" }),
    q("business_profile", "single_choice", "Qual das opções melhor descreve seu negócio atualmente?", {
      scored: true,
      crmField: "custom:perfil_negocio",
      options: [
        opt("P1", "Já vendo produtos digitais de forma recorrente.", 10),
        opt("P2", "Tenho um negócio de serviços e quero expandir para o digital.", 8),
        opt("P3", "Já lancei produtos digitais, mas tenho vendas pontuais.", 5),
        opt("P4", "Tenho conhecimento ou audiência, mas ainda não comecei a vender.", 2),
        opt("P5", "Estou começando do zero.", 0),
      ],
    }),
    q("monthly_revenue_range", "single_choice", "Qual foi o faturamento bruto médio mensal do seu negócio nos últimos 3 meses?", {
      scored: true,
      crmField: "custom:faturamento",
      options: [
        opt("R1", "R$ 150 mil ou mais", 25),
        opt("R2", "R$ 60 mil a R$ 149.999", 22),
        opt("R3", "R$ 30 mil a R$ 59.999", 17),
        opt("R4", "R$ 10 mil a R$ 29.999", 10),
        opt("R5", "Abaixo de R$ 10 mil", 3),
        opt("R6", "Ainda não estou faturando", 0),
      ],
    }),
    q("main_challenge", "single_choice", "Qual é o maior desafio que impede seu negócio de chegar ao próximo nível?", {
      crmField: "custom:dor_principal",
      options: [
        opt("D1", "Vender mais com previsibilidade, sem comprometer o lucro.", 0, "MENTORIA"),
        opt("D2", "Organizar processos, equipe e reduzir minha dependência operacional.", 0, "MENTORIA"),
        opt("D3", "Melhorar a conversão das minhas ofertas ou funis.", 0, "CONSULTORIA"),
        opt("D4", "Resolver um problema específico de tráfego, edição ou copy.", 0, "SESSAO"),
        opt("D5", "Tenho vários problemas e não sei qual resolver primeiro.", 0, "CONSULTORIA"),
        opt("D6", "Ainda preciso desenvolver minha primeira oferta.", 0, "INICIAL"),
      ],
    }),
    q("desired_outcome", "single_choice", "Que tipo de resultado você espera de um acompanhamento estratégico?", {
      crmField: "custom:objetivo",
      options: [
        opt("O1", "Quero acompanhamento nos próximos meses para crescer e estruturar minha operação.", 0, "MENTORIA"),
        opt("O2", "Quero identificar meu principal gargalo e receber um plano para resolvê-lo.", 0, "CONSULTORIA"),
        opt("O3", "Preciso de uma sessão com especialista para resolver um problema pontual.", 0, "SESSAO"),
        opt("O4", "Quero aprender o básico antes de começar a executar.", 0, "INICIAL"),
      ],
    }),
    q("operation_maturity", "single_choice", "Como está estruturada sua operação comercial e de marketing atualmente?", {
      scored: true,
      options: [
        opt("M1", "Tenho ofertas validadas, acompanho indicadores e busco escalar.", 15),
        opt("M2", "Vendo com frequência, mas preciso melhorar processos e indicadores.", 12),
        opt("M3", "Faço vendas pontuais, sem muita previsibilidade.", 7),
        opt("M4", "Ainda estou estruturando minhas ofertas e canais de aquisição.", 3),
        opt("M5", "Não tenho uma operação em funcionamento.", 0),
      ],
    }),
    q("execution_capacity", "single_choice", "Quem seria responsável por colocar em prática as estratégias desenvolvidas com a AXION?", {
      scored: true,
      options: [
        opt("E1", "Tenho uma equipe com responsáveis definidos.", 10),
        opt("E2", "Tenho uma equipe pequena que consegue executar.", 8),
        opt("E3", "Eu mesmo executaria e tenho tempo disponível.", 5),
        opt("E4", "Atualmente não tenho tempo ou estrutura para executar.", 0),
      ],
    }),
    q("start_timeline", "single_choice", "Se identificarmos uma solução adequada para seu negócio, quando pretende começar?", {
      scored: true,
      options: [
        opt("T1", "Imediatamente ou nos próximos 30 dias.", 10),
        opt("T2", "Dentro de 1 a 3 meses.", 7),
        opt("T3", "Dentro de 3 a 6 meses.", 3),
        opt("T4", "Ainda estou apenas pesquisando.", 0),
      ],
    }),
    q("investment_capacity", "single_choice", "Qual faixa de investimento você considera viável para desenvolver seu negócio com acompanhamento especializado?", {
      scored: true,
      crmField: "custom:investimento",
      options: [
        opt("B1", "R$ 30.000 ou mais", 20),
        opt("B2", "R$ 12.000 a R$ 29.999", 14),
        opt("B3", "R$ 3.700 a R$ 11.999", 8),
        opt("B4", "R$ 2.000 a R$ 3.699", 5),
        opt("B5", "Abaixo de R$ 2.000", 0),
        opt("B6", "Preciso conhecer as possibilidades antes de definir.", 0),
      ],
    }),
    q("decision_authority", "single_choice", "Quem toma a decisão sobre investimentos estratégicos no seu negócio?", {
      scored: true,
      options: [
        opt("A1", "Eu mesmo tomo a decisão.", 10),
        opt("A2", "Decido em conjunto com um sócio.", 8),
        opt("A3", "Posso recomendar, mas outra pessoa precisa aprovar.", 4),
        opt("A4", "Não participo desse tipo de decisão.", 0),
      ],
    }),
  ];

  const products: RecProduct[] = [
    { id: "MENTORIA", label: "Mentoria", description: "Acompanhamento de 90 dias. R$ 30 mil (valor cheio R$ 35 mil).", color: "green", needsReview: false, tags: ["Mentoria (sugerida)"], route: route({ mode: "sales", assignMode: "round_robin" }) },
    { id: "CONSULTORIA", label: "Consultoria", description: "Diagnóstico do gargalo e mapa de ação. R$ 12 mil (valor cheio R$ 15 mil).", color: "blue", needsReview: false, tags: ["Consultoria (sugerida)"], route: route({ mode: "sales", assignMode: "round_robin" }) },
    { id: "SESSAO", label: "Sessão Estratégica", description: "Sessão de Tráfego R$ 2 mil · Sessão de Edição R$ 2 mil · Sprint de Estruturação R$ 3,7 mil. Triagem técnica.", color: "teal", needsReview: false, tags: ["Sessão (sugerida)"], route: route({ mode: "sales", assignMode: "round_robin" }) },
    { id: "ANALISE_MANUAL", label: "Análise manual", description: "Revisão do Social Seller ou Closer antes de qualquer oferta.", color: "yellow", needsReview: true, tags: ["Revisão manual"], route: route({ mode: "relationship", stageId: refs.relationship("em-qualificacao") }) },
    { id: "NUTRICAO", label: "Nutrição", description: "Base de relacionamento, sem venda forçada.", color: "gray", needsReview: false, tags: ["Nutrição"], route: route({ mode: "relationship", stageId: refs.relationship("em-relacionamento"), notify: false }) },
  ];

  const budgetGates = [
    reqm("orcamento_confirmado", "Orçamento confirmado (não é B6)", all(cond("investment_capacity", "not_equals", "B6")), "ANALISE_MANUAL"),
    reqm("orcamento_minimo", "Orçamento a partir de R$ 2 mil (não é B5)", all(cond("investment_capacity", "not_equals", "B5")), "NUTRICAO"),
  ];
  const highRevenue = cond("monthly_revenue_range", "in", ["R1", "R2", "R3"]);

  const tiers: Tier[] = [
    { id: "prioridade_alta", label: "Prioridade alta", description: "70 a 100 pontos.", min: 70, color: "green", qualified: true, requirements: [], demoteTo: null, tags: [], route: route({ mode: "sales" }) },
    { id: "prioridade_media", label: "Prioridade média", description: "50 a 69 pontos.", min: 50, color: "blue", qualified: true, requirements: [], demoteTo: null, tags: [], route: route({ mode: "relationship", stageId: refs.relationship("em-qualificacao") }) },
    { id: "prioridade_baixa", label: "Prioridade baixa", description: "0 a 49 pontos.", min: 0, color: "gray", qualified: false, requirements: [], demoteTo: null, tags: [], route: route({ mode: "relationship", stageId: refs.relationship("em-relacionamento"), notify: false }) },
  ];

  return {
    ...base,
    sections: [{ id: "aplicacao", title: "Aplicação", description: null, questions }],
    appearance: { ...DEFAULT_APPEARANCE, review: false },
    settings: {
      ...base.settings,
      title: "Descubra o próximo passo para escalar seu negócio.",
      description: "Responda algumas perguntas para que nossa equipe entenda sua operação e avalie qual caminho estratégico faz mais sentido.",
      welcome: "11 perguntas · leva de 2 a 3 minutos",
      completion:
        "Recebemos suas informações. Nossa equipe vai avaliar o momento do seu negócio e, caso identifique uma possibilidade de trabalho em conjunto, entrará em contato para conversar sobre os próximos passos.",
      tags: ["Aplicação AXION"],
      labels: { start: "Começar aplicação", next: "Continuar", back: "Voltar", submit: "Enviar aplicação", doneTitle: "Aplicação recebida!" },
      consent: {
        ...DEFAULT_CONSENT,
        noticeText: "Li e estou ciente de que meus dados serão usados pela AXION para avaliar minha aplicação e entrar em contato pelo WhatsApp informado.",
        marketingText: "Quero receber conteúdos e novidades da AXION pelo WhatsApp (opcional).",
      },
    },
    scoring: { enabled: true, normalize: true, tiers },
    recommendation: {
      enabled: true,
      products,
      fallbackProduct: "ANALISE_MANUAL",
      rules: [
        { id: "inconsistencia_perfil", label: "Dados conflitantes: faturamento de R$ 30 mil+ com negócio começando do zero.", when: all(highRevenue, cond("business_profile", "equals", "P5")), product: "ANALISE_MANUAL", requirements: [], otherwise: null },
        { id: "inconsistencia_operacao", label: "Dados conflitantes: faturamento de R$ 30 mil+ sem operação em funcionamento.", when: all(highRevenue, cond("operation_maturity", "equals", "M5")), product: "ANALISE_MANUAL", requirements: [], otherwise: null },
        { id: "inconsistencia_vendas", label: "Dados conflitantes: diz vender de forma recorrente, mas ainda não fatura.", when: all(cond("business_profile", "equals", "P1"), cond("monthly_revenue_range", "equals", "R6")), product: "ANALISE_MANUAL", requirements: [], otherwise: null },
        {
          id: "inicio",
          label: "Ainda sem operação ou faturamento, ou quer aprender o básico (P5, R6, M5 ou O4).",
          when: any(cond("business_profile", "equals", "P5"), cond("monthly_revenue_range", "equals", "R6"), cond("operation_maturity", "equals", "M5"), cond("desired_outcome", "equals", "O4")),
          product: "NUTRICAO",
          requirements: [],
          otherwise: null,
        },
        { id: "conflito", label: "Desafio (Q05) e resultado esperado (Q06) indicam caminhos diferentes.", when: all(cond(INTENT_REF, "equals", INTENT_CONFLICT)), product: "ANALISE_MANUAL", requirements: [], otherwise: null },
        {
          id: "mentoria",
          label: "Busca acompanhamento contínuo para crescer e estruturar a operação (Q05 e Q06).",
          when: all(cond(INTENT_REF, "equals", "MENTORIA")),
          product: "MENTORIA",
          requirements: [
            ...budgetGates,
            reqm("m_perfil", "Já vende produtos digitais de forma recorrente (P1)", all(cond("business_profile", "equals", "P1"))),
            reqm("m_faturamento", "Faturamento de R$ 30 mil ou mais por mês (R1–R3)", all(highRevenue)),
            reqm("m_score", "Lead Score de 70 ou mais", all(cond(SCORE_REF, "gte", 70))),
            reqm("m_orcamento", "Investimento de R$ 30 mil ou mais (B1)", all(cond("investment_capacity", "equals", "B1"))),
            reqm("m_execucao", "Tem quem execute (não é E4)", all(cond("execution_capacity", "not_equals", "E4"))),
            reqm("m_decisao", "Decide sozinho ou com sócio (A1/A2)", all(cond("decision_authority", "in", ["A1", "A2"]))),
            reqm("m_prazo", "Quer começar em até 3 meses (T1/T2)", all(cond("start_timeline", "in", ["T1", "T2"]))),
          ],
          otherwise: "ANALISE_MANUAL",
        },
        {
          id: "consultoria",
          label: "Busca diagnóstico do gargalo e um plano de ação (Q05 e Q06).",
          when: all(cond(INTENT_REF, "equals", "CONSULTORIA")),
          product: "CONSULTORIA",
          requirements: [
            ...budgetGates,
            reqm("c_perfil", "Negócio em funcionamento (P1, P2 ou P3)", all(cond("business_profile", "in", ["P1", "P2", "P3"]))),
            reqm("c_faturamento", "Já fatura (não é R6)", all(cond("monthly_revenue_range", "not_equals", "R6"))),
            reqm("c_score", "Lead Score de 50 ou mais", all(cond(SCORE_REF, "gte", 50))),
            reqm("c_orcamento", "Investimento de R$ 12 mil ou mais (B1/B2)", all(cond("investment_capacity", "in", ["B1", "B2"]))),
            reqm("c_execucao", "Tem quem execute (não é E4)", all(cond("execution_capacity", "not_equals", "E4"))),
            reqm("c_decisao", "Decide sozinho ou com sócio (A1/A2)", all(cond("decision_authority", "in", ["A1", "A2"]))),
          ],
          otherwise: "ANALISE_MANUAL",
        },
        {
          id: "sessao",
          label: "Precisa resolver um problema técnico pontual de tráfego, edição ou copy (Q05/Q06).",
          when: all(cond(INTENT_REF, "equals", "SESSAO")),
          product: "SESSAO",
          requirements: [...budgetGates, reqm("s_decisao", "Decide sozinho ou com sócio (A1/A2)", all(cond("decision_authority", "in", ["A1", "A2"])), "ANALISE_MANUAL")],
          otherwise: "ANALISE_MANUAL",
        },
        { id: "inicial", label: "Ainda precisa desenvolver a primeira oferta.", when: all(cond(INTENT_REF, "equals", "INICIAL")), product: "NUTRICAO", requirements: [], otherwise: null },
      ],
      flags: [
        { id: "f_orcamento", label: "Orçamento não confirmado (B6): esclarecer na conversa, não descartar.", when: all(cond("investment_capacity", "equals", "B6")) },
        { id: "f_decisor", label: "Não decide sozinho (A3/A4): envolver o decisor na conversa.", when: all(cond("decision_authority", "in", ["A3", "A4"])) },
        { id: "f_escopo", label: "Perfil de serviços (P2): revisar o escopo comercial antes de fechar.", when: all(cond("business_profile", "equals", "P2"), cond(PRODUCT_REF, "in", ["CONSULTORIA", "MENTORIA", "ANALISE_MANUAL"])) },
        { id: "f_triagem", label: "Triagem técnica: definir se é Tráfego, Edição ou Sprint.", when: all(cond(PRODUCT_REF, "equals", "SESSAO")) },
        { id: "f_sprint", label: "Orçamento comporta a Sessão (R$ 2 mil), não a Sprint (R$ 3,7 mil).", when: all(cond(PRODUCT_REF, "equals", "SESSAO"), cond("investment_capacity", "equals", "B4")) },
        { id: "f_prioridade", label: "Score alto sem produto automático: priorizar a revisão.", when: all(cond(PRODUCT_REF, "equals", "ANALISE_MANUAL"), cond(SCORE_REF, "gte", 70)) },
      ],
    },
  };
}

export const TEMPLATES = [
  { key: "blank", name: "Em branco", description: "Comece com nome, e-mail e WhatsApp." },
  { key: AXION_APPLICATION_KEY, name: "Quiz de Aplicação AXION", description: "11 perguntas, Lead Score de 100 pontos e sugestão de produto: Mentoria, Consultoria, Sessão, Nutrição ou Análise manual." },
  { key: AXION_TEMPLATE_KEY, name: "Diagnóstico Estratégico — AXION", description: "Qualificação de consultoria com Lead Score de 100 pontos e classificação ICP A–D." },
] as const;
