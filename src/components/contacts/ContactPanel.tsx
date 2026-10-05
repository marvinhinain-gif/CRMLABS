"use client";

import Link from "next/link";
import { ForwardDialog } from "@/components/commercial/ForwardDialog";
import { LeadTasks } from "@/components/tasks/TaskParts";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  Archive,
  AtSign,
  BadgeCheck,
  CalendarClock,
  ExternalLink,
  History,
  MessageCircle,
  Ellipsis,
  NotebookPen,
  Plus,
  Send,
  SquareCheck,
  UserRound,
  X,
  Footprints,
} from "lucide-react";
import { JourneySection } from "@/components/integrations/Journey";
import { api, ApiError, fetcher } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import type { Stage } from "@/lib/types";
import { dayLabel, dueTone, formatBRL, formatDateTime, fromLocalInput, parseBRLToCents, relativeTime, toLocalInput } from "@/lib/format";
import {
  Avatar,
  Badge,
  Button,
  cx,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  Sheet,
  SheetClose,
  StageChip,
  Tabs,
  Textarea,
} from "@/components/ui";

type Detail = {
  contact: {
    id: string;
    name: string;
    username: string | null;
    profileUrl: string | null;
    avatarUrl: string | null;
    email: string | null;
    phone: string | null;
    source: string;
    ownerId: string | null;
    owner: { id: string; name: string } | null;
    summary: string | null;
    nextAction: string | null;
    nextActionAt: string | null;
    lastInteractionAt: string | null;
    createdAt: string;
    archivedAt: string | null;
    mergedIntoId: string | null;
  };
  identities: { id: string; provider: string; username: string | null; accountUsername: string | null; accountStatus: string }[];
  entry: { id: string; stageId: string; version: number; stageName: string; stageColor: string } | null;
  tags: { id: string; name: string; color: string }[];
  conversation: { id: string; unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null; lastMessageDirection: string | null } | null;
  opportunities: { id: string; title: string; status: string; valueCents: number; stageName: string; closerName: string | null }[];
  tasks: { id: string; title: string; dueAt: string | null; status: string; ownerName: string | null }[];
  notes: { id: string; body: string; createdAt: string; authorName: string | null }[];
  history: { id: string; entityType: string; fromStageName: string | null; toStageName: string | null; reason: string | null; createdAt: string; actorName: string | null }[];
};

const SOURCE_LABEL: Record<string, string> = { manual: "Cadastro manual", instagram_dm: "Direct do Instagram", instagram_comment: "Comentário no Instagram", import: "Importação CSV" };

type Tab = "dados" | "origem" | "tarefas" | "notas" | "historico";

export function ContactPanel({ contactId, onClose }: { contactId: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!contactId} onOpenChange={(v) => !v && onClose()} title="Contato" width={560}>
      {contactId && <PanelBody id={contactId} onClose={onClose} />}
    </Sheet>
  );
}

