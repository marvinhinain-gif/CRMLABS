/**
 * Camada de conectores de formulários e quizzes.
 * Cada provedor transforma o que recebe em pares { chave, valor } + UTM, num formato interno único.
 * Depois disso o mapeamento de campos decide o que vira Nome, Telefone, campo personalizado ou resposta.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FieldMapping } from "../../db/schema";

export type Pair = { key: string; value: string };
export type Normalized = { pairs: Pair[]; utm: Record<string, string> };

export type ProviderId = "crmlabs_form" | "webhook" | "typeform" | "tally" | "google_forms" | "api";

export const PROVIDERS: { id: ProviderId; name: string; description: string; signature: "none" | "optional" | "recommended" }[] = [
  { id: "crmlabs_form", name: "Formulário CRMLABS", description: "Página pronta com o seu formulário. Use o link como destino do anúncio, bio ou stories.", signature: "none" },
  { id: "webhook", name: "Webhook CRMLABS", description: "Endereço exclusivo para qualquer ferramenta que envie dados (Zapier, Make, RD Station, landing pages).", signature: "optional" },
  { id: "typeform", name: "Typeform", description: "Formulários e quizzes do Typeform pelo webhook nativo.", signature: "recommended" },
  { id: "tally", name: "Tally", description: "Formulários do Tally pelo webhook nativo.", signature: "recommended" },
  { id: "google_forms", name: "Google Forms", description: "Respostas do Google Forms com um pequeno script que copiamos para você.", signature: "none" },
  { id: "api", name: "API personalizada", description: "Para o seu time técnico enviar leads direto de um sistema próprio.", signature: "optional" },
];

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "ad_id", "ad_name", "adset_name", "campaign_name", "form_name", "platform"];

export const norm = (k: string) =>
  k
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const clean = (v: unknown, max = 2000) => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) v = v.filter((x) => typeof x !== "object").join(", ");
  if (typeof v === "boolean") v = v ? "Sim" : "Não";
  if (typeof v === "object") return "";
  return String(v).replace(/\u0000/g, "").trim().slice(0, max);
};

function pushPair(out: Pair[], key: unknown, value: unknown) {
  const k = clean(key, 120);
  const v = clean(value);
  if (k && v && out.length < 80) out.push({ key: k, value: v });
}

function splitUtm(pairs: Pair[]): Normalized {
  const utm: Record<string, string> = {};
  const rest: Pair[] = [];
  for (const p of pairs) {
    const k = p.key.toLowerCase().trim();
    if (UTM_KEYS.includes(k)) utm[k] = p.value.slice(0, 300);
    else rest.push(p);
  }
  return { pairs: rest, utm };
}

/** Webhook genérico / API / Google Forms: objeto plano, "fields"/"answers", lista de {label,value} ou field_data (Lead Ads da Meta). */
export function normalizeGeneric(body: unknown): Normalized {
  const out: Pair[] = [];
  if (!body || typeof body !== "object") return { pairs: out, utm: {} };
  const obj = body as Record<string, unknown>;
  const fieldData = (obj.field_data ?? (obj.data as Record<string, unknown> | undefined)?.field_data) as { name?: string; values?: unknown[] }[] | undefined;
  if (Array.isArray(fieldData)) for (const f of fieldData) pushPair(out, f?.name, f?.values);
  for (const container of [obj.fields, obj.answers, obj.data, obj.lead]) {
    if (Array.isArray(container)) for (const f of container as Record<string, unknown>[]) pushPair(out, f?.label ?? f?.title ?? f?.name ?? f?.key, f?.value ?? f?.answer);
    else if (container && typeof container === "object" && !Array.isArray(container) && !("field_data" in (container as object))) {
      for (const [k, v] of Object.entries(container as Record<string, unknown>)) pushPair(out, k, v);
    }
  }
  const utmObj = obj.utm;
  if (utmObj && typeof utmObj === "object") for (const [k, v] of Object.entries(utmObj as Record<string, unknown>)) pushPair(out, k.startsWith("utm_") ? k : `utm_${k}`, v);
  for (const [k, v] of Object.entries(obj)) if (!["field_data", "fields", "answers", "data", "lead", "utm"].includes(k)) pushPair(out, k, v);
  return splitUtm(out);
}

