/**
 * Motor dos formulários: visibilidade condicional, validação das respostas, Lead Score e classificação.
 * Funções puras. O servidor recalcula tudo a partir das respostas — nada que o navegador envie
 * sobre pontos ou classificação é aceito.
 */
import { CHOICE_TYPES, type AnswerValue, type Answers, type PublicDefinition, type QuizDefinition, type QuizQuestion, type Scoring, type ShowIf, type Tier } from "./types";

export const allQuestions = (def: Pick<QuizDefinition, "sections">) => def.sections.flatMap((s) => s.questions);

// ---------- Valores ----------

export function isEmpty(v: AnswerValue | undefined) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const asList = (v: AnswerValue | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);

// ---------- Condições ----------

export function conditionMet(showIf: ShowIf | null | undefined, answers: Answers) {
  if (!showIf || !showIf.conditions.length) return true;
  const results = showIf.conditions.map((c) => {
    const v = answers[c.questionId];
    switch (c.op) {
      case "answered":
        return !isEmpty(v);
      case "equals":
        return Array.isArray(v) ? v.length === 1 && v[0] === String(c.value) : String(v ?? "") === String(c.value ?? "");
      case "not_equals":
        return Array.isArray(v) ? !(v.length === 1 && v[0] === String(c.value)) : String(v ?? "") !== String(c.value ?? "");
      case "includes":
        return asList(v).includes(String(c.value));
      case "not_includes":
        return !asList(v).includes(String(c.value));
      case "gte":
        return typeof v === "number" ? v >= Number(c.value) : Number(v) >= Number(c.value);
      case "lte":
        return typeof v === "number" ? v <= Number(c.value) : Number(v) <= Number(c.value);
      default:
        return true;
    }
  });
  return showIf.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** Perguntas visíveis com as respostas atuais (perguntas condicionadas a perguntas ocultas também ficam ocultas). */
export function visibleQuestionIds(def: Pick<QuizDefinition, "sections"> | PublicDefinition, answers: Answers) {
  const visible = new Set<string>();
  const effective: Answers = {};
  for (const s of def.sections) {
    for (const q of s.questions) {
      if (conditionMet(q.showIf, effective)) {
        visible.add(q.id);
        effective[q.id] = answers[q.id] ?? null;
      }
    }
  }
  return visible;
}

// ---------- Validação ----------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function phoneDigits(v: string) {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}

export function validPhone(v: string) {
  const d = phoneDigits(v);
  return d.length >= 10 && d.length <= 15;
}

/** Aceita @usuario, usuario, instagram.com/usuario ou outra URL http(s). */
export function parseInstagramOrUrl(v: string): { handle: string | null; url: string | null } | null {
  const t = v.trim();
  if (!t) return null;
  const m = t.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i);
  if (m) return { handle: m[1].toLowerCase(), url: `https://www.instagram.com/${m[1].toLowerCase()}/` };
  const h = t.match(/^@?([A-Za-z0-9._]{1,30})$/);
  if (h) return { handle: h[1].toLowerCase(), url: `https://www.instagram.com/${h[1].toLowerCase()}/` };
  if (/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(t)) return { handle: null, url: t };
  return null;
}

type QLike = Pick<QuizQuestion, "id" | "type" | "required"> & { options?: { id: string }[]; scale?: { min: number; max: number } };

/** Valida e normaliza uma resposta. Retorna o valor limpo ou um erro em português. */
export function checkAnswer(q: QLike, raw: unknown): { value: AnswerValue; error?: string } {
  const req = (msg = "Responda esta pergunta.") => (q.required ? { value: null, error: msg } : { value: null });
  if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) return req();
  const str = typeof raw === "string" ? raw.replace(/\u0000/g, "").trim() : null;
  switch (q.type) {
    case "short_text":
      if (str === null) return { value: null, error: "Resposta inválida." };
      return str ? { value: str.slice(0, 300) } : req();
    case "long_text":
      if (str === null) return { value: null, error: "Resposta inválida." };
      return str ? { value: str.slice(0, 3000) } : req();
    case "email":
      if (!str) return req("Informe seu e-mail.");
      return EMAIL_RE.test(str) && str.length <= 200 ? { value: str.toLowerCase() } : { value: null, error: "Confira o e-mail (ex.: nome@empresa.com)." };
    case "phone":
      if (!str) return req("Informe seu WhatsApp com DDD.");
      return validPhone(str) ? { value: str.slice(0, 40) } : { value: null, error: "Informe o número com DDD (ex.: (71) 99999-0000)." };
    case "url": {
      if (!str) return req();
      const p = parseInstagramOrUrl(str);
      return p ? { value: p.handle && !/^https?:/i.test(str) ? `@${p.handle}` : str.slice(0, 300) } : { value: null, error: "Informe o @ do Instagram ou o link do perfil." };
    }
    case "single_choice":
    case "dropdown":
    case "yes_no": {
      const id = Array.isArray(raw) ? raw[0] : raw;
      if (typeof id !== "string" || !q.options?.some((o) => o.id === id)) return q.required ? { value: null, error: "Escolha uma alternativa." } : { value: null };
      return { value: id };
    }
    case "multi_choice": {
      const ids = (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === "string" && !!q.options?.some((o) => o.id === x));
      const unique = [...new Set(ids)];
      if (!unique.length) return q.required ? { value: null, error: "Escolha ao menos uma alternativa." } : { value: null };
      return { value: unique };
    }
    case "scale": {
      const n = typeof raw === "number" ? raw : Number(str);
      const min = q.scale?.min ?? 0;
      const max = q.scale?.max ?? 10;
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return q.required ? { value: null, error: `Escolha um número de ${min} a ${max}.` } : { value: null };
      return { value: n };
    }
    case "date": {
      if (!str) return req();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(`${str}T12:00:00Z`))) return { value: null, error: "Informe uma data válida." };
      return { value: str };
    }
    case "consent":
      if (raw === true) return { value: true };
      return q.required ? { value: null, error: "É preciso concordar para continuar." } : { value: false };
    default:
      return { value: null, error: "Tipo de pergunta desconhecido." };
  }
}

