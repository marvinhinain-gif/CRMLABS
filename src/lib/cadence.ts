/** Cadência do Social Seller: constantes compartilhadas entre cliente e servidor (sem imports de servidor). */

export const CADENCE_CHANNELS = ["call", "whatsapp", "instagram", "other"] as const;
export type CadenceChannel = (typeof CADENCE_CHANNELS)[number];

export const CHANNEL_LABEL: Record<CadenceChannel, string> = {
  call: "Ligação",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  other: "Outro",
};

export const CADENCE_STATUSES = ["active", "responded", "scheduled", "lost", "finished"] as const;
export type CadenceStatus = (typeof CADENCE_STATUSES)[number];

export const STATUS_LABEL: Record<CadenceStatus, string> = {
  active: "Em cadência",
  responded: "Em conversa",
  scheduled: "Reunião agendada",
  lost: "Sem interesse",
  finished: "Cadência encerrada",
};

export type CadenceStepDefault = { key: string; name: string; channel: CadenceChannel; waitDays: number; script: string };

export const DEFAULT_CADENCE_STEPS: CadenceStepDefault[] = [
  {
    key: "ligacao-1",
    name: "Ligação 1",
    channel: "call",
    waitDays: 0,
    script: [
      "O que fazer: ligue assim que o lead entrar. Objetivo: qualificar (momento, faturamento, maior desafio) e agendar a sessão estratégica.",
      "O que falar: \"Oi {nome}, tudo bem? Aqui é {responsavel}, da AXION. Vi que você demonstrou interesse e queria entender melhor o seu momento. Tem 2 minutos?\"",
      "Se não atender: registre \"Não atendeu\" e mande já a Mensagem 1.",
    ].join("\n"),
  },
  {
    key: "mensagem-1",
    name: "Mensagem 1",
    channel: "whatsapp",
    waitDays: 0,
    script: [
      "O que fazer: mande logo depois da ligação não atendida.",
      "O que mandar: \"Oi {nome}, tudo bem? Aqui é {responsavel}, da AXION. Acabei de te ligar para entender melhor o seu momento e ver como podemos te ajudar. Qual o melhor horário pra conversarmos?\"",
    ].join("\n"),
  },
  {
    key: "mensagem-2",
    name: "Mensagem 2",
    channel: "whatsapp",
    waitDays: 1,
    script: [
      "O que fazer: mande no dia seguinte, com algo de valor e uma pergunta curta.",
      "O que mandar: \"{nome}, separei um conteúdo rápido que ajuda quem está no seu momento a destravar o próximo nível. Hoje, qual é o seu maior desafio no negócio?\"",
    ].join("\n"),
  },
  {
    key: "ligacao-2",
    name: "Ligação 2",
    channel: "call",
    waitDays: 1,
    script: [
      "O que fazer: tente de novo em outro horário (se ligou de manhã, ligue no fim da tarde, e vice-versa).",
      "O que falar: \"Oi {nome}, é {responsavel}, da AXION, tentei falar com você ontem. Consegue conversar agora por alguns minutos?\"",
      "Se não atender: registre e siga para o próximo follow-up.",
    ].join("\n"),
  },
  {
    key: "follow-up-1",
    name: "Follow-up 1",
    channel: "whatsapp",
    waitDays: 2,
    script: [
      "O que fazer: retome com uma prova social curta e convide para a sessão estratégica.",
      "O que mandar: \"Oi {nome}, é {responsavel}, da AXION. Ajudamos clientes em situação parecida com a sua a organizar as vendas e crescer com previsibilidade. Que tal uma sessão estratégica rápida para ver se faz sentido pra você?\"",
    ].join("\n"),
  },
  {
    key: "follow-up-final",
    name: "Follow-up final",
    channel: "whatsapp",
    waitDays: 3,
    script: [
      "O que fazer: encerre a cadência com educação, deixando a porta aberta.",
      "O que mandar: \"{nome}, tudo bem? Não quero te incomodar, então vou encerrar por aqui. Se fizer sentido conversar mais pra frente, é só me responder por aqui. Abraço, {responsavel}.\"",
    ].join("\n"),
  },
];

export const CADENCE_OUTCOMES = ["call_answered", "call_no_answer", "message_sent", "replied", "scheduled", "not_interested", "note"] as const;
export type CadenceOutcome = (typeof CADENCE_OUTCOMES)[number];

/** Resultados registrados pelo sistema além dos escolhidos pela pessoa. */
export type CadenceActivityOutcome = CadenceOutcome | "started" | "stopped" | "step_changed";

export const OUTCOME_LABEL: Record<CadenceActivityOutcome, string> = {
  call_answered: "Atendeu",
  call_no_answer: "Não atendeu",
  message_sent: "Mensagem enviada",
  replied: "Respondeu",
  scheduled: "Agendou reunião",
  not_interested: "Sem interesse",
  note: "Anotação",
  started: "Cadência iniciada",
  stopped: "Cadência parada",
  step_changed: "Etapa alterada",
};

/** Efeito de cada resultado: avança, muda a situação ou nada. */
export const OUTCOME_EFFECT: Record<CadenceOutcome, { kind: "advance" } | { kind: "status"; status: CadenceStatus } | { kind: "none" }> = {
  call_answered: { kind: "status", status: "responded" },
  call_no_answer: { kind: "advance" },
  message_sent: { kind: "advance" },
  replied: { kind: "status", status: "responded" },
  scheduled: { kind: "status", status: "scheduled" },
  not_interested: { kind: "status", status: "lost" },
  note: { kind: "none" },
};

/** Prefixo de contacts.next_action gerenciado pela cadência. */
export const CADENCE_ACTION_PREFIX = "Cadência:";

/** Troca {nome} (primeiro nome do lead) e {responsavel} (nome de quem está logado) no roteiro. */
export function fillScript(script: string, vars: { nome?: string | null; responsavel?: string | null }) {
  const first = (vars.nome ?? "").trim().split(/\s+/)[0] ?? "";
  return script.replace(/\{nome\}/gi, first || "tudo bem").replace(/\{responsavel\}/gi, (vars.responsavel ?? "").trim() || "da equipe");
}
