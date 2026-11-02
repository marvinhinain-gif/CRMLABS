"use client";

import { useMemo } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { Activity, KeyRound, LogIn, LogOut, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { formatDateTime, relativeTime } from "@/lib/format";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABEL, activityCategory, activityDetail, activityLabel } from "@/lib/activity";
import { Avatar, Badge, Button, Card, cx, EmptyState, ErrorState, LoadingState, NoPermission, Select } from "@/components/ui";

type SummaryRow = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "disabled";
  avatarUrl: string | null;
  lastSeenAt: string | null;
  openSessions: number;
  accesses: number;
  failedLogins: number;
  actions: number;
  lastActionAt: string | null;
};

type ActivityRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  contactId: string | null;
  contactName: string | null;
};

const PERIOD_OPTIONS = [
  ["today", "Hoje"],
  ["7d", "Últimos 7 dias"],
  ["30d", "Últimos 30 dias"],
  ["month", "Este mês"],
  ["last_month", "Mês passado"],
] as const;

function AccessIcon({ action }: { action: string }) {
  const cls = "size-4";
  if (action === "auth.logout") return <LogOut className={cls} />;
  if (action === "auth.login_failed") return <ShieldAlert className={cls} />;
  if (action === "auth.password_changed" || action === "auth.password_reset") return <KeyRound className={cls} />;
  if (action === "auth.session_resumed") return <MonitorSmartphone className={cls} />;
  if (action.startsWith("auth.")) return <LogIn className={cls} />;
  return <Activity className={cls} />;
}