/** Valida todas as respostas visíveis. Respostas de perguntas ocultas ou inexistentes são descartadas. */
export function validateAnswers(def: Pick<QuizDefinition, "sections"> | PublicDefinition, raw: Record<string, unknown>) {
  const clean: Answers = {};
  const errors: Record<string, string> = {};
  // Primeiro limpa tudo para avaliar condições com valores válidos.
  const pre: Answers = {};
  for (const s of def.sections) for (const q of s.questions) pre[q.id] = checkAnswer({ ...q, required: false }, raw[q.id]).value;
  const visible = visibleQuestionIds(def, pre);
  for (const s of def.sections) {
    for (const q of s.questions) {
      if (!visible.has(q.id)) continue;
      const r = checkAnswer(q, raw[q.id]);
      if (r.error) errors[q.id] = r.error;
      if (!isEmpty(r.value)) clean[q.id] = r.value;
    }
  }
  return { answers: clean, errors, visible };
}

// ---------- Lead Score ----------

/** Pontos máximos de uma pergunta. */
export function questionMax(q: QuizQuestion) {
  if (!q.scored) return 0;
  if (q.type === "multi_choice") {
    const sum = (q.options ?? []).reduce((a, o) => a + Math.max(0, o.points), 0);
    return q.maxPoints != null ? Math.min(sum, q.maxPoints) : sum;
  }
  if (CHOICE_TYPES.includes(q.type)) return Math.max(0, ...(q.options ?? []).map((o) => o.points));
  if (q.type === "scale" && q.scale) return Math.max(0, (q.scale.max - q.scale.min) * q.scale.pointsPerStep);
  return 0;
}

export function questionPoints(q: QuizQuestion, v: AnswerValue | undefined) {
  if (!q.scored || isEmpty(v)) return 0;
  if (q.type === "multi_choice") {
    const sum = asList(v).reduce((a, id) => a + (q.options?.find((o) => o.id === id)?.points ?? 0), 0);
    return q.maxPoints != null ? Math.min(sum, q.maxPoints) : sum;
  }
  if (CHOICE_TYPES.includes(q.type)) return q.options?.find((o) => o.id === asList(v)[0])?.points ?? 0;
  if (q.type === "scale" && q.scale && typeof v === "number") return (v - q.scale.min) * q.scale.pointsPerStep;
  return 0;
}

export function maxPoints(def: Pick<QuizDefinition, "sections">) {
  return allQuestions(def).reduce((a, q) => a + questionMax(q), 0);
}

export type ScoreResult = {
  raw: number;
  max: number;
  /** Score final na escala das faixas (0–100 quando normalizado). */
  score: number;
  perQuestion: Record<string, number>;
};

export function computeScore(def: Pick<QuizDefinition, "sections" | "scoring">, answers: Answers): ScoreResult {
  const visible = visibleQuestionIds(def, answers);
  const perQuestion: Record<string, number> = {};
  let raw = 0;
  for (const q of allQuestions(def)) {
    if (!q.scored) continue;
    const p = visible.has(q.id) ? questionPoints(q, answers[q.id]) : 0;
    perQuestion[q.id] = p;
    raw += p;
  }
  const max = maxPoints(def);
  const score = def.scoring.normalize ? (max > 0 ? Math.max(0, Math.min(100, Math.round((raw / max) * 100))) : 0) : raw;
  return { raw, max, score, perQuestion };
}

export type Classification = {
  tierId: string | null;
  /** Faixa pela pontuação, antes das travas. */
  scoreTierId: string | null;
  /** Caminho percorrido: faixa avaliada e requisitos que falharam. */
  path: { tierId: string; failed: string[] }[];
};

export const sortedTiers = (s: Pick<Scoring, "tiers">) => [...s.tiers].sort((a, b) => b.min - a.min);

