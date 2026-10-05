"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ClipboardList, ExternalLink, Pencil, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useTeam } from "@/lib/me";
import { relativeTime } from "@/lib/format";
import type { Stage } from "@/lib/types";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, LoadingState, Select, Switch, Textarea } from "@/components/ui";
import { Copyable } from "@/components/settings/Copyable";

type Question = { id: string; label: string; type: "text" | "textarea" | "choice" | "number"; required: boolean; options?: string[] };
type Form = {
  id: string;
  name: string;
  slug: string;
  headline: string;
  description: string | null;
  questions: Question[];
  askEmail: boolean;
  askInstagram: boolean;
  askPreferredTime: boolean;
  thankYou: string | null;
  assigneeIds: string[];
  stageId: string | null;
  active: boolean;
  publicUrl: string;
  webhookUrl: string | null;
  leadCount: number;
  lastLeadAt: string | null;
};

const TYPE_LABEL: Record<Question["type"], string> = { text: "Resposta curta", textarea: "Resposta longa", choice: "Múltipla escolha", number: "Número" };

const blank = (): Omit<Form, "id" | "publicUrl" | "webhookUrl" | "leadCount" | "lastLeadAt" | "slug"> & { slug?: string } => ({
  name: "",
  headline: "Quero saber mais",
  description: "Preencha seus dados e nossa equipe fala com você pelo WhatsApp para marcar uma conversa.",
  questions: [],
  askEmail: true,
  askInstagram: true,
  askPreferredTime: true,
  thankYou: "Recebemos seus dados! Em breve alguém da equipe vai chamar você no WhatsApp.",
  assigneeIds: [],
  stageId: null,
  active: true,
});

