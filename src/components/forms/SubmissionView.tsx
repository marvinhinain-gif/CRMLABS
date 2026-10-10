"use client";

import useSWR from "swr";
import { ArrowDownRight, CheckCircle2, CircleSlash, SquareUser } from "lucide-react";
import { fetcher } from "@/lib/api";
import { formatDateTime, formatPhone } from "@/lib/format";
import { Badge, Button, ErrorState, LoadingState } from "@/components/ui";
import { LEAD_STATUS_LABEL, TierBadge, type SubmissionDetail } from "./shared";

const ROUTE_LABEL: Record<string, string> = { sales: "Comercial (closer)", relationship: "Social Seller", none: "Somente base de contatos" };
const CONSENT_LABEL = (k: string) => (k === "processing_notice" ? "Aviso de tratamento de dados" : k === "marketing" ? "Marketing (opcional)" : k.startsWith("question:") ? "Pergunta de consentimento" : k);

/** Uma resposta completa: dados, score, classificação, respostas, consentimentos e histórico. */
export function SubmissionView({ id, onOpenContact }: { id: string; onOpenContact?: (contactId: string) => void }) {
  const { data: s, error, mutate } = useSWR<SubmissionDetail>(`/api/forms/submissions/${id}`, fetcher);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!s) return <LoadingState rows={5} />;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[12.5px] text-muted">
          {s.formTitle} · versão {s.version} · {formatDateTime(s.completedAt)}
        </p>
        <h2 className="mt-1 text-[22px] font-bold tracking-tight">{s.name ?? "Sem nome"}</h2>
        <div className="mt-1 flex flex-col gap-0.5 text-[13.5px] text-muted">
          {s.email && <span>{s.email}</span>}
          {s.phone && <span>{formatPhone(s.phone)}</span>}
          {s.instagram && <span>@{s.instagram}</span>}
          {s.company && <span>{s.company}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {s.anonymizedAt && <Badge tone="neutral">Anonimizada em {formatDateTime(s.anonymizedAt)}</Badge>}
          {s.duplicateOf && <Badge tone="warning">Envio repetido (não criou novo lead)</Badge>}
          {s.contactId && onOpenContact && (
            <Button size="sm" variant="secondary" icon={<SquareUser className="size-4" />} onClick={() => onOpenContact(s.contactId!)}>
              Abrir contato
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[18px] border border-line p-4">
          <p className="text-[12.5px] text-muted">Lead Score (interno)</p>
          <p className="mt-1 text-[28px] font-bold leading-none">{s.score ?? "—"}</p>
          {s.maxPoints ? (
            <p className="mt-1 text-[12px] text-muted">
              {s.rawPoints} de {s.maxPoints} pontos
            </p>
          ) : null}
        </div>
        <div className="rounded-[18px] border border-line p-4">
          <p className="text-[12.5px] text-muted">Classificação</p>
          <div className="mt-2">
            <TierBadge label={s.tierLabel} color={s.tierColor} />
          </div>
          {s.route && <p className="mt-2 text-[12px] text-muted">Destino: {ROUTE_LABEL[s.route.mode] ?? s.route.mode}</p>}
        </div>
      </div>

      {s.demotions.length > 0 && (
        <div className="rounded-[16px] border border-warning/30 bg-warning-soft p-3 text-[13px]">
          <p className="font-semibold text-warning">
            Pela pontuação seria {s.scoreTierLabel}, mas não cumpriu:
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {s.demotions.map((d) => (
              <li key={d.tier} className="flex items-start gap-1.5">
                <ArrowDownRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {d.tier}: {d.failed.join("; ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 rounded-[18px] border border-line p-4 text-[13.5px] sm:grid-cols-2">
        <div>
          <span className="text-muted">Origem: </span>
          {s.origin} ({s.channel === "embed" ? "incorporado" : "link"})
        </div>
        <div>
          <span className="text-muted">Status comercial: </span>
          {s.lead ? LEAD_STATUS_LABEL[s.lead.status] ?? s.lead.status : "—"}
        </div>
        <div>
          <span className="text-muted">Responsável: </span>
          {s.lead?.assignedName ?? "—"}
        </div>
        {Object.entries(s.utm).filter(([, v]) => v).length > 0 && (
          <div className="sm:col-span-2">
            <span className="text-muted">UTMs: </span>
            {Object.entries(s.utm)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}=${v}`)
              .join(" · ")}
          </div>
        )}
        {s.referrer && (
          <div className="truncate sm:col-span-2">
            <span className="text-muted">Página: </span>
            {s.referrer}
          </div>
        )}
      </div>

      {s.sections.map((sec) => (
        <section key={sec.title}>
          <h3 className="mb-2 text-[15px] font-semibold">{sec.title}</h3>
          <dl className="flex flex-col divide-y divide-line rounded-[18px] border border-line">
            {sec.answers.map((a) => (
              <div key={a.questionId} className="flex flex-col gap-0.5 px-4 py-3">
                <dt className="text-[12.5px] text-muted">{a.title}</dt>
                <dd className="flex items-start justify-between gap-3 text-[14px] text-ink">
                  <span className="whitespace-pre-wrap break-words">{a.value || "—"}</span>
                  {a.points !== null && (
                    <span className="shrink-0 rounded-full bg-selected px-2 py-0.5 text-[12px] font-semibold text-brand">
                      {a.points}/{a.maxPoints}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">Consentimentos</h3>
        <ul className="flex flex-col gap-2">
          {s.consents.map((c) => (
            <li key={c.kind} className="rounded-[16px] border border-line p-3 text-[13px]">
              <div className="flex items-center gap-2 font-medium">
                {c.granted ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <CircleSlash className="size-4 text-muted" aria-hidden />}
                {CONSENT_LABEL(c.kind)}: {c.granted ? "aceito" : "não aceito"}
              </div>
              <p className="mt-1 text-muted">“{c.text}”</p>
              <p className="mt-1 text-[12px] text-muted">
                Versão {c.textVersion} · {formatDateTime(c.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {s.history.length > 0 && (
        <section>
          <h3 className="mb-2 text-[15px] font-semibold">Histórico do score</h3>
          <ul className="flex flex-col divide-y divide-line rounded-[18px] border border-line">
            {s.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span>
                  <b>{h.score ?? "—"}</b> · {h.tierLabel ?? "sem faixa"} <span className="text-muted">({h.reason})</span>
                </span>
                <span className="text-[12px] text-muted">
                  {formatDateTime(h.createdAt)}
                  {h.actorName ? ` · ${h.actorName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