/** Faixa pela pontuação e, depois, travas: requisito não atendido rebaixa a classificação. */
export function classify(scoring: Scoring, score: number, answers: Answers): Classification {
  if (!scoring.enabled || !scoring.tiers.length) return { tierId: null, scoreTierId: null, path: [] };
  const tiers = sortedTiers(scoring);
  const start = tiers.find((t) => score >= t.min) ?? tiers[tiers.length - 1];
  const path: Classification["path"] = [];
  let current: Tier | undefined = start;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const failed = current.requirements.filter((r) => !asList(answers[r.questionId]).some((id) => r.optionIds.includes(id))).map((r) => r.label);
    path.push({ tierId: current.id, failed });
    if (!failed.length) return { tierId: current.id, scoreTierId: start.id, path };
    const idx: number = tiers.findIndex((t) => t.id === current!.id);
    current = (current.demoteTo ? tiers.find((t) => t.id === current!.demoteTo) : undefined) ?? tiers[idx + 1];
  }
  // Ciclo ou nenhuma faixa sem requisitos: fica na última faixa avaliada abaixo.
  const last = tiers[tiers.length - 1];
  return { tierId: last.id, scoreTierId: start.id, path };
}

// ---------- Apresentação ----------

/** Texto legível de uma resposta (rótulos das alternativas em vez dos ids). */
export function displayValue(q: Pick<QuizQuestion, "type" | "options">, v: AnswerValue | undefined): string {
  if (isEmpty(v)) return "";
  if (q.type === "consent") return v === true ? "Concordou" : "Não concordou";
  if (CHOICE_TYPES.includes(q.type)) return asList(v).map((id) => q.options?.find((o) => o.id === id)?.label ?? id).join("; ");
  if (q.type === "date" && typeof v === "string") {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  return String(v);
}

/** Remove pontos, regras, destinos e notificações: é isso que a página pública recebe. */
export function publicDefinition(def: QuizDefinition): PublicDefinition {
  const identity = (f: string) => (["name", "email", "phone", "instagram", "company"].includes(f) ? (f as "name") : undefined);
  return {
    sections: def.sections.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description ?? null,
      questions: s.questions.map((q) => ({
        id: q.id,
        type: q.type,
        title: q.title,
        description: q.description ?? null,
        placeholder: q.placeholder ?? null,
        required: q.required,
        imageAssetId: q.imageAssetId ?? null,
        options: q.options?.map((o) => ({ id: o.id, label: o.label })),
        scale: q.scale ? { min: q.scale.min, max: q.scale.max, minLabel: q.scale.minLabel ?? null, maxLabel: q.scale.maxLabel ?? null } : undefined,
        showIf: q.showIf ?? null,
        identity: identity(q.crmField),
      })),
    })),
    appearance: def.appearance,
    settings: {
      title: def.settings.title,
      description: def.settings.description,
      welcome: def.settings.welcome,
      completion: def.settings.completion,
      redirectUrl: def.settings.redirectUrl,
      consent: def.settings.consent,
    },
  };
}

/** Problemas que impedem a publicação. */
export function publishProblems(def: QuizDefinition): string[] {
  const out: string[] = [];
  const qs = allQuestions(def);
  if (!qs.length) out.push("Adicione ao menos uma pergunta.");
  if (!def.settings.title.trim()) out.push("Defina o título público.");
  const ids = new Set<string>();
  for (const q of qs) {
    if (ids.has(q.id)) out.push(`Pergunta duplicada: “${q.title}”.`);
    ids.add(q.id);
    if (!q.title.trim()) out.push("Há uma pergunta sem texto.");
    if (CHOICE_TYPES.includes(q.type) && (q.options?.length ?? 0) < 2) out.push(`“${q.title || "Pergunta"}” precisa de pelo menos duas alternativas.`);
    if (q.type === "scale" && q.scale && q.scale.max <= q.scale.min) out.push(`A escala de “${q.title}” está invertida.`);
    for (const c of q.showIf?.conditions ?? []) {
      const idx = qs.findIndex((x) => x.id === c.questionId);
      if (idx < 0 || idx >= qs.indexOf(q)) out.push(`A condição de “${q.title}” precisa depender de uma pergunta anterior.`);
    }
  }
  const contactFields = qs.filter((q) => ["email", "phone", "instagram"].includes(q.crmField));
  if (!contactFields.length) out.push("Inclua ao menos um campo de contato ligado ao CRM (e-mail, WhatsApp ou Instagram).");
  if (def.scoring.enabled) {
    if (!def.scoring.tiers.length) out.push("Crie ao menos uma faixa de classificação.");
    for (const t of def.scoring.tiers) {
      for (const r of t.requirements) if (!qs.some((q) => q.id === r.questionId)) out.push(`O requisito “${r.label}” (${t.label}) aponta para uma pergunta que não existe mais.`);
    }
  }
  return [...new Set(out)];
}
