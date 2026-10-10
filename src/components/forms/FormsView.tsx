"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Code2,
  Copy,
  Eye,
  FileText,
  Inbox,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { formatDate, formatDateTime } from "@/lib/format";
import { PRIVACY_KIND_LABEL } from "@/lib/quiz/types";
import { Badge, Button, Card, cx, Dialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, NoPermission, PageHeader, Select, Tabs } from "@/components/ui";
import { BarList, copyText, DailyChart, EmbedDialog, Kpi, pct, StatusBadge, type Counted, type FormDetail, type FormListItem } from "./shared";

type Dashboard = {
  days: number;
  totals: { forms: number; published: number; drafts: number; archived: number; views: number; starts: number; responses: number; completionRate: number; qualified: number };
  byTier: (Counted & { color: string })[];
  byOrigin: Counted[];
  series: { day: string; count: number }[];
};

const TEMPLATE_CHOICES = [
  { key: "axion-diagnostico", title: "Diagnóstico Estratégico — AXION", description: "2 etapas, 13 perguntas, Lead Score de 0 a 100 e classificação ICP A, B, C e D com regras de qualificação.", icon: Sparkles },
  { key: "blank", title: "Formulário em branco", description: "Começa com nome, e-mail e WhatsApp. Monte as perguntas do seu jeito.", icon: FileText },
] as const;

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [template, setTemplate] = useState<(typeof TEMPLATE_CHOICES)[number]["key"]>("axion-diagnostico");
  const [name, setName] = useState("Diagnóstico Estratégico — AXION");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pick = (k: typeof template) => {
    setTemplate(k);
    setName((n) => (TEMPLATE_CHOICES.some((t) => t.title === n) || !n ? (k === "blank" ? "" : TEMPLATE_CHOICES[0].title) : n));
  };
  const create = async () => {
    setBusy(true);
    try {
      const f = await api.post<FormDetail>("/api/forms", { name, template });
      toast.success("Formulário criado como rascunho.");
      onOpenChange(false);
      router.push(`/formularios/${f.id}`);
    } catch (e) {
      setErr((e as ApiError).fields?.name ?? (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Criar formulário"
      description="Ele começa como rascunho. Nada fica no ar até você publicar."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={create} loading={busy} disabled={name.trim().length < 2}>
            Criar e editar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3" role="radiogroup" aria-label="Modelo">
          {TEMPLATE_CHOICES.map((t) => {
            const Icon = t.icon;
            const active = template === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pick(t.key)}
                className={cx("flex items-start gap-3 rounded-[18px] border p-4 text-left transition-colors", active ? "border-brand bg-selected/60 ring-4 ring-[#008a65]/10" : "border-line hover:bg-page")}
              >
                <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-[12px]", active ? "bg-brand text-white" : "bg-selected text-brand")}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold text-ink">{t.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{t.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        <Field label="Nome interno" htmlFor="form-name" error={err} hint="Só a equipe vê. O título público é configurado no editor.">
          <Input id="form-name" value={name} autoFocus onChange={(e) => (setName(e.target.value), setErr(undefined))} placeholder="Ex.: Diagnóstico de abril" onKeyDown={(e) => e.key === "Enter" && name.trim().length >= 2 && create()} />
        </Field>
      </div>
    </Dialog>
  );
}

function ConfirmDelete({ form, onClose, onDone }: { form: FormListItem | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await api.del(`/api/forms/${form.id}`);
      toast.success("Formulário excluído.");
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!form}
      onOpenChange={(v) => !v && onClose()}
      size="sm"
      title="Excluir formulário?"
      description={form ? `"${form.name}" será removido de vez. Formulários que já receberam respostas não podem ser excluídos; arquive-os.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={del} loading={busy}>
            Excluir
          </Button>
        </>
      }
    >
      <p className="text-[14px] text-muted">O link público deixa de funcionar imediatamente.</p>
    </Dialog>
  );
}

function FormsList({ onChanged }: { onChanged: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useQueryParam("status", "active");
  const [q, setQ] = useState("");
  const key = `/api/forms${qs({ status, q: q.trim() || undefined })}`;
  const { data, error, isLoading, mutate } = useSWR<FormListItem[]>(key, fetcher, { keepPreviousData: true });
  const [embedFor, setEmbedFor] = useState<FormListItem | null>(null);
  const [deleting, setDeleting] = useState<FormListItem | null>(null);
  const refresh = () => {
    mutate();
    onChanged();
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[18px] font-semibold">Formulários</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar formulário" aria-label="Buscar formulário" className="sm:w-60" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="sm:w-44">
            <option value="active">Ativos</option>
            <option value="published">Publicados</option>
            <option value="draft">Rascunhos</option>
            <option value="archived">Arquivados</option>
            <option value="all">Todos</option>
          </Select>
        </div>
      </div>
      <div className="mt-4">
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <LoadingState rows={3} />
        ) : !data?.length ? (
          <EmptyState icon={<ClipboardList />} title={status === "archived" ? "Nenhum formulário arquivado" : "Nenhum formulário ainda"} description="Crie um formulário a partir do Diagnóstico AXION ou do zero." />
        ) : (
          <>
            {/* Tabela no desktop */}
            <div className="hidden overflow-x-auto scroll-thin lg:block">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[12.5px] font-medium text-muted">
                    <th className="py-2.5 pr-3 font-medium">Nome</th>
                    <th className="px-3 py-2.5 font-medium">Criado em</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-right font-medium">Respostas</th>
                    <th className="px-3 py-2.5 text-right font-medium">Conversão</th>
                    <th className="py-2.5 pl-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((f) => (
                    <tr key={f.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                      <td className="max-w-[320px] py-3 pr-3">
                        <Link href={`/formularios/${f.id}`} className="block truncate font-semibold text-ink hover:text-brand">
                          {f.name}
                        </Link>
                        <span className="block truncate text-[12.5px] text-muted">/forms/{f.slug}</span>
                      </td>
                      <td className="px-3 py-3 text-muted">{formatDate(f.createdAt)}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={f.status} live={f.live} pending={f.hasUnpublishedChanges} />
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{f.responses.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-3 text-right text-muted" title={`${f.views} visualizações`}>
                        {f.views ? pct(f.conversion) : "—"}
                      </td>
                      <td className="py-3 pl-3">
                        <RowActions f={f} onEmbed={() => setEmbedFor(f)} onDelete={() => setDeleting(f)} act={act} onOpen={(p) => router.push(p)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Cartões no celular */}
            <ul className="flex flex-col gap-3 lg:hidden">
              {data.map((f) => (
                <li key={f.id} className="rounded-[18px] border border-line p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/formularios/${f.id}`} className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold">{f.name}</span>
                      <span className="block text-[12.5px] text-muted">Criado em {formatDate(f.createdAt)}</span>
                    </Link>
                    <RowActions f={f} onEmbed={() => setEmbedFor(f)} onDelete={() => setDeleting(f)} act={act} onOpen={(p) => router.push(p)} compact />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
                    <StatusBadge status={f.status} live={f.live} pending={f.hasUnpublishedChanges} />
                    <span>
                      <b>{f.responses}</b> respostas
                    </span>
                    <span className="text-muted">Conversão {f.views ? pct(f.conversion) : "—"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <EmbedDialog form={embedFor} open={!!embedFor} onOpenChange={(v) => !v && setEmbedFor(null)} />
      <ConfirmDelete form={deleting} onClose={() => setDeleting(null)} onDone={refresh} />
    </Card>
  );
}

function RowActions({
  f,
  onEmbed,
  onDelete,
  act,
  onOpen,
  compact,
}: {
  f: FormListItem;
  onEmbed: () => void;
  onDelete: () => void;
  act: (fn: () => Promise<unknown>, ok: string) => void;
  onOpen: (path: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {!compact && (
        <>
          <IconButton size="sm" label="Editar" onClick={() => onOpen(`/formularios/${f.id}`)}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton size="sm" label="Ver respostas" onClick={() => onOpen(`/formularios/${f.id}/respostas`)}>
            <Inbox className="size-4" />
          </IconButton>
          <IconButton size="sm" label="Copiar link" onClick={() => copyText(f.publicUrl, f.live ? "Link copiado" : "Link copiado (publique para ele funcionar)")}>
            <Link2 className="size-4" />
          </IconButton>
        </>
      )}
      <Menu>
        <MenuTrigger asChild>
          <IconButton size="sm" label={`Mais ações de ${f.name}`}>
            <MoreHorizontal className="size-4" />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          {compact && (
            <>
              <MenuItem icon={<Pencil />} onSelect={() => onOpen(`/formularios/${f.id}`)}>
                Editar
              </MenuItem>
              <MenuItem icon={<Inbox />} onSelect={() => onOpen(`/formularios/${f.id}/respostas`)}>
                Ver respostas
              </MenuItem>
              <MenuItem icon={<Link2 />} onSelect={() => copyText(f.publicUrl, "Link copiado")}>
                Copiar link
              </MenuItem>
            </>
          )}
          <MenuItem icon={<Code2 />} onSelect={onEmbed}>
            Código de incorporação
          </MenuItem>
          {f.live && (
            <MenuItem icon={<Eye />} onSelect={() => window.open(f.publicUrl, "_blank", "noopener")}>
              Abrir formulário público
            </MenuItem>
          )}
          <MenuItem icon={<Copy />} onSelect={() => act(() => api.post(`/api/forms/${f.id}/duplicate`), "Cópia criada como rascunho.")}>
            Duplicar
          </MenuItem>
          <MenuSeparator />
          {f.status === "archived" ? (
            <MenuItem icon={<ArchiveRestore />} onSelect={() => act(() => api.post(`/api/forms/${f.id}/archive`, { archived: false }), "Formulário restaurado como rascunho.")}>
              Restaurar
            </MenuItem>
          ) : (
            <MenuItem icon={<Archive />} onSelect={() => act(() => api.post(`/api/forms/${f.id}/archive`, { archived: true }), "Formulário arquivado. O link público foi desativado.")}>
              Arquivar
            </MenuItem>
          )}
          <MenuItem icon={<Trash2 />} danger disabled={f.responses > 0} onSelect={onDelete}>
            {f.responses > 0 ? "Excluir (tem respostas)" : "Excluir"}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

function DashboardSection({ days, setDays }: { days: string; setDays: (v: string) => void }) {
  const { data, error, mutate } = useSWR<Dashboard>(`/api/forms/dashboard${qs({ days })}`, fetcher, { keepPreviousData: true });
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <LoadingState rows={2} />;
  const t = data.totals;
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold">Resumo</h2>
        <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período" className="w-40">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="365">Últimos 12 meses</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi i={0} icon={<ClipboardList />} label="Formulários" value={t.forms} sub={`${t.archived} arquivado${t.archived === 1 ? "" : "s"}`} />
        <Kpi i={1} icon={<CheckCircle2 />} label="Publicados" value={t.published} sub={`${t.drafts} rascunho${t.drafts === 1 ? "" : "s"}`} />
        <Kpi i={2} icon={<Eye />} label="Visualizações" value={t.views.toLocaleString("pt-BR")} sub={`${t.starts.toLocaleString("pt-BR")} começaram`} />
        <Kpi i={3} icon={<Inbox />} label="Respostas" value={t.responses.toLocaleString("pt-BR")} sub="Envios concluídos" />
        <Kpi i={4} icon={<TrendingUp />} label="Taxa de conclusão" value={t.starts ? pct(t.completionRate) : "—"} sub="Concluíram ÷ começaram" />
        <Kpi i={5} icon={<Star />} label="Leads qualificados" value={t.qualified.toLocaleString("pt-BR")} sub="Faixas marcadas como qualificadas" />
      </div>
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        <Card className="p-5 sm:p-6 lg:col-span-2">
          <h3 className="mb-4 text-[16px] font-semibold">Respostas por dia</h3>
          <DailyChart series={data.series} />
        </Card>
        <div className="flex flex-col gap-4 sm:gap-5">
          <Card className="p-5 sm:p-6">
            <h3 className="mb-4 text-[16px] font-semibold">Por classificação</h3>
            <BarList rows={data.byTier} />
          </Card>
          <Card className="p-5 sm:p-6">
            <h3 className="mb-4 text-[16px] font-semibold">Origem dos leads</h3>
            <BarList rows={data.byOrigin} />
          </Card>
        </div>
      </div>
    </div>
  );
}

type PrivacyRequest = { id: string; kind: keyof typeof PRIVACY_KIND_LABEL; name: string | null; email: string | null; phone: string | null; message: string | null; status: string; createdAt: string; resolvedAt: string | null };

function PrivacyRequests() {
  const { data, error, mutate } = useSWR<PrivacyRequest[]>("/api/privacy-requests", fetcher);
  const resolve = async (id: string) => {
    try {
      await api.patch(`/api/privacy-requests/${id}`, {});
      toast.success("Pedido marcado como atendido.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-[18px] font-semibold">Pedidos de titulares (LGPD)</h2>
      <p className="mt-1 text-[13.5px] text-muted">
        Pedidos enviados pela página de privacidade. Para atender, abra o contato e use &quot;Exportar dados&quot; ou &quot;Anonimizar respostas&quot; na aba Formulários.
      </p>
      <div className="mt-4">
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : !data ? (
          <LoadingState rows={2} />
        ) : !data.length ? (
          <EmptyState icon={<ShieldCheck />} title="Nenhum pedido recebido" description="Quando alguém pedir acesso, correção ou exclusão dos dados, o pedido aparece aqui e os administradores são avisados." />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-[18px] border border-line p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{PRIVACY_KIND_LABEL[r.kind] ?? r.kind}</span>
                    <Badge tone={r.status === "done" ? "success" : "warning"}>{r.status === "done" ? "Atendido" : "Aberto"}</Badge>
                  </div>
                  <p className="mt-1 text-[13.5px] text-ink">
                    {r.name} · {[r.email, r.phone].filter(Boolean).join(" · ")}
                  </p>
                  {r.message && <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-muted">{r.message}</p>}
                  <p className="mt-1 text-[12px] text-muted">Recebido em {formatDateTime(r.createdAt)}</p>
                </div>
                {r.status !== "done" && (
                  <Button size="sm" variant="secondary" onClick={() => resolve(r.id)}>
                    Marcar como atendido
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function FormsView() {
  const me = useMe();
  const [tab, setTab] = useQueryParam("aba", "formularios");
  const [days, setDays] = useQueryParam("dias", "30");
  const [creating, setCreating] = useState(false);
  const { mutate } = useSWR<Dashboard>(`/api/forms/dashboard${qs({ days })}`, fetcher);
  if (!me.permissions.forms) return <NoPermission message="Formulários & Quizzes é gerenciado por administradores e gestores." />;
  const isAdmin = me.user.role === "admin";
  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        title="Formulários & Quizzes"
        subtitle="Capte, qualifique e distribua leads automaticamente."
        actions={
          <Button icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>
            Criar formulário
          </Button>
        }
      />
      {isAdmin && (
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "formularios", label: "Formulários", icon: <BarChart3 /> },
            { value: "privacidade", label: "Pedidos LGPD", icon: <ShieldCheck /> },
          ]}
        />
      )}
      {tab === "privacidade" && isAdmin ? (
        <PrivacyRequests />
      ) : (
        <>
          <DashboardSection days={days} setDays={setDays} />
          <FormsList onChanged={() => mutate()} />
        </>
      )}
      <CreateDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