function FormEditor({ open, onOpenChange, form, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; form: Form | null; onSaved: () => void }) {
  const team = useTeam();
  const { data: stages } = useSWR<Stage[]>("/api/stages?kind=relationship", fetcher);
  const [v, setV] = useState(blank());
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFields({});
    setV(form ? { ...form } : blank());
  }, [open, form]);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const setQ = (i: number, q: Partial<Question>) => set("questions", v.questions.map((x, j) => (j === i ? { ...x, ...q } : x)));
  const move = (i: number, d: -1 | 1) => {
    const qs = [...v.questions];
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    set("questions", qs);
  };
  const sellers = team.filter((m) => m.status === "active" && m.role !== "closer");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFields({});
    const body = {
      ...v,
      questions: v.questions.map((q) => ({ ...q, options: q.type === "choice" ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined })),
    };
    try {
      if (form) await api.patch(`/api/lead-forms/${form.id}`, body);
      else await api.post("/api/lead-forms", body);
      toast.success(form ? "Formulário atualizado." : "Formulário criado. Copie o link e use no anúncio.");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const ae = err as ApiError;
      setFields(ae.fields);
      toast.error(ae.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={form ? "Editar formulário" : "Novo formulário de anúncio"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="lead-form-editor" loading={saving}>
            {form ? "Salvar" : "Criar formulário"}
          </Button>
        </>
      }
    >
      <form id="lead-form-editor" onSubmit={save} className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome interno" htmlFor="lf-name" error={fields.name} hint="Ex.: Mentoria — Anúncio Outubro">
            <Input id="lf-name" value={v.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          {form && (
            <Field label="Endereço" htmlFor="lf-slug" error={fields.slug} hint="Mudar o endereço quebra links já publicados.">
              <Input id="lf-slug" value={v.slug ?? ""} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
            </Field>
          )}
        </div>
        <Field label="Título da página" htmlFor="lf-headline" error={fields.headline}>
          <Input id="lf-headline" value={v.headline} onChange={(e) => set("headline", e.target.value)} required />
        </Field>
        <Field label="Texto de apoio" htmlFor="lf-desc">
          <Textarea id="lf-desc" value={v.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </Field>

        <div className="rounded-[18px] border border-line p-4">
          <p className="text-[14.5px] font-semibold">Campos fixos</p>
          <p className="text-[12.5px] text-muted">Nome e WhatsApp são sempre pedidos.</p>
          <div className="mt-1 divide-y divide-line">
            <Switch checked={v.askEmail} onChange={(x) => set("askEmail", x)} label="E-mail" description="Opcional para o cliente." />
            <Switch checked={v.askInstagram} onChange={(x) => set("askInstagram", x)} label="@ do Instagram" description="Ajuda o social seller a se relacionar no Direct." />
            <Switch checked={v.askPreferredTime} onChange={(x) => set("askPreferredTime", x)} label="Melhor dia e horário para a reunião" description="Aparece como sugestão ao confirmar a reunião." />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-[14.5px] font-semibold">Perguntas do formulário</p>
            <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => set("questions", [...v.questions, { id: `q${Date.now().toString(36)}`, label: "", type: "text", required: false }])}>
              Pergunta
            </Button>
          </div>
          {v.questions.length === 0 && <p className="mt-2 text-[13px] text-muted">Sem perguntas extras. Adicione, por exemplo: “Qual seu faturamento mensal?”</p>}
          <ol className="mt-3 flex flex-col gap-3">
            {v.questions.map((q, i) => (
              <li key={q.id} className="rounded-[16px] border border-line bg-page/40 p-3">
                <div className="flex gap-2">
                  <Input aria-label={`Pergunta ${i + 1}`} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder="Escreva a pergunta" className="bg-white" />
                  <div className="flex shrink-0">
                    <button type="button" className="flex size-11 items-center justify-center rounded-[12px] text-muted hover:bg-white disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" className="flex size-11 items-center justify-center rounded-[12px] text-muted hover:bg-white disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === v.questions.length - 1} aria-label="Descer">
                      <ArrowDown className="size-4" />
                    </button>
                    <button type="button" className="flex size-11 items-center justify-center rounded-[12px] text-danger hover:bg-white" onClick={() => set("questions", v.questions.filter((_, j) => j !== i))} aria-label="Remover pergunta">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Select aria-label="Tipo de resposta" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as Question["type"] })} className="w-auto bg-white">
                    {Object.entries(TYPE_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                  <label className="inline-flex items-center gap-2 text-[13.5px]">
                    <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} className="size-5 accent-[#008a65]" />
                    Obrigatória
                  </label>
                </div>
                {q.type === "choice" && (
                  <Textarea
                    aria-label="Opções (uma por linha)"
                    className="mt-2 bg-white"
                    placeholder={"Uma opção por linha\nAté 10 mil\n10 a 50 mil\nMais de 50 mil"}
                    value={(q.options ?? []).join("\n")}
                    onChange={(e) => setQ(i, { options: e.target.value.split("\n") })}
                  />
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-[18px] border border-line p-4">
          <p className="text-[14.5px] font-semibold">Quem recebe os leads</p>
          <p className="text-[12.5px] text-muted">Rodízio entre as pessoas marcadas. Sem ninguém marcado, o rodízio é entre todos os social sellers ativos. Só quem recebe é notificado.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {sellers.map((m) => (
              <label key={m.userId} className="flex items-center gap-2.5 rounded-[12px] border border-line px-3 py-2.5 text-[14px]">
                <input
                  type="checkbox"
                  className="size-5 accent-[#008a65]"
                  checked={v.assigneeIds.includes(m.userId)}
                  onChange={(e) => set("assigneeIds", e.target.checked ? [...v.assigneeIds, m.userId] : v.assigneeIds.filter((x) => x !== m.userId))}
                />
                {m.name}
                <span className="ml-auto text-[12px] text-muted">{m.role === "seller" ? "social seller" : m.role === "manager" ? "gestor" : "admin"}</span>
              </label>
            ))}
          </div>
          <Field label="Etapa no Social Seller" htmlFor="lf-stage" className="mt-3">
            <Select id="lf-stage" value={v.stageId ?? ""} onChange={(e) => set("stageId", e.target.value || null)}>
              <option value="">Não criar cartão no quadro</option>
              {stages
                ?.filter((s) => !s.archivedAt)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <Field label="Mensagem depois do envio" htmlFor="lf-thanks">
          <Textarea id="lf-thanks" value={v.thankYou ?? ""} onChange={(e) => set("thankYou", e.target.value)} />
        </Field>
        <Switch checked={v.active} onChange={(x) => set("active", x)} label="Formulário ativo" description="Desativado, o link mostra que o formulário não está disponível e o webhook recusa envios." />
      </form>
    </Dialog>
  );
}

export function FormsManager() {
  const { data, mutate } = useSWR<Form[]>("/api/lead-forms", fetcher);
  const [editing, setEditing] = useState<Form | null>(null);
  const [open, setOpen] = useState(false);
  const [showHook, setShowHook] = useState<string | null>(null);
  if (!data) return <LoadingState rows={3} />;

  const regen = async (f: Form) => {
    if (!confirm("Gerar um novo endereço de webhook? O endereço atual para de funcionar na hora.")) return;
    await api.post(`/api/lead-forms/${f.id}/token`).then(() => mutate()).catch((e) => toast.error((e as Error).message));
    toast.success("Novo endereço gerado. Atualize na ferramenta de integração.");
  };
  const remove = async (f: Form) => {
    if (!confirm(`Excluir o formulário “${f.name}”? Os ${f.leadCount} lead(s) recebidos continuam salvos.`)) return;
    try {
      await api.del(`/api/lead-forms/${f.id}`);
      mutate();
      toast.success("Formulário excluído.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const toggle = async (f: Form, active: boolean) => {
    mutate(data.map((x) => (x.id === f.id ? { ...x, active } : x)), { revalidate: false });
    await api.patch(`/api/lead-forms/${f.id}`, { active }).catch((e) => toast.error((e as Error).message));
    mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-[18px] border border-[#c9ebdc] bg-selected px-4 py-3.5 text-[13.5px] text-brand-dark sm:flex-row sm:items-center">
        <p className="flex-1">
          Use o <b>link do formulário</b> como destino do anúncio (Instagram, Facebook, Google). Já usa outra ferramenta de formulário ou o Lead Ads da Meta? Conecte pelo <b>webhook</b> (Zapier, Make, RD Station…).
        </p>
        <Button
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="shrink-0"
        >
          Novo formulário
        </Button>
      </div>

      {data.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardList />} title="Nenhum formulário ainda" description="Crie o primeiro e coloque o link no seu anúncio." />
        </Card>
      ) : (
        data.map((f, i) => (
          <Card key={f.id} className="anim-rise p-5" style={{ "--i": i } as React.CSSProperties}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[17px] font-semibold">{f.name}</h3>
                  <Badge tone={f.active ? "success" : "neutral"}>{f.active ? "Ativo" : "Desativado"}</Badge>
                </div>
                <p className="mt-0.5 text-[13px] text-muted">
                  {f.leadCount} lead(s){f.lastLeadAt ? ` · último ${relativeTime(f.lastLeadAt).toLowerCase()}` : ""} · {f.questions.length} pergunta(s) extra
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Switch checked={f.active} onChange={(x) => toggle(f, x)} label="Ativo" />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil className="size-4" />}
                  onClick={() => {
                    setEditing(f);
                    setOpen(true);
                  }}
                >
                  Editar
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => remove(f)}>
                  Excluir
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <Copyable label="Link do formulário (destino do anúncio)" value={f.publicUrl} hint="Dica: adicione ?utm_campaign=nome-da-campanha ao link para saber de qual anúncio veio cada lead." />
              <a href={f.publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[14px] border border-line px-4 text-[14px] font-medium hover:bg-page lg:mb-[22px]">
                <ExternalLink className="size-4" aria-hidden /> Ver página
              </a>
            </div>
            <button onClick={() => setShowHook(showHook === f.id ? null : f.id)} className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand hover:underline">
              <Webhook className="size-4" aria-hidden /> Receber de outras ferramentas (webhook)
            </button>
            {showHook === f.id && f.webhookUrl && (
              <div className="anim-fade mt-3 rounded-[16px] bg-page/70 p-4">
                <Copyable label="Endereço do webhook (POST, JSON ou formulário)" value={f.webhookUrl} />
                <p className="mt-2 text-[12.5px] text-muted">
                  Envie os campos <code>nome</code>, <code>whatsapp</code> (ou <code>telefone</code>), <code>email</code> e <code>instagram</code>. Os demais campos viram respostas do formulário. Também aceita o formato <code>field_data</code> do Lead Ads da Meta e os parâmetros <code>utm_*</code>. Trate este endereço como senha.
                </p>
                <Button size="sm" variant="ghost" className="mt-2" icon={<RefreshCw className="size-4" />} onClick={() => regen(f)}>
                  Gerar novo endereço
                </Button>
              </div>
            )}
          </Card>
        ))
      )}
      <FormEditor open={open} onOpenChange={setOpen} form={editing} onSaved={() => mutate()} />
    </div>
  );
}
