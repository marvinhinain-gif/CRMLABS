/** Validação da definição de um formulário (rascunho salvo pelo editor). */
import { z } from "zod";
import { QUESTION_TYPES } from "./types";

const id = z.string().trim().regex(/^[a-z0-9_-]{1,60}$/i, "Identificador inválido.");
const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Cor inválida.");
const uuid = z.string().uuid();
const text = (max: number) => z.string().max(max);
const optText = (max: number) => z.string().max(max).nullable().optional();

const conditionSchema = z.object({
  questionId: id,
  op: z.enum(["equals", "not_equals", "includes", "not_includes", "answered", "gte", "lte", "in", "not_in"]),
  value: z.union([z.string().max(120), z.number()]).nullable().optional(),
  values: z.array(z.string().max(60)).max(30).optional(),
});
const whenSchema = z.object({ mode: z.enum(["all", "any"]), conditions: z.array(conditionSchema).max(10) });
const showIfSchema = whenSchema.nullable().optional();
const signal = z.string().trim().regex(/^[A-Z0-9_]{1,40}$/, "Use letras maiúsculas, números e _ no sinal (ex.: MENTORIA).");

const questionSchema = z.object({
  id,
  type: z.enum(QUESTION_TYPES),
  title: text(300),
  description: optText(1000),
  placeholder: optText(120),
  required: z.boolean(),
  imageAssetId: uuid.nullable().optional(),
  options: z
    .array(z.object({ id, label: text(200), points: z.number().int().min(-100).max(100), signal: signal.nullable().optional() }))
    .max(30)
    .optional(),
  scale: z
    .object({ min: z.number().int().min(0).max(10), max: z.number().int().min(1).max(10), minLabel: optText(60), maxLabel: optText(60), pointsPerStep: z.number().min(0).max(20) })
    .optional(),
  scored: z.boolean(),
  maxPoints: z.number().int().min(0).max(100).nullable().optional(),
  crmField: z.string().regex(/^(none|name|email|phone|instagram|company|custom:[a-z0-9_]{1,40})$/, "Campo do CRM inválido."),
  showIf: showIfSchema,
});

const routeSchema = z.object({
  mode: z.enum(["relationship", "sales", "none"]),
  stageId: uuid.nullable(),
  salesStageId: uuid.nullable(),
  assignMode: z.enum(["round_robin", "fixed", "none"]),
  fixedAssigneeId: uuid.nullable(),
  assigneeIds: z.array(uuid).max(50),
  notify: z.boolean(),
});

const tierSchema = z.object({
  id,
  label: z.string().trim().min(1, "Dê um nome à faixa.").max(80),
  description: optText(300),
  min: z.number().int().min(0).max(1000),
  color: z.string().max(20),
  qualified: z.boolean(),
  requirements: z.array(z.object({ id, label: z.string().trim().min(1).max(160), questionId: id, optionIds: z.array(id).max(30) })).max(10),
  demoteTo: id.nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
  route: routeSchema,
});

const recommendationSchema = z.object({
  enabled: z.boolean(),
  products: z
    .array(
      z.object({
        id,
        label: z.string().trim().min(1, "Dê um nome ao produto.").max(80),
        description: optText(300),
        color: z.string().max(20),
        needsReview: z.boolean(),
        tags: z.array(z.string().trim().min(1).max(40)).max(10),
        route: routeSchema,
      }),
    )
    .max(12),
  rules: z
    .array(
      z.object({
        id,
        label: z.string().trim().min(1, "Descreva a regra.").max(200),
        when: whenSchema,
        product: id,
        requirements: z.array(z.object({ id, label: z.string().trim().min(1, "Descreva o requisito.").max(200), when: whenSchema, failProduct: id.nullable() })).max(15),
        otherwise: id.nullable(),
      }),
    )
    .max(30),
  flags: z.array(z.object({ id, label: z.string().trim().min(1, "Descreva o alerta.").max(200), when: whenSchema })).max(20),
  fallbackProduct: id.nullable(),
});

const label = z.string().trim().max(60).nullable().optional();

export const linkSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,40}$/, "Use letras minúsculas, números e hífen na chave do link."),
  label: z.string().trim().min(1, "Dê um nome ao link.").max(80),
  kind: z.enum(["stories", "whatsapp_group", "traffic", "bio", "direct", "other"]),
  sourceId: uuid.nullable(),
  utmSource: z.string().trim().max(120).nullable(),
  utmMedium: z.string().trim().max(120).nullable(),
  utmCampaign: z.string().trim().max(160).nullable(),
});
export const linksSchema = z
  .array(linkSchema)
  .max(40)
  .refine((l) => new Set(l.map((x) => x.key)).size === l.length, "Há dois links com a mesma chave.");

export const definitionSchema = z.object({
  schemaVersion: z.literal(1),
  sections: z
    .array(z.object({ id, title: text(160), description: optText(600), questions: z.array(questionSchema).max(60) }))
    .min(1, "Crie ao menos uma seção.")
    .max(20),
  appearance: z.object({
    preset: z.enum(["clean", "dark", "axion", "custom"]),
    primary: color,
    secondary: color,
    background: color,
    text: color,
    font: z.enum(["poppins", "system", "serif", "rounded"]),
    radius: z.number().int().min(0).max(32),
    buttonStyle: z.enum(["solid", "outline", "pill"]),
    progressBar: z.boolean(),
    animations: z.boolean(),
    logoAssetId: uuid.nullable(),
    coverAssetId: uuid.nullable(),
    layout: z.enum(["one_per_screen", "by_section"]),
    review: z.boolean(),
    finalStyle: z.enum(["simple", "celebration"]),
    counter: z.enum(["section", "question", "none"]).optional(),
  }),
  settings: z.object({
    title: text(160),
    description: optText(1000).transform((v) => v ?? null),
    welcome: optText(600).transform((v) => v ?? null),
    completion: text(1000),
    redirectUrl: z
      .string()
      .max(500)
      .regex(/^https:\/\/[^\s]+$/i, "Use um endereço https://")
      .nullable(),
    notifyUserIds: z.array(uuid).max(30),
    sourceId: uuid.nullable(),
    productId: uuid.nullable(),
    campaign: optText(160).transform((v) => v ?? null),
    tags: z.array(z.string().trim().min(1).max(40)).max(15),
    defaultRoute: routeSchema,
    consent: z.object({
      noticeText: z.string().trim().min(10, "Escreva o aviso de tratamento de dados.").max(800),
      marketingEnabled: z.boolean(),
      marketingText: text(500),
      policyUrl: z
        .string()
        .max(500)
        .regex(/^https?:\/\/[^\s]+$/i, "Use um endereço completo (https://…)")
        .nullable(),
      version: z.string().trim().min(1).max(40),
    }),
    labels: z.object({ start: label, next: label, back: label, submit: label, doneTitle: z.string().trim().max(120).nullable().optional() }).optional(),
  }),
  scoring: z.object({ enabled: z.boolean(), normalize: z.boolean(), tiers: z.array(tierSchema).max(8) }),
  recommendation: recommendationSchema.optional(),
});