function PanelBody({ id, onClose }: { id: string; onClose: () => void }) {
  const key = `/api/contacts/${id}`;
  const { data, error, mutate, isLoading } = useSWR<Detail>(key, fetcher);
  const [tab, setTab] = useState<Tab>("dados");
  const me = useMe();
  const { mutate: globalMutate } = useSWRConfig();
  const refreshAll = () => {
    mutate();
    globalMutate((k) => typeof k === "string" && (k.startsWith("/api/board") || k.startsWith("/api/contacts?") || k.startsWith("/api/dashboard")));
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="flex justify-end">
          <SheetClose asChild>
            <IconButton label="Fechar">
              <X className="size-5" />
            </IconButton>
          </SheetClose>
        </div>
        <ErrorState error={error} onRetry={() => mutate()} />
      </div>
    );
  }
  if (isLoading || !data) return <LoadingState rows={6} className="p-6" />;
  const c = data.contact;
  const verified = data.identities.length > 0;

  const archive = async () => {
    if (!confirm(`Arquivar ${c.name}? O histórico é preservado.`)) return;
    try {
      await api.del(`/api/contacts/${c.id}`);
      toast.success("Contato arquivado.");
      refreshAll();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const removeFromBoard = async () => {
    if (!data.entry) return;
    try {
      await api.del(`/api/board/entries/${data.entry.id}`);
      toast.success("Removido do quadro.");
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <div className="flex items-start gap-4 border-b border-line px-6 pt-6 pb-5">
        <Avatar name={c.name} src={c.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-semibold">{c.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {c.username && <span className="text-[14px] text-muted">@{c.username}</span>}
            {verified ? (
              <Badge tone="success">
                <BadgeCheck className="size-3.5" aria-hidden /> Identidade oficial
              </Badge>
            ) : c.username ? (
              <Badge tone="neutral" className="text-[12px]">@ informado manualmente</Badge>
            ) : null}
            {c.archivedAt && <Badge tone="warning">{c.mergedIntoId ? "Mesclado" : "Arquivado"}</Badge>}
          </div>
          {data.entry && (
            <div className="mt-2">
              <StageChip name={data.entry.stageName} color={data.entry.stageColor} />
            </div>
          )}
        </div>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Mais ações">
              <Ellipsis className="size-5" />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            {data.conversation && (
              <MenuItem icon={<MessageCircle />} onSelect={() => (window.location.href = `/instagram?aba=directs&c=${data.conversation!.id}`)}>
                Abrir conversa
              </MenuItem>
            )}
            {c.profileUrl && (
              <MenuItem icon={<ExternalLink />} onSelect={() => window.open(c.profileUrl!, "_blank", "noopener")}>
                Ver perfil no Instagram
              </MenuItem>
            )}
            {data.entry && (
              <MenuItem icon={<X />} onSelect={removeFromBoard}>
                Remover do quadro
              </MenuItem>
            )}
            {me.permissions.assign && !c.archivedAt && (
              <MenuItem icon={<Archive />} danger onSelect={archive}>
                Arquivar contato
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
        <SheetClose asChild>
          <IconButton label="Fechar">
            <X className="size-5" />
          </IconButton>
        </SheetClose>
      </div>
      <div className="px-6 pt-4">
        <Tabs
          value={tab}
          onChange={setTab}
          className="w-full"
          items={[
            { value: "dados", label: "Dados", icon: <UserRound /> },
            { value: "origem", label: "Origem", icon: <Footprints /> },
            { value: "tarefas", label: "Tarefas", icon: <SquareCheck />, count: data.tasks.filter((t) => t.status !== "done").length },
            { value: "notas", label: "Notas", icon: <NotebookPen /> },
            { value: "historico", label: "Histórico", icon: <History /> },
          ]}
        />
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-6 py-5">
        {tab === "dados" && <DataTab data={data} onChanged={refreshAll} />}
        {tab === "origem" && <JourneySection contactId={id} />}
        {tab === "tarefas" && <TasksTab data={data} onChanged={refreshAll} />}
        {tab === "notas" && <NotesTab data={data} onChanged={() => mutate()} />}
        {tab === "historico" && <HistoryTab data={data} />}
      </div>
    </>
  );
}

function DataTab({ data, onChanged }: { data: Detail; onChanged: () => void }) {
  const c = data.contact;
  const me = useMe();
  const team = useTeam();
  const { data: stages } = useSWR<Stage[]>("/api/stages?kind=relationship", fetcher);
  const [form, setForm] = useState({
    name: c.name,
    username: c.username ?? "",
    profileUrl: c.profileUrl ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    summary: c.summary ?? "",
    nextAction: c.nextAction ?? "",
    nextActionAt: toLocalInput(c.nextActionAt),
  });
  const [tags, setTags] = useState(data.tags.map((t) => t.name).join(", "));
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [forwardOpen, setForwardOpen] = useState(false);

  useEffect(() => {
    setTags(data.tags.map((t) => t.name).join(", "));
  }, [data.tags]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFields({});
    try {
      await api.patch(`/api/contacts/${c.id}`, { ...form, nextActionAt: fromLocalInput(form.nextActionAt) });
      const names = tags.split(",").map((t) => t.trim()).filter(Boolean);
      await api.put(`/api/contacts/${c.id}/tags`, { names });
      toast.success("Contato salvo.");
      onChanged();
    } catch (err) {
      setFields((err as ApiError).fields);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeStage = async (stageId: string) => {
    try {
      if (data.entry) await api.post(`/api/board/entries/${data.entry.id}/move`, { toStageId: stageId, expectedVersion: data.entry.version });
      else await api.post(`/api/board/entries`, { contactId: c.id, stageId });
      toast.success("Etapa atualizada.");
    } catch (err) {
      toast.error((err as Error).message);
    }
    onChanged();
  };

  const changeOwner = async (ownerId: string) => {
    try {
      await api.patch(`/api/contacts/${c.id}`, { ownerId: ownerId || null });
      toast.success("Responsável atualizado.");
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Etapa do relacionamento" htmlFor="cp-stage">
          <Select id="cp-stage" value={data.entry?.stageId ?? ""} onChange={(e) => e.target.value && changeStage(e.target.value)}>
            {!data.entry && <option value="">Fora do quadro</option>}
            {stages?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsável" htmlFor="cp-owner">
          <Select id="cp-owner" value={c.ownerId ?? ""} onChange={(e) => changeOwner(e.target.value)} disabled={!me.permissions.assign}>
            <option value="">Sem responsável</option>
            {team
              .filter((m) => m.status === "active" || m.userId === c.ownerId)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <div className="rounded-[18px] border border-line bg-page/60 p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-semibold">Conversa vinculada</p>
          {data.conversation && (
            <Link href={`/instagram?aba=directs&c=${data.conversation.id}`} className="text-[13px] font-medium text-brand hover:underline">
              Abrir conversa
            </Link>
          )}
        </div>
        {data.conversation ? (
          <p className="text-[13.5px] text-muted">
            {data.conversation.lastMessageDirection === "in" ? "Recebida" : "Enviada"} {relativeTime(data.conversation.lastMessageAt).toLowerCase()}: “{data.conversation.lastMessagePreview}”
            {data.conversation.unreadCount > 0 && <Badge tone="brand" className="ml-2">{data.conversation.unreadCount} não lida(s)</Badge>}
          </p>
        ) : (
          <p className="text-[13.5px] text-muted">
            Nenhuma conversa ainda. Mensagens chegam pela conta do Instagram conectada{data.identities.length ? "" : "; um @ cadastrado manualmente não habilita envio de Direct"}.
          </p>
        )}
      </div>

      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Próxima ação" htmlFor="cp-na">
            <Input id="cp-na" value={form.nextAction} onChange={set("nextAction")} placeholder="Ex.: Retomar conversa" maxLength={140} />
          </Field>
          <Field label="Quando" htmlFor="cp-nad">
            <Input id="cp-nad" type="datetime-local" value={form.nextActionAt} onChange={set("nextActionAt")} />
          </Field>
        </div>
        <Field label="Resumo curto (aparece no cartão)" htmlFor="cp-sum" error={fields.summary}>
          <Input id="cp-sum" value={form.summary} onChange={set("summary")} maxLength={140} placeholder="Ex.: Interessado na consultoria" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" htmlFor="cp-name" error={fields.name}>
            <Input id="cp-name" value={form.name} onChange={set("name")} required />
          </Field>
          <Field label="@ do Instagram" htmlFor="cp-user" hint={data.identities.length ? undefined : "Informativo: não é identidade verificada."}>
            <Input id="cp-user" value={form.username} onChange={set("username")} icon={<AtSign />} />
          </Field>
          <Field label="E-mail (opcional)" htmlFor="cp-email" error={fields.email}>
            <Input id="cp-email" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Telefone (opcional)" htmlFor="cp-phone">
            <Input id="cp-phone" value={form.phone} onChange={set("phone")} />
          </Field>
        </div>
        <Field label="Link do perfil" htmlFor="cp-url" error={fields.profileUrl}>
          <Input id="cp-url" value={form.profileUrl} onChange={set("profileUrl")} placeholder="https://www.instagram.com/…" />
        </Field>
        <Field label="Tags (separadas por vírgula)" htmlFor="cp-tags">
          <Input id="cp-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="lead quente, mentoria" />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Salvar alterações
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">Oportunidades</p>
          <Button size="sm" variant="soft" icon={<Send className="size-4" />} onClick={() => setForwardOpen(true)}>
            Encaminhar para Closer
          </Button>
        </div>
        {data.opportunities.length === 0 ? (
          <p className="text-[13.5px] text-muted">Nenhuma oportunidade comercial registrada.</p>
        ) : (
          data.opportunities.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-[16px] border border-line px-4 py-3">
              <Link href={`/comercial?op=${o.id}`} className="min-w-0 hover:underline">
                <p className="truncate text-[14px] font-medium">{o.title}</p>
                <p className="text-[12.5px] text-muted">
                  {o.stageName} · {o.closerName ? `Closer: ${o.closerName}` : "Sem closer"}
                </p>
              </Link>
              <div className="text-right">
                <p className="text-[14px] font-semibold">{formatBRL(o.valueCents)}</p>
                <Badge tone={o.status === "won" ? "success" : o.status === "lost" ? "danger" : "info"}>{o.status === "won" ? "Ganha" : o.status === "lost" ? "Perdida" : "Aberta"}</Badge>
              </div>
            </div>
          ))
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-[18px] bg-page/70 p-4 text-[13px]">
        <div>
          <dt className="text-muted">Origem</dt>
          <dd className="font-medium">{SOURCE_LABEL[c.source] ?? c.source}</dd>
        </div>
        <div>
          <dt className="text-muted">Criado em</dt>
          <dd className="font-medium">{formatDateTime(c.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">Última interação</dt>
          <dd className="font-medium">{c.lastInteractionAt ? formatDateTime(c.lastInteractionAt) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Identidade oficial</dt>
          <dd className="font-medium">{data.identities.length ? data.identities.map((i) => `Instagram (${i.accountUsername ? "@" + i.accountUsername : "conta"})`).join(", ") : "Nenhuma"}</dd>
        </div>
      </dl>
      <ForwardDialog open={forwardOpen} onOpenChange={setForwardOpen} contactId={c.id} contactName={c.name} onDone={onChanged} />
    </div>
  );
}

function TasksTab({ data }: { data: Detail; onChanged: () => void }) {
  const open = data.opportunities.find((o) => o.status === "open");
  return <LeadTasks contact={{ id: data.contact.id, name: data.contact.name }} opportunityId={open?.id ?? null} />;
}

function NotesTab({ data, onChanged }: { data: Detail; onChanged: () => void }) {
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    try {
      await api.post(`/api/contacts/${data.contact.id}/notes`, { body });
      setBody("");
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="flex flex-col gap-3">
        <Field label="Nota interna" htmlFor="nt-body" hint="Visível só para a equipe. Notas internas nunca são enviadas ao Instagram.">
          <Textarea id="nt-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={loading} disabled={!body.trim()}>
            Adicionar nota
          </Button>
        </div>
      </form>
      {data.notes.length === 0 ? (
        <p className="text-center text-[13.5px] text-muted py-6">Nenhuma nota ainda.</p>
      ) : (
        data.notes.map((n) => (
          <article key={n.id} className="rounded-[16px] bg-[#fffbea] border border-[#f3e7b8] px-4 py-3">
            <p className="whitespace-pre-wrap text-[14px]">{n.body}</p>
            <p className="mt-2 text-[12px] text-muted">
              {n.authorName ?? "—"} · {formatDateTime(n.createdAt)}
            </p>
          </article>
        ))
      )}
    </div>
  );
}

function HistoryTab({ data }: { data: Detail }) {
  if (!data.history.length) return <p className="text-center text-[13.5px] text-muted py-6">Sem movimentações registradas.</p>;
  return (
    <ol className="relative ml-2 border-l-2 border-line pl-5 flex flex-col gap-5">
      {data.history.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[27px] top-1 size-3 rounded-full bg-brand ring-4 ring-white" aria-hidden />
          <p className="text-[14px]">
            {h.entityType === "opportunity" && <span className="font-medium">Comercial: </span>}
            {h.fromStageName && h.toStageName && h.fromStageName !== h.toStageName ? (
              <>
                <span className="text-muted">{h.fromStageName}</span> → <span className="font-medium">{h.toStageName}</span>
              </>
            ) : h.toStageName && !h.fromStageName ? (
              <>
                Entrou em <span className="font-medium">{h.toStageName}</span>
              </>
            ) : (
              <span className="font-medium">{h.reason}</span>
            )}
          </p>
          {h.reason && h.fromStageName !== null && h.toStageName !== h.fromStageName && <p className="text-[12.5px] text-muted">{h.reason}</p>}
          <p className="text-[12px] text-muted">
            {h.actorName ?? "Automático"} · {formatDateTime(h.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
