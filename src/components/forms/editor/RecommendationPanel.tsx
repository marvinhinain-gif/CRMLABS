"use client";

/**
 * Recomendação de produto: produtos, regras (a primeira que bate decide), requisitos e alertas.
 * Tudo vira uma sugestão interna para a equipe comercial; quem responde nunca vê.
 */
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { allQuestions } from "@/lib/quiz/engine";
import { route as newRoute, uid } from "@/lib/quiz/templates";
import {
  CHOICE_TYPES,
  INTENT_CONFLICT,
  INTENT_REF,
  PRODUCT_REF,
  SCORE_REF,
  type Condition,
  type ConditionOp,
  type QuizDefinition,
  type RecProduct,
  type RecRule,
  type Recommendation,
  type Route,
  type ShowIf,
} from "@/lib/quiz/types";
import { Button, Checkbox, cx, Field, IconButton, Input, Select, Switch } from "@/components/ui";
import { TIER_COLORS, TierBadge } from "../shared";
import { Panel, TagInput, type EditorProps } from "./common";

const COLOR_LABEL: Record<string, string> = { green: "Verde", blue: "Azul", yellow: "Amarelo", gray: "Cinza", red: "Vermelho", purple: "Roxo", teal: "Turquesa" };

type RenderRoute = (p: { value: Route; onChange: (r: Route) => void; idPrefix: string }) => ReactNode;

const emptyRecommendation = (): Recommendation => ({
  enabled: true,
  products: [{ id: "ANALISE_MANUAL", label: "Análise manual", description: null, color: "yellow", needsReview: true, tags: ["Revisão manual"], route: newRoute() }],
  rules: [],
  flags: [],
  fallbackProduct: "ANALISE_MANUAL",
});

// ---------- Condições ----------

type Subject = { id: string; label: string; kind: "choice" | "score" | "intent" | "product"; options: { id: string; label: string }[] };

function subjects(draft: QuizDefinition, withProduct: boolean): Subject[] {
  const qs = allQuestions(draft).filter((q) => CHOICE_TYPES.includes(q.type));
  const signals = [...new Set(qs.flatMap((q) => (q.options ?? []).map((o) => o.signal).filter((s): s is string => !!s)))];
  const out: Subject[] = [
    { id: SCORE_REF, label: "Lead Score (0–100)", kind: "score", options: [] },
    { id: INTENT_REF, label: "Intenção (sinais das respostas)", kind: "intent", options: [...signals.map((s) => ({ id: s, label: s })), { id: INTENT_CONFLICT, label: "Sinais em conflito" }] },
    ...qs.map((q, i) => ({ id: q.id, label: `${i + 1}. ${q.title || "Pergunta sem texto"}`, kind: "choice" as const, options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label })) })),
  ];
  if (withProduct) out.splice(2, 0, { id: PRODUCT_REF, label: "Produto sugerido", kind: "product", options: (draft.recommendation?.products ?? []).map((p) => ({ id: p.id, label: p.label })) });
  return out;
}

const OPS: Record<Subject["kind"], { op: ConditionOp; label: string }[]> = {
  choice: [
    { op: "equals", label: "é" },
    { op: "not_equals", label: "não é" },
    { op: "in", label: "é uma destas" },
    { op: "not_in", label: "não é nenhuma destas" },
  ],
  intent: [
    { op: "equals", label: "é" },
    { op: "not_equals", label: "não é" },
  ],
  product: [
    { op: "equals", label: "é" },
    { op: "in", label: "é um destes" },
  ],
  score: [
    { op: "gte", label: "é maior ou igual a" },
    { op: "lte", label: "é menor ou igual a" },
  ],
};

function defaultCondition(s: Subject): Condition {
  if (s.kind === "score") return { questionId: s.id, op: "gte", value: 50 };
  return { questionId: s.id, op: "equals", value: s.options[0]?.id ?? "" };
}

