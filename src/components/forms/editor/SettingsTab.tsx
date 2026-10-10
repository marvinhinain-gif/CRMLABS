"use client";

import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { allQuestions, sortedTiers } from "@/lib/quiz/engine";
import { route as newRoute, uid } from "@/lib/quiz/templates";
import { CHOICE_TYPES, type QuizDefinition, type Route, type Tier } from "@/lib/quiz/types";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { Button, Checkbox, cx, Field, IconButton, Input, Select, Switch, Textarea } from "@/components/ui";
import { TIER_COLORS, TierBadge } from "../shared";
import { Panel, PeoplePicker, TagInput, type EditorProps } from "./common";

export type Meta = { name: string; slug: string };

const COLOR_LABEL: Record<string, string> = { green: "Verde", blue: "Azul", yellow: "Amarelo", gray: "Cinza", red: "Vermelho", purple: "Roxo", teal: "Turquesa" };

export function RouteEditor({ value, onChange, options, idPrefix }: { value: Route; onChange: (r: Route) => void; options: EditorProps["options"]; idPrefix: string }) {
  const set = (p: Partial<Route>) => onChange({ ...value, ...p });
  const role: Role = value.mode === "sales" ? "closer" : "seller";
  const eligible = options.team.filter((p) => p.role === role || p.role === "admin" || p.role === "manager");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Destino no CRM" htmlFor={`${idPrefix}-mode`}>
        <Select id={`${idPrefix}-mode`} value={value.mode} onChange={(e) => set({ mode: e.target.value as Route["mode"], assignMode: e.target.value === "none" ? "none" : value.assignMode === "none" ? "round_robin" : value.assignMode, assigneeIds: [], fixedAssigneeId: null })}>
          <option value="sales">Comercial (fila do closer)</option>
          <option value="relationship">Social Seller (Kanban de relacionamento)</option>
          <option value="none">Somente base de contatos</option>
        </Select>
      </Field>
      {value.mode === "relationship" && (
        <Field label="Etapa do Social Seller" htmlFor={`${idPrefix}-stage`}>
          <Select id={`${idPrefix}-stage`} value={value.stageId ?? ""} onChange={(e) => set({ stageId: e.target.value || null })}>
            <option value="">Etapa de entrada padrão</option>
            {options.relationshipStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {value.mode === "sales" && (
        <Field label="Etapa do Comercial" htmlFor={`${idPrefix}-sstage`}>
          <Select id={`${idPrefix}-sstage`} value={value.salesStageId ?? ""} onChange={(e) => set({ salesStageId: e.target.value || null })}>
            <option value="">Primeira etapa (fila prioritária)</option>
            {options.salesStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Responsável" htmlFor={`${idPrefix}-assign`}>
        <Select id={`${idPrefix}-assign`} value={value.assignMode} onChange={(e) => set({ assignMode: e.target.value as Route["assignMode"] })}>
          <option value="round_robin">Rodízio entre {value.mode === "sales" ? "closers" : "social sellers"}</option>
          <option value="fixed">Pessoa fixa</option>
          <option value="none">Sem responsável</option>
        </Select>
      </Field>
      {value.assignMode === "fixed" && (
        <Field label="Quem recebe" htmlFor={`${idPrefix}-fixed`}>
          <Select id={`${idPrefix}-fixed`} value={value.fixedAssigneeId ?? ""} onChange={(e) => set({ fixedAssigneeId: e.target.value || null })}>
            <option value="">Escolha alguém</option>
            {eligible.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name} · {ROLE_LABEL[p.role as Role] ?? p.role}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {value.assignMode === "round_robin" && (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[14px] font-medium">Quem participa do rodízio</span>
          <PeoplePicker team={options.team} roles={[role]} value={value.assigneeIds} onChange={(ids) => set({ assigneeIds: ids })} />
          <p className="text-[12.5px] text-muted">Sem ninguém marcado, entram todos os {value.mode === "sales" ? "closers" : "social sellers"} ativos.</p>
        </div>
      )}
      <div className="sm:col-span-2">
        <Switch label="Avisar o responsável" description="Notificação no CRM (e push, se ativado) quando o lead chegar." checked={value.notify} onChange={(v) => set({ notify: v })} />
      </div>
    </div>
  );
}

function TierEditor({ tier, draft, update, options, onRemove }: { tier: Tier; draft: QuizDefinition; update: EditorProps["update"]; options: EditorProps["options"]; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const set = (fn: (t: Tier) => void) =>
    update((d) => {
      const t = d.scoring.tiers.find((x) => x.id === tier.id);
      if (t) fn(t);
    });
  const choiceQuestions = allQuestions(draft).filter((q) => CHOICE_TYPES.includes(q.type));
  const lower = sortedTiers(draft.scoring).filter((t) => t.min < tier.min);
  return (
    <li className={cx("rounded-[18px] border bg-white", open ? "border-brand/60" : "border-line")}>
      <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <TierBadge label={tier.label} color={tier.color} />
        <span className="flex-1 text-[13px] text-muted">
          a partir de <b className="text-ink">{tier.min}</b> pontos
          {tier.requirements.length ? ` · ${tier.requirements.length} requisito${tier.requirements.length === 1 ? "" : "s"}` : ""}
          {tier.qualified ? " · qualificado" : ""}
        </span>
        <ChevronDown className={cx("size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_150px]">
            <Field label="Nome da faixa" htmlFor={`tl-${tier.id}`}>
              <Input id={`tl-${tier.id}`} value={tier.label} maxLength={80} onChange={(e) => set((t) => void (t.label = e.target.value))} />
            </Field>
            <Field label="Mínimo" htmlFor={`tm-${tier.id}`}>
              <Input id={`tm-${tier.id}`} type="number" min={0} max={1000} value={tier.min} onChange={(e) => set((t) => void (t.min = Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0)))))} />
            </Field>
            <Field label="Cor" htmlFor={`tc-${tier.id}`}>
              <Select id={`tc-${tier.id}`} value={tier.color} onChange={(e) => set((t) => void (t.color = e.target.value))}>
                {TIER_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {COLOR_LABEL[c] ?? c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Descrição interna" htmlFor={`td-${tier.id}`}>
            <Input id={`td-${tier.id}`} value={tier.description ?? ""} maxLength={300} onChange={(e) => set((t) => void (t.description = e.target.value || null))} />
          </Field>
          <Switch label="Conta como lead qualificado" description="Entra no indicador de leads qualificados." checked={tier.qualified} onChange={(v) => set((t) => void (t.qualified = v))} />

          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium">Requisitos para manter esta faixa</span>
            <p className="text-[12.5px] text-muted">Mesmo com pontos suficientes, se a resposta não estiver entre as aceitas, o lead desce de faixa.</p>
            <ul className="flex flex-col gap-3">
              {tier.requirements.map((r, ri) => {
                const q = choiceQuestions.find((x) => x.id === r.questionId);
                return (
                  <li key={r.id} className="rounded-[16px] border border-line bg-page/50 p-3">
                    <div className="flex items-start gap-2">
                      <div className="grid flex-1 gap-2 sm:grid-cols-2">
                        <Input aria-label="Descrição do requisito" value={r.label} maxLength={160} onChange={(e) => set((t) => void (t.requirements[ri].label = e.target.value))} />
                        <Select aria-label="Pergunta do requisito" value={r.questionId} onChange={(e) => set((t) => void Object.assign(t.requirements[ri], { questionId: e.target.value, optionIds: [] }))}>
                          {!q && <option value={r.questionId}>Pergunta removida</option>}
                          {choiceQuestions.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.title}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <IconButton size="sm" label="Remover requisito" onClick={() => set((t) => void t.requirements.splice(ri, 1))}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                    {q && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <span className="text-[12.5px] text-muted">Respostas aceitas:</span>
                        {(q.options ?? []).map((o) => (
                          <Checkbox
                            key={o.id}
                            label={o.label}
                            checked={r.optionIds.includes(o.id)}
                            onChange={(v) => set((t) => void (t.requirements[ri].optionIds = v ? [...t.requirements[ri].optionIds, o.id] : t.requirements[ri].optionIds.filter((x) => x !== o.id)))}
                          />
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {choiceQuestions.length > 0 && tier.requirements.length < 10 && (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                icon={<Plus className="size-4" />}
                onClick={() => set((t) => void t.requirements.push({ id: uid("req"), label: "Novo requisito", questionId: choiceQuestions[0].id, optionIds: [] }))}
              >
                Adicionar requisito
              </Button>
            )}
            {tier.requirements.length > 0 && (
              <Field label="Se algum requisito falhar, vai para" htmlFor={`tdm-${tier.id}`}>
                <Select id={`tdm-${tier.id}`} value={tier.demoteTo ?? ""} onChange={(e) => set((t) => void (t.demoteTo = e.target.value || null))}>
                  <option value="">Faixa imediatamente abaixo</option>
                  {lower.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <Field label="Etiquetas aplicadas ao contato" htmlFor={`tt-${tier.id}`}>
            <TagInput id={`tt-${tier.id}`} value={tier.tags} onChange={(v) => set((t) => void (t.tags = v.slice(0, 10)))} placeholder="Ex.: ICP A" />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-semibold">Distribuição desta faixa</span>
            <RouteEditor idPrefix={`tr-${tier.id}`} value={tier.route} options={options} onChange={(r) => set((t) => void (t.route = r))} />
          </div>

          <Button size="sm" variant="ghost" className="self-start text-danger" icon={<Trash2 className="size-4" />} onClick={onRemove}>
            Excluir faixa
          </Button>
        </div>
      )}
    </li>
  );
}

export function SettingsTab({ draft, update, options, meta, setMeta, slugError }: EditorProps & { meta: Meta; setMeta: (m: Partial<Meta>) => void; slugError?: string }) {
  const s = draft.settings;
  const setS = <K extends keyof QuizDefinition["settings"]>(k: K, v: QuizDefinition["settings"][K]) => update((d) => void (d.settings[k] = v));
  const tiers = sortedTiers(draft.scoring);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Identificação">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome interno" htmlFor="st-name" hint="Só a equipe vê.">
            <Input id="st-name" value={meta.name} maxLength={120} onChange={(e) => setMeta({ name: e.target.value })} />
          </Field>
          <Field label="Título público" htmlFor="st-title">
            <Input id="st-title" value={s.title} maxLength={160} onChange={(e) => setS("title", e.target.value)} />
          </Field>
          <Field label="Descrição" htmlFor="st-desc" className="sm:col-span-2">
            <Textarea id="st-desc" value={s.description ?? ""} maxLength={1000} onChange={(e) => setS("description", e.target.value || null)} />
          </Field>
          <Field label="Mensagem de boas-vindas" htmlFor="st-welcome" hint="Com boas-vindas, descrição ou capa, o formulário abre com uma tela inicial." className="sm:col-span-2">
            <Input id="st-welcome" value={s.welcome ?? ""} maxLength={600} onChange={(e) => setS("welcome", e.target.value || null)} />
          </Field>
          <Field label="Endereço personalizado" htmlFor="st-slug" error={slugError} hint="Letras minúsculas, números e hífen. Mudar o endereço desativa o link antigo." className="sm:col-span-2">
            <div className="flex items-stretch overflow-hidden rounded-[14px] border border-line focus-within:border-brand focus-within:ring-4 focus-within:ring-[#008a65]/10">
              <span className="flex items-center whitespace-nowrap bg-page px-3 text-[13px] text-muted max-sm:hidden">{options.appUrl.replace(/^https?:\/\//, "")}/forms/</span>
              <input
                id="st-slug"
                value={meta.slug}
                maxLength={60}
                onChange={(e) => setMeta({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/--+/g, "-") })}
                className="h-11 min-w-0 flex-1 px-3 text-[14.5px] outline-none"
              />
            </div>
          </Field>
        </div>
      </Panel>

      <Panel title="Após o envio">
        <div className="grid gap-4">
          <Field label="Mensagem de conclusão" htmlFor="st-completion">
            <Textarea id="st-completion" value={s.completion} maxLength={1000} onChange={(e) => setS("completion", e.target.value)} />
          </Field>
          <Field label="Redirecionar para (opcional)" htmlFor="st-redirect" hint="Depois da mensagem, leva a pessoa para este endereço https://.">
            <Input id="st-redirect" value={s.redirectUrl ?? ""} maxLength={500} placeholder="https://" onChange={(e) => setS("redirectUrl", e.target.value.trim() || null)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Destino no CRM" description="Cada envio cria ou atualiza o contato (sem duplicar por e-mail ou WhatsApp) e registra o lead com origem, data e hora.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Origem do lead" htmlFor="st-source">
            <Select id="st-source" value={s.sourceId ?? ""} onChange={(e) => setS("sourceId", e.target.value || null)}>
              <option value="">Formulário (padrão)</option>
              {options.sources.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Produto de interesse" htmlFor="st-product">
            <Select id="st-product" value={s.productId ?? ""} onChange={(e) => setS("productId", e.target.value || null)}>
              <option value="">Nenhum</option>
              {options.products.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campanha" htmlFor="st-campaign" hint="Quando o link não traz utm_campaign.">
            <Input id="st-campaign" value={s.campaign ?? ""} maxLength={160} onChange={(e) => setS("campaign", e.target.value || null)} />
          </Field>
          <Field label="Etiquetas automáticas" htmlFor="st-tags" hint="Aplicadas a todo contato que responder.">
            <TagInput id="st-tags" value={s.tags} onChange={(v) => setS("tags", v.slice(0, 15))} placeholder="Ex.: Diagnóstico" />
          </Field>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[14px] font-medium">Avisar também</span>
            <PeoplePicker team={options.team} value={s.notifyUserIds} onChange={(v) => setS("notifyUserIds", v)} />
            <p className="text-[12.5px] text-muted">Essas pessoas recebem uma notificação a cada resposta, além do responsável pelo lead.</p>
          </div>
        </div>
        {!draft.scoring.enabled && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-3 text-[14px] font-semibold">Distribuição</p>
            <RouteEditor idPrefix="default" value={s.defaultRoute} options={options} onChange={(r) => setS("defaultRoute", r)} />
          </div>
        )}
      </Panel>

      <Panel title="Lead Score e classificação" description="O score é calculado no servidor e nunca aparece para quem responde.">
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Switch label="Ativar Lead Score" checked={draft.scoring.enabled} onChange={(v) => update((d) => void (d.scoring.enabled = v))} />
          <Switch
            label="Converter para 0–100"
            description="Se os pesos não somarem 100, o score é ajustado proporcionalmente."
            disabled={!draft.scoring.enabled}
            checked={draft.scoring.normalize}
            onChange={(v) => update((d) => void (d.scoring.normalize = v))}
          />
        </div>
        {draft.scoring.enabled && (
          <div className="mt-3 flex flex-col gap-3">
            <ul className="flex flex-col gap-2.5">
              {tiers.map((t) => (
                <TierEditor
                  key={t.id}
                  tier={t}
                  draft={draft}
                  update={update}
                  options={options}
                  onRemove={() => {
                    if (!window.confirm(`Excluir a faixa "${t.label}"?`)) return;
                    update((d) => {
                      d.scoring.tiers = d.scoring.tiers.filter((x) => x.id !== t.id);
                      for (const x of d.scoring.tiers) if (x.demoteTo === t.id) x.demoteTo = null;
                    });
                  }}
                />
              ))}
            </ul>
            {!tiers.some((t) => t.min === 0) && tiers.length > 0 && <p className="text-[12.5px] text-warning">Nenhuma faixa começa em 0: quem pontuar abaixo de {Math.min(...tiers.map((t) => t.min))} fica sem classificação.</p>}
            {draft.scoring.tiers.length < 8 && (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                icon={<Plus className="size-4" />}
                onClick={() => update((d) => void d.scoring.tiers.push({ id: uid("tier"), label: "Nova faixa", description: null, min: 0, color: "gray", qualified: false, requirements: [], demoteTo: null, tags: [], route: newRoute() }))}
              >
                Adicionar faixa
              </Button>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Consentimento e privacidade" description="O aviso de tratamento é obrigatório para enviar. O consentimento de marketing é separado e opcional.">
        <div className="grid gap-4">
          <Field label="Aviso de tratamento de dados" htmlFor="st-notice">
            <Textarea id="st-notice" value={s.consent.noticeText} maxLength={800} onChange={(e) => update((d) => void (d.settings.consent.noticeText = e.target.value))} />
          </Field>
          <Switch label="Pedir consentimento de marketing (opcional)" checked={s.consent.marketingEnabled} onChange={(v) => update((d) => void (d.settings.consent.marketingEnabled = v))} />
          {s.consent.marketingEnabled && (
            <Field label="Texto do consentimento de marketing" htmlFor="st-mkt">
              <Textarea id="st-mkt" value={s.consent.marketingText} maxLength={500} onChange={(e) => update((d) => void (d.settings.consent.marketingText = e.target.value))} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Política de privacidade (opcional)" htmlFor="st-policy" hint="Sem endereço, usamos a página de privacidade do CRMLABS.">
              <Input id="st-policy" value={s.consent.policyUrl ?? ""} maxLength={500} placeholder="https://" onChange={(e) => update((d) => void (d.settings.consent.policyUrl = e.target.value.trim() || null))} />
            </Field>
            <Field label="Versão dos textos" htmlFor="st-cver" hint="Gravada junto com cada aceite. Mude ao alterar os textos.">
              <Input id="st-cver" value={s.consent.version} maxLength={40} onChange={(e) => update((d) => void (d.settings.consent.version = e.target.value))} />
            </Field>
          </div>
        </div>
      </Panel>
    </div>
  );
}
