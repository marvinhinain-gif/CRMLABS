"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useTeam } from "@/lib/me";
import type { Stage } from "@/lib/types";
import { Button, cx, Dialog, Field, Input, Select, Switch, Textarea } from "@/components/ui";
import { PROVIDERS, ProviderIcon, SourceChip, TARGET_LABEL, useCatalog, type Integration, type Mapping, type ProviderId, type Question } from "./shared";

type Draft = Omit<Integration, "id" | "status" | "lastError" | "lastErrorAt" | "lastLeadAt" | "lastSample" | "hasSigningSecret" | "publicUrl" | "webhookUrl" | "leadCount" | "createdAt">;

const STEPS = ["Ferramenta", "Nome", "Destino", "Origem", "Campos"] as const;

const DEFAULT_MAP: Mapping[] = [
  { key: "nome", target: "name" },
  { key: "whatsapp", target: "phone" },
  { key: "email", target: "email" },
  { key: "instagram", target: "instagram" },
];

function blank(provider: ProviderId): Draft {
  return {
    provider,
    name: "",
    slug: "",
    headline: "Quero saber mais",
    description: "Preencha seus dados e nossa equipe fala com você pelo WhatsApp.",
    questions: [],
    askEmail: true,
    askInstagram: true,
    askPreferredTime: provider === "crmlabs_form",
    thankYou: "Recebemos seus dados! Em breve alguém da equipe vai chamar você no WhatsApp.",
    sourceId: null,
    campaign: null,
    channel: null,
    partner: null,
    adName: null,
    productId: null,
    pipelineKind: "relationship",
    stageId: null,
    salesStageId: null,
    assignMode: "round_robin",
    fixedAssigneeId: null,
    assigneeIds: [],
    fieldMap: provider === "crmlabs_form" ? [] : DEFAULT_MAP,
    active: true,
  };
}

/** Pede um nome e cria (origem, produto ou campo personalizado) sem sair do assistente. */
function InlineCreate({ label, placeholder, url, onCreated }: { label: string; placeholder: string; url: string; onCreated: (row: { id: string; name?: string; label?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline">
        <Plus className="size-3.5" aria-hidden /> {label}
      </button>
    );
  const save = async () => {
    setBusy(true);
    try {
      const row = await api.post<{ id: string; name?: string; label?: string }>(url, { name });
      onCreated(row);
      setName("");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="anim-fade flex gap-2">
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), save())} />
      <Button size="sm" onClick={save} loading={busy} disabled={name.trim().length < 2}>
        Criar
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancelar
      </Button>
    </div>
  );
}

