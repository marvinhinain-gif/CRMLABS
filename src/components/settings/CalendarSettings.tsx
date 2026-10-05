"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, CircleCheck, RefreshCw, Unplug } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Badge, Button, Card, LoadingState, Switch } from "@/components/ui";
import { Copyable } from "./Copyable";

type CalendarState = {
  feedUrl: string;
  webcalUrl: string;
  googleAddUrl: string;
  google: { available: boolean; connected: boolean; email: string | null; connectedAt: string | null; lastSyncAt: string | null; lastError: string | null; createMeet: boolean };
};

/** "Minha agenda": reuniões do CRMLABS na agenda pessoal (Google Agenda conectado ou link de assinatura). */
export function CalendarSettings() {
  const { data, mutate } = useSWR<CalendarState>("/api/me/calendar", fetcher);
  const sp = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const st = sp.get("agenda");
    if (st === "conectada") toast.success("Google Agenda conectado! As reuniões já vão aparecer lá.");
    else if (st === "erro") toast.error(sp.get("motivo") ?? "Não foi possível conectar o Google Agenda.");
  }, [sp]);
  if (!data) return <LoadingState rows={3} />;
  const g = data.google;

  const connect = async () => {
    setBusy("connect");
    try {
      const { url } = await api.post<{ url: string }>("/api/calendar/google/connect");
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };
  const disconnect = async () => {
    if (!confirm("Desconectar o Google Agenda? Eventos já criados continuam na sua agenda.")) return;
    setBusy("disconnect");
    try {
      mutate(await api.del<CalendarState>("/api/me/calendar/google"), { revalidate: false });
      toast.success("Google Agenda desconectado.");
    } finally {
      setBusy(null);
    }
  };
  const regen = async () => {
    if (!confirm("Gerar um novo link? Quem assinou o link atual para de receber as reuniões.")) return;
    mutate(await api.post<CalendarState>("/api/me/calendar/feed"), { revalidate: false });
    toast.success("Novo link gerado. Assine de novo na sua agenda.");
  };
  const toggleMeet = async (v: boolean) => {
    mutate({ ...data, google: { ...g, createMeet: v } }, { revalidate: false });
    mutate(await api.patch<CalendarState>("/api/me/calendar", { createMeet: v }), { revalidate: false });
  };

  return (
    <Card className="p-5 sm:p-6">
      <div id="agenda" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold">Minha agenda</h2>
          <p className="mt-1 text-[13.5px] text-muted">Suas reuniões do CRMLABS direto na sua agenda do celular e do computador.</p>
        </div>
        <Badge tone={g.connected ? "success" : "neutral"} className="self-start">
          {g.connected ? "Google Agenda conectado" : "Agenda não conectada"}
        </Badge>
      </div>

      <div className="rounded-[18px] border border-line p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-info-soft text-info" aria-hidden>
            <CalendarCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Google Agenda</p>
            {g.connected ? (
              <>
                <p className="text-[13px] text-muted">
                  {g.email} · {g.lastSyncAt ? `sincronizado ${relativeTime(g.lastSyncAt).toLowerCase()}` : "aguardando a primeira reunião"}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                  {["Reunião marcada no CRM entra na sua agenda na hora", "Remarcar ou cancelar atualiza o evento", "Ao marcar, o CRM avisa se você já tem compromisso no horário"].map((t) => (
                    <li key={t} className="flex items-center gap-1.5">
                      <CircleCheck className="size-4 text-success" aria-hidden /> {t}
                    </li>
                  ))}
                </ul>
                {g.lastError && <p className="mt-2 rounded-[12px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{g.lastError}</p>}
              </>
            ) : (
              <p className="text-[13px] text-muted">
                {g.available ? "Cria, remarca e cancela os eventos na hora e gera o link do Google Meet." : "O administrador ainda precisa ligar o Google em Integrações. Enquanto isso, use o link de assinatura abaixo."}
              </p>
            )}
          </div>
        </div>
        {g.connected ? (
          <div className="mt-3 border-t border-line pt-1">
            <Switch checked={g.createMeet} onChange={toggleMeet} label="Criar link do Google Meet" description="Quando a reunião não tiver local ou link." />
            <Button size="sm" variant="ghost" icon={<Unplug className="size-4" />} loading={busy === "disconnect"} onClick={disconnect}>
              Desconectar
            </Button>
          </div>
        ) : (
          g.available && (
            <Button className="mt-3 w-full sm:w-auto" icon={<CalendarCheck className="size-4" />} loading={busy === "connect"} onClick={connect}>
              Conectar Google Agenda
            </Button>
          )
        )}
      </div>

      <details className="mt-4 rounded-[18px] border border-line p-4" open={!g.connected}>
        <summary className="cursor-pointer text-[15px] font-semibold">
          <CalendarPlus className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />
          Link de assinatura (Google, iPhone, Outlook)
        </summary>
        <p className="mt-2 text-[13px] text-muted">Funciona em qualquer agenda, sem conectar conta. É só leitura e cada app atualiza no seu ritmo (o Google pode levar algumas horas).</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={data.googleAddUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-[12px] border border-line px-3.5 text-[13.5px] font-medium hover:bg-page">
            Adicionar ao Google Agenda
          </a>
          <a href={data.webcalUrl} className="inline-flex h-10 items-center rounded-[12px] border border-line px-3.5 text-[13.5px] font-medium hover:bg-page">
            Abrir no iPhone / Mac / Outlook
          </a>
        </div>
        <div className="mt-3">
          <Copyable label="Link pessoal (não compartilhe)" value={data.feedUrl} />
        </div>
        <button onClick={regen} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-ink">
          <RefreshCw className="size-3.5" aria-hidden /> Gerar novo link
        </button>
      </details>
    </Card>
  );
}
