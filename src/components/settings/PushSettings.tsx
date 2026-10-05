"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { BellRing, BellOff, Send, Share, SquarePlus, Smartphone } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { NOTIFY_PREFS, type NotifyPrefKey } from "@/lib/notificationTypes";
import { currentSubscription, disablePush, enablePush, isIOS, pushSupport, type PushSupport } from "@/lib/push";
import { Badge, Button, Card, LoadingState, Switch } from "@/components/ui";

type Prefs = { prefs: Record<NotifyPrefKey, boolean>; devices: number; publicKey: string };

export function PushSettings() {
  const { data, mutate } = useSWR<Prefs>("/api/me/notifications", fetcher);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const s = pushSupport();
    setSupport(s);
    if (s === "supported") {
      setPermission(Notification.permission);
      currentSubscription()
        .then((sub) => setSubscribed(!!sub && Notification.permission === "granted"))
        .catch(() => setSubscribed(false));
    }
  }, []);

  if (!data || !support) return <LoadingState rows={3} />;

  const enable = async () => {
    setBusy("enable");
    try {
      await enablePush(data.publicKey);
      setSubscribed(true);
      setPermission("granted");
      await mutate();
      toast.success("Notificações ativadas neste aparelho.");
    } catch (e) {
      setPermission(typeof Notification !== "undefined" ? Notification.permission : null);
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const disable = async () => {
    setBusy("disable");
    try {
      await disablePush();
      setSubscribed(false);
      await mutate();
      toast.success("Este aparelho não vai mais receber notificações.");
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    try {
      await api.post("/api/push/test");
      toast.success("Enviada! Ela deve aparecer em alguns segundos.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const toggle = async (key: NotifyPrefKey, value: boolean) => {
    mutate({ ...data, prefs: { ...data.prefs, [key]: value } }, { revalidate: false });
    try {
      mutate(await api.put<Prefs>("/api/me/notifications", { [key]: value }), { revalidate: false });
    } catch (e) {
      toast.error((e as Error).message);
      mutate();
    }
  };

  const available = NOTIFY_PREFS.filter((p) => p.key in data.prefs);

  return (
    <Card className="p-5 sm:p-6" as="section">
      <div id="notificacoes" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold">Notificações no celular</h2>
          <p className="mt-1 text-[13.5px] text-muted">Avisos na tela do aparelho, mesmo com o CRMLABS fechado.</p>
        </div>
        <Badge tone={subscribed ? "success" : "neutral"} className="self-start">
          {subscribed ? "Ativas neste aparelho" : data.devices ? `Ativas em ${data.devices} aparelho(s)` : "Desativadas"}
        </Badge>
      </div>

      {support === "ios-install" ? (
        <div className="rounded-[16px] border border-[#c9ebdc] bg-selected p-4 text-[13.5px] text-brand-dark">
          <p className="font-semibold">No iPhone, instale o CRMLABS primeiro:</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            <li className="flex items-center gap-2">
              1. Toque em <Share className="inline size-4" aria-label="Compartilhar" /> <b>Compartilhar</b> no Safari
            </li>
            <li className="flex items-center gap-2">
              2. Escolha <SquarePlus className="inline size-4" aria-hidden /> <b>Adicionar à Tela de Início</b>
            </li>
            <li>3. Abra o CRMLABS pelo ícone novo e volte aqui para ativar.</li>
          </ol>
        </div>
      ) : support === "unsupported" ? (
        <p className="rounded-[14px] bg-page/70 px-4 py-3 text-[13.5px] text-muted">Este navegador não aceita notificações. No Android use o Chrome; no iPhone, o Safari com o app na Tela de Início (iOS 16.4 ou mais novo).</p>
      ) : permission === "denied" ? (
        <p className="rounded-[14px] bg-warning-soft px-4 py-3 text-[13.5px] text-[#6b4a00]">
          As notificações foram bloqueadas para o CRMLABS. Libere nos ajustes do aparelho ({isIOS() ? "Ajustes → Notificações → CRMLABS" : "toque no cadeado ao lado do endereço → Notificações"}) e volte aqui.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-[16px] border border-line p-4 sm:flex-row sm:items-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-selected text-brand" aria-hidden>
            <Smartphone className="size-5" />
          </span>
          <p className="flex-1 text-[13.5px] text-muted">{subscribed ? "Este aparelho está recebendo as notificações escolhidas abaixo." : "Ative para receber avisos neste aparelho."}</p>
          <div className="flex flex-wrap gap-2">
            {subscribed ? (
              <>
                <Button variant="secondary" size="sm" icon={<Send className="size-4" />} loading={busy === "test"} onClick={test}>
                  Testar
                </Button>
                <Button variant="ghost" size="sm" icon={<BellOff className="size-4" />} loading={busy === "disable"} onClick={disable}>
                  Desativar
                </Button>
              </>
            ) : (
              <Button icon={<BellRing className="size-4" />} loading={busy === "enable"} onClick={enable} className="w-full sm:w-auto">
                Ativar notificações
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col divide-y divide-line">
        {available.map((p) => (
          <div key={p.key}>
            <Switch checked={data.prefs[p.key]} onChange={(v) => toggle(p.key, v)} label={p.label} description={p.description} />
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-muted">As mesmas notificações aparecem no sino do CRMLABS. Desligar um tipo aqui só para o aviso no celular.</p>
    </Card>
  );
}