function TargetSelect({ value, onChange, fields, allowBase = true, id }: { value: string; onChange: (v: string) => void; fields: { id: string; label: string }[]; allowBase?: boolean; id?: string }) {
  return (
    <Select id={id} aria-label="Campo do CRMLABS" value={value} onChange={(e) => onChange(e.target.value)} className="bg-white">
      {allowBase && (
        <optgroup label="Dados do lead">
          {(["name", "phone", "email", "instagram"] as const).map((k) => (
            <option key={k} value={k}>
              {TARGET_LABEL[k]}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Comercial">
        <option value="product">{TARGET_LABEL.product}</option>
      </optgroup>
      {fields.length > 0 && (
        <optgroup label="Campos personalizados">
          {fields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Outros">
        <option value="answer">{TARGET_LABEL.answer}</option>
        <option value="ignore">{TARGET_LABEL.ignore}</option>
      </optgroup>
    </Select>
  );
}

export function IntegrationWizard({
  open,
  onOpenChange,
  editing,
  initialProvider,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Integration | null;
  initialProvider?: ProviderId | null;
  onSaved: (i: Integration, created: boolean) => void;
}) {
  const team = useTeam();
  const { data: cat, mutate: mutateCat } = useCatalog();
  const { data: relStages } = useSWR<Stage[]>("/api/stages?kind=relationship", fetcher);
  const { data: salesStages } = useSWR<Stage[]>("/api/stages?kind=sales", fetcher);
  const [step, setStep] = useState(0);
  const [v, setV] = useState<Draft>(blank("webhook"));
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setFields({});
    if (editing) {
      const { id: _i, status: _s, lastError: _e, lastErrorAt: _ea, lastLeadAt: _l, lastSample, hasSigningSecret: _h, publicUrl: _p, webhookUrl: _w, leadCount: _c, createdAt: _cr, ...rest } = editing;
      // Campos recebidos que ainda não estão no mapeamento aparecem para mapear.
      const known = new Set(rest.fieldMap.map((m) => m.key.toLowerCase()));
      const extra = editing.provider === "crmlabs_form" ? [] : lastSample.filter((x) => !known.has(x.key.toLowerCase())).map((x) => ({ key: x.key, target: "answer" }));
      setV({ ...rest, fieldMap: [...rest.fieldMap, ...extra] });
      setStep(1);
    } else {
      setV(blank(initialProvider ?? "webhook"));
      setStep(initialProvider ? 1 : 0);
    }
  }, [open, editing, initialProvider]);

  useEffect(() => {
    // Origem padrão: Tráfego Pago para formulário de anúncio; senão a primeira.
    if (open && !editing && cat && !v.sourceId) setV((x) => ({ ...x, sourceId: cat.sources.find((s) => s.key === "trafego-pago")?.id ?? cat.sources[0]?.id ?? null }));
  }, [open, editing, cat, v.sourceId]);

  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => setV((x) => ({ ...x, [k]: val }));
  const people = team.filter((m) => m.status === "active");
  const pool = people.filter((m) => (v.pipelineKind === "sales" ? m.role === "closer" || m.role === "manager" || m.role === "admin" : m.role !== "closer"));
  const customFields = useMemo(() => (cat?.customFields ?? []).map((f) => ({ id: f.id, label: f.label })), [cat]);
  const source = cat?.sources.find((s) => s.id === v.sourceId);
  const isForm = v.provider === "crmlabs_form";

  const canNext =
    step === 0 ? !!v.provider : step === 1 ? v.name.trim().length >= 2 : step === 2 ? v.assignMode === "round_robin" || !!v.fixedAssigneeId : step === 3 ? !!v.sourceId : true;

  const save = async () => {
    setSaving(true);
    setFields({});
    const body = {
      ...v,
      slug: editing ? v.slug : undefined,
      headline: isForm ? v.headline : v.name,
      fieldMap: v.fieldMap.filter((m) => m.key.trim()),
      questions: v.questions.map((q) => ({ ...q, options: q.type === "choice" ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined })),
      stageId: v.pipelineKind === "relationship" ? v.stageId : null,
      salesStageId: v.pipelineKind === "sales" ? v.salesStageId : null,
      fixedAssigneeId: v.assignMode === "fixed" ? v.fixedAssigneeId : null,
    };
    try {
      const saved = editing ? await api.patch<Integration>(`/api/lead-integrations/${editing.id}`, body) : await api.post<Integration>("/api/lead-integrations", body);
      onSaved({ ...saved, leadCount: editing?.leadCount ?? 0 }, !editing);
      onOpenChange(false);
    } catch (err) {
      const ae = err as ApiError;
      setFields(ae.fields);
      toast.error(ae.message);
    } finally {
      setSaving(false);
    }
  };

  const setQ = (i: number, q: Partial<Question>) => set("questions", v.questions.map((x, j) => (j === i ? { ...x, ...q } : x)));
  const moveQ = (i: number, d: -1 | 1) => {
    const qs = [...v.questions];
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    set("questions", qs);
  };
  const qTarget = (qid: string) => v.fieldMap.find((m) => m.key === qid)?.target ?? "answer";
  const setQTarget = (qid: string, target: string) => set("fieldMap", [...v.fieldMap.filter((m) => m.key !== qid), { key: qid, target }]);
  const setM = (i: number, m: Partial<Mapping>) => set("fieldMap", v.fieldMap.map((x, j) => (j === i ? { ...x, ...m } : x)));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={editing ? `Editar · ${editing.name}` : "Nova integração"}
      size="lg"
      footer={
        <div className="flex w-full items-center gap-2">
          {step > 0 && (
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep(step - 1)} disabled={saving || (!!editing && step === 1)}>
              Voltar
            </Button>
          )}
          <span className="flex-1" />
          {step < STEPS.length - 1 ? (
            <>
              {editing && (
                <Button variant="secondary" onClick={save} loading={saving}>
                  Salvar
                </Button>
              )}
              <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
                Continuar <ArrowRight className="size-4" aria-hidden />
              </Button>
            </>
          ) : (
            <Button onClick={save} loading={saving} icon={<Check className="size-4" />}>
              {editing ? "Salvar alterações" : "Conectar"}
            </Button>
          )}
        </div>
      }
    >
      <ol className="mb-5 flex gap-1.5" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => (editing ? i > 0 && setStep(i) : i < step && setStep(i))}
              className={cx("w-full text-left", (editing ? i > 0 : i < step) ? "cursor-pointer" : "cursor-default")}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={cx("block h-1.5 rounded-full transition-colors duration-300", i <= step ? "bg-brand" : "bg-line")} />
              <span className={cx("mt-1.5 hidden truncate text-[12px] sm:block", i === step ? "font-semibold text-brand" : "text-muted")}>
                {i + 1}. {s}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div key={step} className="anim-fade">
        {step === 0 && (
          <div>
            <h3 className="text-[17px] font-semibold">De onde os leads serão enviados?</h3>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setV((x) => ({ ...blank(p.id), sourceId: x.sourceId, name: x.name }));
                    setStep(1);
                  }}
                  className={cx("lift flex items-center gap-3 rounded-[18px] border p-3.5 text-left", v.provider === p.id ? "border-brand bg-selected" : "border-line hover:bg-page")}
                >
                  <ProviderIcon id={p.id} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">{p.name}</span>
                    <span className="block text-[12.5px] text-muted">{p.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <ProviderIcon id={v.provider} size={40} />
              <p className="text-[14px] text-muted">{PROVIDERS.find((p) => p.id === v.provider)?.name}</p>
            </div>
            <Field label="Nome da integração" htmlFor="ig-name" error={fields.name} hint="Ex.: Quiz Consultoria — Stories. É assim que aparece para o time.">
              <Input id="ig-name" autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
            </Field>
            {isForm && (
              <>
                <Field label="Título da página" htmlFor="ig-headline" error={fields.headline}>
                  <Input id="ig-headline" value={v.headline} onChange={(e) => set("headline", e.target.value)} />
                </Field>
                <Field label="Texto de apoio" htmlFor="ig-desc">
                  <Textarea id="ig-desc" value={v.description ?? ""} onChange={(e) => set("description", e.target.value)} />
                </Field>
                {editing && (
                  <Field label="Endereço da página" htmlFor="ig-slug" error={fields.slug} hint="Mudar o endereço quebra links já publicados.">
                    <Input id="ig-slug" value={v.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
                  </Field>
                )}
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-[17px] font-semibold">Para onde vai cada lead?</h3>
            <Field label="Produto" htmlFor="ig-product">
              <Select id="ig-product" value={v.productId ?? ""} onChange={(e) => set("productId", e.target.value || null)}>
                <option value="">Sem produto definido</option>
                {cat?.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <InlineCreate
              label="Novo produto"
              placeholder="Ex.: Consultoria"
              url="/api/catalog/products"
              onCreated={(row) => {
                mutateCat();
                set("productId", row.id);
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pipeline" htmlFor="ig-pipe">
                <Select id="ig-pipe" value={v.pipelineKind} onChange={(e) => set("pipelineKind", e.target.value as Draft["pipelineKind"])}>
                  <option value="relationship">Social Seller (relacionamento)</option>
                  <option value="sales">Comercial (direto para o closer)</option>
                </Select>
              </Field>
              <Field label="Etapa inicial" htmlFor="ig-stage">
                {v.pipelineKind === "relationship" ? (
                  <Select id="ig-stage" value={v.stageId ?? ""} onChange={(e) => set("stageId", e.target.value || null)}>
                    <option value="">Não criar cartão no quadro</option>
                    {relStages?.filter((s) => !s.archivedAt).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Select id="ig-stage" value={v.salesStageId ?? ""} onChange={(e) => set("salesStageId", e.target.value || null)}>
                    <option value="">Primeira etapa</option>
                    {salesStages?.filter((s) => !s.archivedAt).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="rounded-[18px] border border-line p-4">
              <p className="text-[14.5px] font-semibold">Responsável</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(["round_robin", "fixed"] as const).map((mode) => (
                  <label key={mode} className={cx("flex cursor-pointer items-start gap-2.5 rounded-[14px] border p-3", v.assignMode === mode ? "border-brand bg-selected" : "border-line")}>
                    <input type="radio" name="assign" checked={v.assignMode === mode} onChange={() => set("assignMode", mode)} className="mt-0.5 size-5 accent-[#008a65]" />
                    <span>
                      <span className="block text-[14px] font-medium">{mode === "round_robin" ? "Distribuição automática" : "Responsável fixo"}</span>
                      <span className="block text-[12.5px] text-muted">{mode === "round_robin" ? "Rodízio entre as pessoas marcadas." : "Todos os leads para a mesma pessoa."}</span>
                    </span>
                  </label>
                ))}
              </div>
              {v.assignMode === "fixed" ? (
                <Field label="Quem recebe" htmlFor="ig-fixed" className="mt-3">
                  <Select id="ig-fixed" value={v.fixedAssigneeId ?? ""} onChange={(e) => set("fixedAssigneeId", e.target.value || null)}>
                    <option value="">Escolha…</option>
                    {people.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} · {m.role === "seller" ? "social seller" : m.role === "closer" ? "closer" : m.role === "manager" ? "gestor" : "admin"}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <>
                  <p className="mt-3 text-[12.5px] text-muted">Sem ninguém marcado, o rodízio é entre todos os {v.pipelineKind === "sales" ? "closers" : "social sellers"} ativos. Só quem recebe é notificado.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {pool.map((m) => (
                      <label key={m.userId} className="flex items-center gap-2.5 rounded-[12px] border border-line px-3 py-2.5 text-[14px]">
                        <input
                          type="checkbox"
                          className="size-5 accent-[#008a65]"
                          checked={v.assigneeIds.includes(m.userId)}
                          onChange={(e) => set("assigneeIds", e.target.checked ? [...v.assigneeIds, m.userId] : v.assigneeIds.filter((x) => x !== m.userId))}
                        />
                        {m.name}
                        <span className="ml-auto text-[12px] text-muted">{m.role === "seller" ? "social seller" : m.role === "closer" ? "closer" : m.role === "manager" ? "gestor" : "admin"}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-[17px] font-semibold">De onde esses leads estão vindo?</h3>
            <p className="-mt-2 text-[13px] text-muted">Todo lead desta integração recebe essa origem automaticamente, sem depender do que a pessoa responde.</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Origem">
              {cat?.sources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={v.sourceId === s.id}
                  onClick={() => set("sourceId", s.id)}
                  className={cx("rounded-full border-2 transition-transform active:scale-95", v.sourceId === s.id ? "border-brand" : "border-transparent")}
                >
                  <SourceChip name={s.name} color={s.color} className="px-3.5 py-1.5 text-[14px]" />
                </button>
              ))}
            </div>
            <InlineCreate label="Nova origem" placeholder="Ex.: YouTube" url="/api/catalog/sources" onCreated={(row) => (mutateCat(), set("sourceId", row.id))} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Campanha" htmlFor="ig-camp" hint="Ex.: Diagnóstico Low Ticket">
                <Input id="ig-camp" value={v.campaign ?? ""} onChange={(e) => set("campaign", e.target.value || null)} />
              </Field>
              <Field label="Canal" htmlFor="ig-chan" hint="Ex.: Instagram Ads">
                <Input id="ig-chan" value={v.channel ?? ""} onChange={(e) => set("channel", e.target.value || null)} />
              </Field>
              <Field label={source?.key === "collab" ? "Parceiro / influenciador" : "Parceiro (opcional)"} htmlFor="ig-partner" hint="Ex.: @nomedoparceiro">
                <Input id="ig-partner" value={v.partner ?? ""} onChange={(e) => set("partner", e.target.value || null)} />
              </Field>
              <Field label="Conteúdo / anúncio" htmlFor="ig-ad" hint="Ex.: Criativo 03 — vídeo depoimento">
                <Input id="ig-ad" value={v.adName ?? ""} onChange={(e) => set("adName", e.target.value || null)} />
              </Field>
            </div>
            <p className="text-[12.5px] text-muted">Os parâmetros utm_source, utm_medium, utm_campaign, utm_content e utm_term que chegarem também ficam guardados no lead.</p>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-[17px] font-semibold">{isForm ? "Perguntas e para onde vai cada resposta" : "Campo do formulário → campo do CRMLABS"}</h3>
            {isForm ? (
              <>
                <div className="rounded-[18px] border border-line p-4">
                  <p className="text-[14px] font-semibold">Campos fixos</p>
                  <p className="text-[12.5px] text-muted">Nome e WhatsApp são sempre pedidos.</p>
                  <div className="divide-y divide-line">
                    <Switch checked={v.askEmail} onChange={(x) => set("askEmail", x)} label="E-mail" />
                    <Switch checked={v.askInstagram} onChange={(x) => set("askInstagram", x)} label="@ do Instagram" />
                    <Switch checked={v.askPreferredTime} onChange={(x) => set("askPreferredTime", x)} label="Melhor dia e horário para a reunião" />
                  </div>
                </div>
                <ol className="flex flex-col gap-3">
                  {v.questions.map((q, i) => (
                    <li key={q.id} className="rounded-[16px] border border-line bg-page/40 p-3">
                      <div className="flex gap-2">
                        <Input aria-label={`Pergunta ${i + 1}`} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder="Escreva a pergunta" className="bg-white" />
                        <div className="flex shrink-0">
                          <button type="button" className="flex size-11 items-center justify-center rounded-[12px] text-muted hover:bg-white disabled:opacity-30" onClick={() => moveQ(i, -1)} disabled={i === 0} aria-label="Subir">
                            <ArrowUp className="size-4" />
                          </button>
                          <button type="button" className="flex size-11 items-center justify-center rounded-[12px] text-muted hover:bg-white disabled:opacity-30" onClick={() => moveQ(i, 1)} disabled={i === v.questions.length - 1} aria-label="Descer">
                            <ArrowDown className="size-4" />
                          </button>
                          <button type="button" className="flex size-11 items-center justify-center rounded-[12px] text-danger hover:bg-white" onClick={() => (set("questions", v.questions.filter((_, j) => j !== i)), set("fieldMap", v.fieldMap.filter((m) => m.key !== q.id)))} aria-label="Remover pergunta">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[auto_auto_1fr] sm:items-center">
                        <Select aria-label="Tipo de resposta" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as Question["type"] })} className="w-auto bg-white">
                          <option value="text">Resposta curta</option>
                          <option value="textarea">Resposta longa</option>
                          <option value="choice">Múltipla escolha</option>
                          <option value="number">Número</option>
                        </Select>
                        <label className="inline-flex items-center gap-2 text-[13.5px]">
                          <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} className="size-5 accent-[#008a65]" /> Obrigatória
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 text-[12.5px] text-muted">vai para</span>
                          <TargetSelect value={qTarget(q.id)} onChange={(t) => setQTarget(q.id, t)} fields={customFields} allowBase={false} />
                        </div>
                      </div>
                      {q.type === "choice" && (
                        <Textarea aria-label="Opções (uma por linha)" className="mt-2 bg-white" placeholder={"Uma opção por linha"} value={(q.options ?? []).join("\n")} onChange={(e) => setQ(i, { options: e.target.value.split("\n") })} />
                      )}
                    </li>
                  ))}
                </ol>
                <Button variant="soft" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={() => set("questions", [...v.questions, { id: `q${Date.now().toString(36)}`, label: "", type: "text", required: false }])}>
                  Pergunta
                </Button>
                <Field label="Mensagem depois do envio" htmlFor="ig-thanks">
                  <Textarea id="ig-thanks" value={v.thankYou ?? ""} onChange={(e) => set("thankYou", e.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <p className="-mt-2 text-[13px] text-muted">
                  Escreva o nome do campo exatamente como a ferramenta envia (ex.: “Qual seu faturamento?”). Campos que não estiverem aqui viram respostas do formulário — nada se perde.
                  {editing?.lastSample?.length ? " Os campos do último envio já aparecem abaixo." : ""}
                </p>
                <div className="flex flex-col gap-2">
                  {v.fieldMap.map((m, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_24px_1fr_auto] sm:items-center">
                      <Input aria-label="Campo do formulário" value={m.key} onChange={(e) => setM(i, { key: e.target.value })} placeholder="Campo do formulário" />
                      <span className="hidden text-center text-muted sm:block" aria-hidden>
                        →
                      </span>
                      <button type="button" className="row-span-2 flex size-11 items-center justify-center self-start rounded-[12px] text-danger hover:bg-page sm:order-last sm:row-span-1" onClick={() => set("fieldMap", v.fieldMap.filter((_, j) => j !== i))} aria-label="Remover campo">
                        <Trash2 className="size-4" />
                      </button>
                      <TargetSelect value={m.target} onChange={(t) => setM(i, { target: t })} fields={customFields} />
                    </div>
                  ))}
                </div>
                <Button variant="soft" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={() => set("fieldMap", [...v.fieldMap, { key: "", target: "answer" }])}>
                  Campo
                </Button>
              </>
            )}
            <div className="rounded-[16px] bg-page/70 p-3.5">
              <p className="text-[13px] font-semibold">Campos personalizados</p>
              <p className="text-[12.5px] text-muted">Aparecem na ficha do lead e na preparação do closer: {customFields.map((f) => f.label).join(", ")}.</p>
              <div className="mt-2">
                <InlineCreate label="Criar campo personalizado" placeholder="Ex.: Faturamento Atual" url="/api/catalog/fields" onCreated={() => mutateCat()} />
              </div>
            </div>
            {!editing && (
              <Switch checked={v.active} onChange={(x) => set("active", x)} label="Ativar ao conectar" description="Desativada, a integração recusa novos envios." />
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