/** Typeform: form_response.answers + definition.fields (títulos) + hidden (UTM). */
export function normalizeTypeform(body: unknown): Normalized {
  const out: Pair[] = [];
  const fr = (body as { form_response?: Record<string, unknown> })?.form_response;
  if (!fr) return normalizeGeneric(body);
  const titles = new Map<string, string>();
  for (const f of ((fr.definition as { fields?: { id: string; ref?: string; title?: string }[] })?.fields ?? [])) titles.set(f.id, f.title ?? f.ref ?? f.id);
  for (const a of (fr.answers as Record<string, unknown>[] | undefined) ?? []) {
    const field = a.field as { id: string; ref?: string } | undefined;
    const label = (field && (titles.get(field.id) ?? field.ref)) ?? "Pergunta";
    const t = a.type as string;
    const v =
      t === "choice"
        ? (a.choice as { label?: string; other?: string })?.label ?? (a.choice as { other?: string })?.other
        : t === "choices"
          ? (a.choices as { labels?: string[] })?.labels
          : (a[t] as unknown);
    pushPair(out, label.replace(/\{\{[^}]+\}\}/g, "").trim() || label, v);
  }
  const hidden = fr.hidden as Record<string, unknown> | undefined;
  if (hidden) for (const [k, v] of Object.entries(hidden)) pushPair(out, k, v);
  const vars = fr.variables as { key: string; number?: number; text?: string }[] | undefined;
  if (vars) for (const v of vars) if (v.key === "score") pushPair(out, "Pontuação do quiz", v.number ?? v.text);
  return splitUtm(out);
}

/** Tally: data.fields[] com label/value; escolhas vêm como ids e são traduzidas pelas opções. */
export function normalizeTally(body: unknown): Normalized {
  const out: Pair[] = [];
  const fields = (body as { data?: { fields?: Record<string, unknown>[] } })?.data?.fields;
  if (!Array.isArray(fields)) return normalizeGeneric(body);
  for (const f of fields) {
    let v = f.value as unknown;
    const opts = f.options as { id: string; text: string }[] | undefined;
    if (opts && (Array.isArray(v) || typeof v === "string")) {
      const ids = Array.isArray(v) ? v : [v];
      v = ids.map((id) => opts.find((o) => o.id === id)?.text ?? id);
    }
    pushPair(out, f.label ?? f.key, v);
  }
  return splitUtm(out);
}

export function normalizeFor(provider: string, body: unknown): Normalized {
  if (provider === "typeform") return normalizeTypeform(body);
  if (provider === "tally") return normalizeTally(body);
  return normalizeGeneric(body);
}

// ---------- Assinaturas ----------

