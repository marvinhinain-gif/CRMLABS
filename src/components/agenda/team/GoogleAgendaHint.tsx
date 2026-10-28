"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarCheck, CircleCheck } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { Button, Card } from "@/components/ui";

type CalendarState = { google: { available: boolean; connected: boolean; email: string | null; lastError: string | null } };

/** Convite para levar a agenda do CRM ao Google Agenda de cada pessoa (some depois de conectar). */
export function GoogleAgendaHint() {
  const me = useMe();
  const { data } = useSWR<CalendarState>("/api/me/calendar", fetcher);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const g = data.google;

  if (g.connected)
    return (
      <p className="anim-rise -mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <CircleCheck className="size-4 text-success" aria-hidden />
        Tudo o que for marcado para você aparece no seu Google Agenda ({g.email}).
        {g.lastError && (
          <Link href="/configuracoes?aba=perfil#agenda" className="font-semibold text-danger hover:underline">
            Ver problema na sincronização
          </Link>
        )}
      </p>
    );
  if (!g.available && !me.permissions.integrations) return null;

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>("/api/calendar/google/connect");
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card className="anim-rise flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-info-soft text-info" aria-hidden>
        <CalendarCheck className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Veja sua agenda do CRM no Google Agenda</p>
        <p className="text-[13px] text-muted">
          {g.available
            ? "Conecte sua conta Google: compromissos e reuniões marcados para você entram, mudam e saem da sua agenda na hora."
            : "Ligue o Google uma vez em Integrações. Depois cada pessoa conecta a própria agenda aqui."}
        </p>
      </div>
      {g.available ? (
        <Button className="w-full sm:w-auto" icon={<CalendarCheck className="size-4" />} loading={busy} onClick={connect}>
          Conectar Google Agenda
        </Button>
      ) : (
        <Link href="/integracoes" className="inline-flex h-10 items-center justify-center rounded-[12px] border border-line px-3.5 text-[13.5px] font-medium hover:bg-page">
          Abrir Integrações
        </Link>
      )}
    </Card>
  );
}