/** Configurações → Atividade: quando cada pessoa da equipe acessou o CRM e o que fez. Só administrador. */
export function TeamActivityTab() {
  const me = useMe();
  const [periodo, setPeriodo] = useQueryParam("periodo", "7d");
  const [pessoa, setPessoa] = useQueryParam("pessoa", "");
  const [tipo, setTipo] = useQueryParam("tipo", "");
  const openContact = useOpenContact();
  const tz = me.org.timezone || "America/Bahia";
  const timeFmt = useMemo(() => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }), [tz]);
  const dayFmt = useMemo(() => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long", day: "2-digit", month: "long" }), [tz]);

  const admin = me.permissions.teamManage;
  const summary = useSWR<SummaryRow[]>(admin ? `/api/team/activity/summary${qs({ periodo })}` : null, fetcher);
  const getKey = (_i: number, prev: { nextCursor: string | null } | null) =>
    !admin || (prev && !prev.nextCursor) ? null : `/api/team/activity${qs({ periodo, pessoa: pessoa || undefined, tipo: tipo || undefined, cursor: prev?.nextCursor ?? undefined })}`;
  const feed = useSWRInfinite<{ items: ActivityRow[]; nextCursor: string | null }>(getKey, fetcher);

  if (!admin) return <NoPermission message="Somente administradores veem o histórico de acessos e atividades da equipe." />;

  const people = summary.data ?? [];
  const rows = feed.data?.flatMap((p) => p.items) ?? [];
  const selected = people.find((p) => p.userId === pessoa);
  let lastDay = "";

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[18px] font-semibold">Acessos da equipe</h2>
            <p className="mt-1 text-[13.5px] text-muted">Quando cada pessoa entrou no CRM e quanto trabalhou no período. Toque numa pessoa para ver só o que ela fez.</p>
          </div>
          <Select aria-label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="h-9 w-auto shrink-0 bg-white text-[13px]">
            {PERIOD_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        {summary.error ? (
          <ErrorState error={summary.error} onRetry={() => summary.mutate()} />
        ) : !summary.data ? (
          <LoadingState rows={4} />
        ) : (
          <ul className="divide-y divide-line">
            {people.map((p) => {
              const active = p.userId === pessoa;
              return (
                <li key={p.userId}>
                  <button
                    type="button"
                    onClick={() => setPessoa(active ? null : p.userId)}
                    aria-pressed={active}
                    className={cx("flex w-full flex-col gap-2 rounded-[12px] px-2 py-3 text-left transition-colors hover:bg-page/70 sm:flex-row sm:items-center sm:gap-4", active && "bg-brand/10 hover:bg-brand/10")}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={p.name} src={p.avatarUrl} size={40} />
                      <div className="min-w-0">
                        <p className="truncate text-[14.5px] font-semibold">
                          {p.name}
                          {p.status === "disabled" && <span className="font-normal text-muted"> (desativado)</span>}
                        </p>
                        <p className="truncate text-[12.5px] text-muted">
                          {ROLE_LABEL[p.role]} · {p.lastSeenAt ? <span title={formatDateTime(p.lastSeenAt)}>visto {relativeTime(p.lastSeenAt)}</span> : "nunca acessou"}
                        </p>
                      </div>
                    </div>
                    <div className="ml-[52px] flex flex-wrap items-center gap-2 sm:ml-0 sm:justify-end">
                      <Badge tone={p.accesses ? "info" : "neutral"}>
                        {p.accesses} {p.accesses === 1 ? "acesso" : "acessos"}
                      </Badge>
                      <Badge tone={p.actions ? "success" : "neutral"}>
                        {p.actions} {p.actions === 1 ? "ação" : "ações"}
                      </Badge>
                      {p.failedLogins > 0 && (
                        <Badge tone="danger">
                          {p.failedLogins} {p.failedLogins === 1 ? "senha errada" : "senhas erradas"}
                        </Badge>
                      )}
                      {p.openSessions > 0 && <span className="text-[12px] text-muted">{p.openSessions === 1 ? "1 aparelho conectado" : `${p.openSessions} aparelhos conectados`}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold">{selected ? `O que ${selected.name} fez` : "O que a equipe fez"}</h2>
            <p className="mt-1 text-[13.5px] text-muted">Entradas e saídas do CRM e as ações em leads, Kanban, Instagram, comercial, tarefas e configurações.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Select aria-label="Pessoa" value={pessoa} onChange={(e) => setPessoa(e.target.value || null)} className="h-9 w-auto bg-white text-[13px]">
              <option value="">Toda a equipe</option>
              {people.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value || null)} className="h-9 w-auto bg-white text-[13px]">
              <option value="">Tudo</option>
              {ACTIVITY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ACTIVITY_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {feed.error ? (
          <ErrorState error={feed.error} onRetry={() => feed.mutate()} />
        ) : feed.isLoading && !feed.data ? (
          <LoadingState rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Activity />} title="Nada registrado no período" description="Os acessos e as ações aparecem aqui assim que alguém entrar ou mexer no CRM." />
        ) : (
          <>
            <ol>
              {rows.map((r) => {
                const day = dayFmt.format(new Date(r.createdAt));
                const header = day !== lastDay ? ((lastDay = day), day) : null;
                const access = r.action.startsWith("auth.");
                const failed = r.action === "auth.login_failed";
                const detail = activityDetail(r.action, r.data);
                const device = access && typeof r.data?.device === "string" ? r.data.device : null;
                const ip = access && typeof r.data?.ip === "string" ? r.data.ip : null;
                return (
                  <li key={r.id}>
                    {header && <p className="mt-4 mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted first-letter:uppercase">{header}</p>}
                    <div className="flex gap-3 border-b border-line py-3 last:border-0">
                      <span className="w-11 shrink-0 pt-0.5 text-[13px] font-semibold tabular-nums">{timeFmt.format(new Date(r.createdAt))}</span>
                      <span
                        className={cx(
                          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
                          failed ? "bg-danger-soft text-danger" : access ? "bg-info-soft text-info" : "bg-page text-muted",
                        )}
                        aria-hidden
                      >
                        <AccessIcon action={r.action} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px]">
                          {!selected && <b className="font-semibold">{r.actorName ?? "Alguém"} </b>}
                          <span className={cx(failed && "text-danger")}>{selected ? activityLabel(r.action) : activityLabel(r.action).replace(/^./, (c) => c.toLowerCase())}</span>
                          {r.contactName && (
                            <>
                              {" · "}
                              <button type="button" className="font-medium text-brand hover:underline" onClick={() => openContact(r.contactId!)}>
                                {r.contactName}
                              </button>
                            </>
                          )}
                        </p>
                        {(detail || device || ip) && (
                          <p className="mt-0.5 truncate text-[12.5px] text-muted">
                            {[detail && detail !== r.contactName ? detail : null, device, ip ? `IP ${ip}` : null].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <span className="hidden shrink-0 self-center text-[11.5px] text-muted sm:block">{ACTIVITY_CATEGORY_LABEL[activityCategory(r.action)]}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
            {feed.data?.[feed.data.length - 1]?.nextCursor && (
              <div className="pt-3">
                <Button variant="secondary" size="sm" className="w-full" loading={feed.isValidating} onClick={() => feed.setSize(feed.size + 1)}>
                  Carregar mais
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