function safeEq(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Valida a assinatura quando há segredo configurado.
 * Typeform: "Typeform-Signature: sha256=<base64>". Tally: "Tally-Signature: <base64>".
 * Webhook/API CRMLABS: "X-CRMLABS-Signature: sha256=<hex>" (HMAC-SHA256 do corpo).
 */
export function verifySignature(provider: string, secret: string | null, raw: string, headers: Headers): { ok: boolean; reason?: string } {
  if (!secret) return { ok: true };
  if (provider === "typeform") {
    const h = headers.get("typeform-signature") ?? "";
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("base64")}`;
    return h && safeEq(h, expected) ? { ok: true } : { ok: false, reason: "Assinatura do Typeform inválida ou ausente." };
  }
  if (provider === "tally") {
    const h = headers.get("tally-signature") ?? "";
    const expected = createHmac("sha256", secret).update(raw).digest("base64");
    return h && safeEq(h, expected) ? { ok: true } : { ok: false, reason: "Assinatura do Tally inválida ou ausente." };
  }
  const h = headers.get("x-crmlabs-signature") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return h && safeEq(h, expected) ? { ok: true } : { ok: false, reason: "Assinatura X-CRMLABS-Signature inválida ou ausente." };
}

// ---------- Mapeamento ----------

const AUTO: Record<string, string[]> = {
  name: ["name", "nome", "fullname", "nomecompleto", "seunome", "qualoseunome", "qualseunome", "nomeesobrenome"],
  firstName: ["firstname", "primeironome"],
  lastName: ["lastname", "sobrenome"],
  phone: ["phone", "telefone", "whatsapp", "celular", "phonenumber", "fone", "tel", "seuwhatsapp", "numerodewhatsapp", "qualoseuwhatsapp", "telefonewhatsapp", "whatsappcomddd"],
  email: ["email", "emailaddress", "mail", "seuemail", "qualoseuemail"],
  instagram: ["instagram", "insta", "arroba", "usuariodoinstagram", "ig", "seuinstagram", "qualoseuinstagram", "arrobadoinstagram"],
  preferred: ["melhorhorario", "melhordiaehorario", "preferredtime", "horario", "datareuniao", "melhordia"],
  product: ["produto", "produtodeinteresse", "product", "interesse"],
};

/** Sugestão automática de destino para um campo recebido (usada quando o administrador ainda não mapeou). */
export function suggestTarget(key: string): FieldMapping["target"] | "preferred" | "firstName" | "lastName" {
  const k = norm(key);
  for (const [target, keys] of Object.entries(AUTO)) if (keys.includes(k)) return target as FieldMapping["target"];
  if (/whats|celular|telefone/.test(k)) return "phone";
  if (/email/.test(k)) return "email";
  if (/instagram/.test(k)) return "instagram";
  return "answer";
}

export const IGNORED_KEYS = new Set(["id", "createdtime", "leadgenid", "pageid", "formid", "adgroupid", "isorganic", "token", "secret", "eventid", "eventtype", "createdat", "respondentid", "submissionid", "responseid"]);

export type Mapped = {
  name: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  product: string | null;
  preferred: string | null;
  custom: Record<string, string>;
  answers: { label: string; value: string }[];
};

/** Aplica o mapeamento do administrador (ou a sugestão automática) aos pares recebidos. */
export function applyMapping(pairs: Pair[], map: FieldMapping[]): Mapped {
  const byKey = new Map(map.map((m) => [norm(m.key), m.target]));
  const out: Mapped = { name: null, phone: null, email: null, instagram: null, product: null, preferred: null, custom: {}, answers: [] };
  let first: string | null = null;
  let last: string | null = null;
  for (const p of pairs) {
    if (IGNORED_KEYS.has(norm(p.key))) continue;
    const target = byKey.get(norm(p.key)) ?? suggestTarget(p.key);
    switch (target) {
      case "ignore":
        break;
      case "name":
      case "phone":
      case "email":
      case "instagram":
      case "product":
        out[target] ??= p.value;
        out.answers.push({ label: p.key, value: p.value });
        break;
      case "preferred":
        out.preferred ??= p.value;
        break;
      case "firstName":
        first ??= p.value;
        break;
      case "lastName":
        last ??= p.value;
        break;
      default:
        if (typeof target === "string" && target.startsWith("custom:")) out.custom[target.slice(7)] = p.value;
        out.answers.push({ label: p.key, value: p.value });
    }
  }
  if (!out.name && (first || last)) out.name = [first, last].filter(Boolean).join(" ");
  // Dados de contato não precisam se repetir nas respostas.
  out.answers = out.answers.filter((a) => {
    const t = byKey.get(norm(a.label)) ?? suggestTarget(a.label);
    return !["name", "phone", "email", "instagram"].includes(t as string);
  });
  return out;
}
