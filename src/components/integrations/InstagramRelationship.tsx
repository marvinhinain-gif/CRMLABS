"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { AtSign, Heart, MessageCircle, MessagesSquare, RefreshCw, Sparkles } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";
import { Button, cx } from "@/components/ui";

type Relationship = {
  username: string | null;
  linked: boolean;
  accountUsername: string | null;
  followsBusiness: boolean | null;
  followConfirmedSince: string | null;
  followCheckedAt: string | null;
  followerCount: number | null;
  messages: { inbound: number; outbound: number; first: string | null; last: string | null };
  storyReplies: number;
  storyMentions: number;
  comments: { count: number; first: string | null; last: string | null };
  firstInteractionAt: string | null;
  lastInteractionAt: string | null;
  canRefresh: boolean;
};

/** "3 meses", "1 ano e 2 meses", "12 dias". */
export function durationSince(v: string | null) {
  if (!v) return null;
  const from = new Date(v);
  const now = new Date();
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months--;
  if (months < 1) {
    const days = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86400000));
    return days < 1 ? "hoje" : `${days} dia${days === 1 ? "" : "s"}`;
  }
  const y = Math.floor(months / 12);
  const m = months % 12;
  const ys = y ? `${y} ano${y === 1 ? "" : "s"}` : "";
  const ms = m ? `${m} ${m === 1 ? "mês" : "meses"}` : "";
  return [ys, ms].filter(Boolean).join(" e ");
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string | null }) {
  return (
    <div className="rounded-[14px] bg-page px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        <span className="[&>svg]:size-3.5" aria-hidden>
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-0.5 text-[18px] font-bold leading-tight">{value.toLocaleString("pt-BR")}</p>
      {sub && <p className="text-[11.5px] text-muted">{sub}</p>}
    </div>
  );
}

/** Se a pessoa segue a conta, há quanto tempo interage e o que já fez no Instagram. */
export function InstagramRelationship({ contactId, compact }: { contactId: string; compact?: boolean }) {
  const { data, mutate } = useSWR<Relationship>(`/api/contacts/${contactId}/instagram`, fetcher);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const interactions = data.messages.inbound + data.comments.count;
  if (!data.username && !data.linked && !interactions) return null;

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await api.post<Relationship>(`/api/contacts/${contactId}/instagram`, {});
      await mutate(next, { revalidate: false });
      toast.success(next.followsBusiness === null ? "Consulta feita. O Instagram não informou se segue a conta." : "Relacionamento atualizado.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const account = data.accountUsername ? `@${data.accountUsername}` : "a conta";
  const since = durationSince(data.firstInteractionAt);
  return (
    <section className="rounded-[18px] border border-line p-4" aria-label="Relacionamento no Instagram">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12.5px] text-muted">Instagram{data.username ? ` · @${data.username}` : ""}</p>
          <p className={cx("mt-1 flex items-center gap-1.5 text-[15px] font-semibold", data.followsBusiness === true ? "text-success" : data.followsBusiness === false ? "text-ink" : "text-muted")}>
            <Heart className="size-4" aria-hidden fill={data.followsBusiness ? "currentColor" : "none"} />
            {data.followsBusiness === true
              ? `Segue ${account}`
              : data.followsBusiness === false
                ? `Não segue ${account}`
                : data.linked
                  ? "Ainda não sabemos se segue"
                  : "Seguir: só dá para saber depois que a pessoa conversar no Direct"}
          </p>
          {data.followsBusiness === true && data.followConfirmedSince && (
            <p className="mt-0.5 text-[12.5px] text-muted">Confirmado pelo CRM desde {formatDate(data.followConfirmedSince)} ({durationSince(data.followConfirmedSince)})</p>
          )}
          {data.followerCount !== null && <p className="mt-0.5 text-[12.5px] text-muted">Perfil com {data.followerCount.toLocaleString("pt-BR")} seguidores</p>}
        </div>
        {data.linked && (
          <Button size="sm" variant="ghost" icon={<RefreshCw className={cx("size-4", busy && "animate-spin")} />} onClick={refresh} disabled={busy || !data.canRefresh} title={!data.canRefresh ? "Consultado há pouco. Tente de novo em alguns minutos." : undefined}>
            Atualizar
          </Button>
        )}
      </div>

      <p className="mt-3 text-[13.5px]">
        {since ? (
          <>
            Interage com {account} há <b>{since}</b> <span className="text-muted">(desde {formatDate(data.firstInteractionAt)})</span>
            {data.lastInteractionAt && <span className="text-muted"> · última interação: {relativeTime(data.lastInteractionAt).toLowerCase()}</span>}
          </>
        ) : (
          <span className="text-muted">Nenhuma interação registrada no Direct ou nos comentários.</span>
        )}
      </p>

      <div className={cx("mt-3 grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
        <Stat icon={<MessagesSquare />} label="Mensagens no Direct" value={data.messages.inbound} sub={data.messages.outbound ? `${data.messages.outbound} enviadas pela equipe` : null} />
        <Stat icon={<Sparkles />} label="Respostas a Stories" value={data.storyReplies} />
        <Stat icon={<AtSign />} label="Menções em Stories" value={data.storyMentions} />
        <Stat icon={<MessageCircle />} label="Comentários" value={data.comments.count} sub={data.comments.last ? `último ${formatDate(data.comments.last)}` : null} />
      </div>
      {!compact && <p className="mt-3 text-[11.5px] text-muted">O Instagram não informa a data em que a pessoa começou a seguir. Mostramos a primeira vez que o CRM confirmou e há quanto tempo ela interage com a conta.</p>}
    </section>
  );
}