function WhenEditor({ value, onChange, draft, withProduct, idPrefix }: { value: ShowIf; onChange: (w: ShowIf) => void; draft: QuizDefinition; withProduct?: boolean; idPrefix: string }) {
  const subs = subjects(draft, !!withProduct);
  const setCond = (i: number, c: Condition) => onChange({ ...value, conditions: value.conditions.map((x, j) => (j === i ? c : x)) });
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-page/50 p-3">
      {value.conditions.length > 1 && (
        <div className="flex items-center gap-2 text-[13px]">
          <span>Quando</span>
          <Select aria-label="Combinação das condições" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as ShowIf["mode"] })} className="h-9 w-auto">
            <option value="all">todas</option>
            <option value="any">qualquer uma</option>
          </Select>
          <span>das condições valerem:</span>
        </div>
      )}
      {value.conditions.map((c, i) => {
        const s = subs.find((x) => x.id === c.questionId);
        const ops = s ? OPS[s.kind] : OPS.choice;
        const multi = c.op === "in" || c.op === "not_in";
        return (
          <div key={i} className="flex flex-col gap-2 rounded-[12px] bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="O que avaliar"
                className="h-9 min-w-0 flex-1 basis-56"
                value={c.questionId}
                onChange={(e) => {
                  const next = subs.find((x) => x.id === e.target.value);
                  if (next) setCond(i, defaultCondition(next));
                }}
              >
                {!s && <option value={c.questionId}>Pergunta removida</option>}
                {subs.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Comparação"
                className="h-9 w-auto"
                value={c.op}
                onChange={(e) => {
                  const op = e.target.value as ConditionOp;
                  const toMulti = op === "in" || op === "not_in";
                  setCond(i, toMulti ? { questionId: c.questionId, op, values: c.values ?? (c.value != null ? [String(c.value)] : []) } : { questionId: c.questionId, op, value: c.value ?? c.values?.[0] ?? s?.options[0]?.id ?? "" });
                }}
              >
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {s?.kind === "score" ? (
                <Input aria-label="Pontos" type="number" min={0} max={1000} className="h-9 w-24" value={Number(c.value ?? 0)} onChange={(e) => setCond(i, { ...c, value: Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))) })} />
              ) : !multi ? (
                <Select aria-label="Valor" className="h-9 min-w-0 flex-1 basis-48" value={String(c.value ?? "")} onChange={(e) => setCond(i, { ...c, value: e.target.value })}>
                  {(s?.options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {s?.kind === "choice" ? `${o.id} · ${o.label}` : o.label}
                    </option>
                  ))}
                </Select>
              ) : null}
              <IconButton size="sm" label="Remover condição" disabled={value.conditions.length <= 1} onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
            {multi && s && (
              <div className="grid gap-1 sm:grid-cols-2">
                {s.options.map((o) => (
                  <Checkbox
                    key={o.id}
                    id={`${idPrefix}-${i}-${o.id}`}
                    label={<span className="text-[13px]">{s.kind === "choice" ? <b className="mr-1">{o.id}</b> : null}{o.label}</span>}
                    checked={(c.values ?? []).includes(o.id)}
                    onChange={(v) => setCond(i, { ...c, values: v ? [...(c.values ?? []), o.id] : (c.values ?? []).filter((x) => x !== o.id) })}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {value.conditions.length < 10 && (
        <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-4" />} onClick={() => onChange({ ...value, conditions: [...value.conditions, defaultCondition(subs[2] ?? subs[0])] })}>
          Adicionar condição
        </Button>
      )}
    </div>
  );
}

// ---------- Blocos ----------

function Collapsible({ head, children, defaultOpen = false }: { head: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className={cx("rounded-[18px] border bg-white", open ? "border-brand/60" : "border-line")}>
      <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex min-w-0 flex-1 items-center gap-2">{head}</div>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="flex flex-col gap-4 border-t border-line p-4">{children}</div>}
    </li>
  );
}

function ProductSelect({ value, onChange, products, empty, id, label }: { value: string | null; onChange: (v: string | null) => void; products: RecProduct[]; empty?: string; id: string; label: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        {empty && <option value="">{empty}</option>}
        {value && !products.some((p) => p.id === value) && <option value={value}>Produto removido</option>}
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function RecommendationPanel({ draft, update, renderRoute }: Pick<EditorProps, "draft" | "update"> & { renderRoute: RenderRoute }) {
  const rec = draft.recommendation;
  const setRec = (fn: (r: Recommendation) => void) => update((d) => void (d.recommendation && fn(d.recommendation)));
  const products = rec?.products ?? [];
  const labelOf = (id: string | null) => products.find((p) => p.id === id)?.label ?? "—";

  return (
    <Panel
      title="Recomendação de produto"
      description="Sugere Mentoria, Consultoria, Sessão, Nutrição ou Análise manual a partir das respostas. É uma sugestão interna: a equipe pode ajustar em cada resposta, e quem responde nunca vê."
    >
      <Switch
        label="Sugerir produto"
        description={rec?.enabled ? "O destino no CRM passa a seguir o produto sugerido (a faixa de score vira a prioridade)." : undefined}
        checked={!!rec?.enabled}
        onChange={(v) => update((d) => void (d.recommendation ? (d.recommendation.enabled = v) : v && (d.recommendation = emptyRecommendation())))}
      />
      {rec?.enabled && (
        <div className="mt-3 flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h4 className="text-[14px] font-semibold">Produtos</h4>
            <ul className="flex flex-col gap-2.5">
              {products.map((p, pi) => (
                <Collapsible key={p.id} head={<><TierBadge label={p.label} color={p.color} />{p.needsReview && <span className="text-[12.5px] text-muted">revisão manual</span>}</>}>
                  <div className="grid gap-3 sm:grid-cols-[1fr_160px_150px]">
                    <Field label="Nome" htmlFor={`pl-${p.id}`}>
                      <Input id={`pl-${p.id}`} value={p.label} maxLength={80} onChange={(e) => setRec((r) => void (r.products[pi].label = e.target.value))} />
                    </Field>
                    <Field label="Código" htmlFor={`pid-${p.id}`} hint="Usado nas regras.">
                      <Input id={`pid-${p.id}`} value={p.id} disabled />
                    </Field>
                    <Field label="Cor" htmlFor={`pc-${p.id}`}>
                      <Select id={`pc-${p.id}`} value={p.color} onChange={(e) => setRec((r) => void (r.products[pi].color = e.target.value))}>
                        {TIER_COLORS.map((c) => (
                          <option key={c} value={c}>
                            {COLOR_LABEL[c] ?? c}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Descrição interna (preços, observações)" htmlFor={`pd-${p.id}`}>
                    <Input id={`pd-${p.id}`} value={p.description ?? ""} maxLength={300} onChange={(e) => setRec((r) => void (r.products[pi].description = e.target.value || null))} />
                  </Field>
                  <Switch label="Pede revisão manual" description="Aparece como “revisão necessária” até alguém ajustar." checked={p.needsReview} onChange={(v) => setRec((r) => void (r.products[pi].needsReview = v))} />
                  <Field label="Etiquetas aplicadas ao contato" htmlFor={`pt-${p.id}`}>
                    <TagInput id={`pt-${p.id}`} value={p.tags} onChange={(v) => setRec((r) => void (r.products[pi].tags = v.slice(0, 10)))} placeholder="Ex.: Mentoria (sugerida)" />
                  </Field>
                  <div className="flex flex-col gap-2">
                    <span className="text-[14px] font-semibold">Para onde vai no CRM</span>
                    {renderRoute({ idPrefix: `pr-${p.id}`, value: p.route, onChange: (rt) => setRec((r) => void (r.products[pi].route = rt)) })}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start text-danger"
                    icon={<Trash2 className="size-4" />}
                    onClick={() => {
                      if (!window.confirm(`Excluir o produto "${p.label}"? Regras que apontam para ele precisarão ser revistas.`)) return;
                      setRec((r) => void r.products.splice(pi, 1));
                    }}
                  >
                    Excluir produto
                  </Button>
                </Collapsible>
              ))}
            </ul>
            {products.length < 12 && (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                icon={<Plus className="size-4" />}
                onClick={() => setRec((r) => void r.products.push({ id: uid("PROD").toUpperCase().replace(/[^A-Z0-9_]/g, "_"), label: "Novo produto", description: null, color: "gray", needsReview: false, tags: [], route: newRoute() }))}
              >
                Adicionar produto
              </Button>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-[14px] font-semibold">Regras</h4>
            <p className="text-[12.5px] text-muted">
              Avaliadas de cima para baixo: a primeira cuja condição bate decide. Se todos os requisitos forem atendidos, fica com o produto da regra; se algum falhar, vai para o destino daquele requisito (ou para o “senão” da regra).
            </p>
            <ol className="flex flex-col gap-2.5">
              {rec.rules.map((rule, ri) => (
                <RuleEditor key={rule.id} rule={rule} index={ri} count={rec.rules.length} draft={draft} products={products} setRec={setRec} labelOf={labelOf} />
              ))}
            </ol>
            {rec.rules.length < 30 && (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                icon={<Plus className="size-4" />}
                onClick={() => setRec((r) => void r.rules.push({ id: uid("regra"), label: "Nova regra", when: { mode: "all", conditions: [{ questionId: SCORE_REF, op: "gte", value: 70 }] }, product: r.products[0]?.id ?? "", requirements: [], otherwise: r.fallbackProduct }))}
              >
                Adicionar regra
              </Button>
            )}
            <ProductSelect id="rec-fallback" label="Quando nenhuma regra se aplica" value={rec.fallbackProduct} onChange={(v) => setRec((r) => void (r.fallbackProduct = v))} products={products} empty="Sem sugestão" />
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-[14px] font-semibold">Alertas para a equipe</h4>
            <p className="text-[12.5px] text-muted">Avisos que aparecem na resposta (ex.: envolver o decisor). Não mudam o produto.</p>
            <ul className="flex flex-col gap-2.5">
              {rec.flags.map((f, fi) => (
                <Collapsible key={f.id} head={<span className="truncate text-[13.5px]">{f.label}</span>}>
                  <Field label="Texto do alerta" htmlFor={`fl-${f.id}`}>
                    <Input id={`fl-${f.id}`} value={f.label} maxLength={200} onChange={(e) => setRec((r) => void (r.flags[fi].label = e.target.value))} />
                  </Field>
                  <WhenEditor idPrefix={`fw-${f.id}`} draft={draft} withProduct value={f.when} onChange={(w) => setRec((r) => void (r.flags[fi].when = w))} />
                  <Button size="sm" variant="ghost" className="self-start text-danger" icon={<Trash2 className="size-4" />} onClick={() => setRec((r) => void r.flags.splice(fi, 1))}>
                    Excluir alerta
                  </Button>
                </Collapsible>
              ))}
            </ul>
            {rec.flags.length < 20 && (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                icon={<Plus className="size-4" />}
                onClick={() => setRec((r) => void r.flags.push({ id: uid("alerta"), label: "Novo alerta", when: { mode: "all", conditions: [{ questionId: SCORE_REF, op: "gte", value: 70 }] } }))}
              >
                Adicionar alerta
              </Button>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}

function RuleEditor({ rule, index, count, draft, products, setRec, labelOf }: { rule: RecRule; index: number; count: number; draft: QuizDefinition; products: RecProduct[]; setRec: (fn: (r: Recommendation) => void) => void; labelOf: (id: string | null) => string }) {
  const set = (fn: (r: RecRule) => void) => setRec((r) => fn(r.rules[index]));
  return (
    <Collapsible
      head={
        <>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-page text-[12px] font-semibold text-muted">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[13.5px]">{rule.label}</span>
          <span className="shrink-0 text-[12.5px] text-muted">→ {labelOf(rule.product)}</span>
        </>
      }
    >
      <div className="flex items-start gap-2">
        <Field label="Descrição (vira o motivo da sugestão)" htmlFor={`rl-${rule.id}`} className="flex-1">
          <Input id={`rl-${rule.id}`} value={rule.label} maxLength={200} onChange={(e) => set((r) => void (r.label = e.target.value))} />
        </Field>
        <div className="flex pt-7">
          <IconButton size="sm" label="Subir regra" disabled={index === 0} onClick={() => setRec((r) => void r.rules.splice(index - 1, 0, r.rules.splice(index, 1)[0]))}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton size="sm" label="Descer regra" disabled={index === count - 1} onClick={() => setRec((r) => void r.rules.splice(index + 1, 0, r.rules.splice(index, 1)[0]))}>
            <ArrowDown className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-medium">Quando</span>
        <WhenEditor idPrefix={`rw-${rule.id}`} draft={draft} value={rule.when} onChange={(w) => set((r) => void (r.when = w))} />
      </div>
      <ProductSelect id={`rp-${rule.id}`} label="Sugerir" value={rule.product} onChange={(v) => set((r) => void (r.product = v ?? r.product))} products={products} />

      <div className="flex flex-col gap-2">
        <span className="text-[14px] font-medium">Requisitos (todos precisam ser atendidos)</span>
        <ul className="flex flex-col gap-2.5">
          {rule.requirements.map((q, qi) => (
            <li key={q.id} className="flex flex-col gap-2 rounded-[16px] border border-line p-3">
              <div className="flex items-start gap-2">
                <Input aria-label="Descrição do requisito" value={q.label} maxLength={200} onChange={(e) => set((r) => void (r.requirements[qi].label = e.target.value))} className="flex-1" />
                <IconButton size="sm" label="Subir requisito" disabled={qi === 0} onClick={() => set((r) => void r.requirements.splice(qi - 1, 0, r.requirements.splice(qi, 1)[0]))}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton size="sm" label="Remover requisito" onClick={() => set((r) => void r.requirements.splice(qi, 1))}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
              <WhenEditor idPrefix={`qw-${q.id}`} draft={draft} value={q.when} onChange={(w) => set((r) => void (r.requirements[qi].when = w))} />
              <ProductSelect id={`qf-${q.id}`} label="Se não atender, sugerir" value={q.failProduct} onChange={(v) => set((r) => void (r.requirements[qi].failProduct = v))} products={products} empty="O “senão” da regra" />
            </li>
          ))}
        </ul>
        {rule.requirements.length < 15 && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            icon={<Plus className="size-4" />}
            onClick={() => set((r) => void r.requirements.push({ id: uid("req"), label: "Novo requisito", when: { mode: "all", conditions: [{ questionId: SCORE_REF, op: "gte", value: 50 }] }, failProduct: null }))}
          >
            Adicionar requisito
          </Button>
        )}
        {rule.requirements.length > 0 && <ProductSelect id={`ro-${rule.id}`} label="Senão (algum requisito falhou)" value={rule.otherwise} onChange={(v) => set((r) => void (r.otherwise = v))} products={products} empty="Produto padrão" />}
      </div>
      <Button size="sm" variant="ghost" className="self-start text-danger" icon={<Trash2 className="size-4" />} onClick={() => setRec((r) => void r.rules.splice(index, 1))}>
        Excluir regra
      </Button>
    </Collapsible>
  );
}
