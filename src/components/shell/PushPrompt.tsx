"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { fetcher } from "@/lib/api";
import { enablePush, isStandalone, pushSupport, registerServiceWorker } from "@/lib/push";
import { Button } from "@/components/ui";

const DISMISS_KEY = "crmlabs.push-prompt.dismissed";

/**
 * Registra o service worker e, quando o CRMLABS está instalado na tela de início
 * e as notificações ainda não foram decididas, oferece ativá-las (uma vez).
 */
export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void registerServiceWorker();
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* armazenamento indisponível */
    }
    if (!dismissed && isStandalone() && pushSupport() === "supported" && Notification.permission === "default") {
      const t = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ok */
    }
  };

  const enable = async () => {
    setBusy(true);
    try {
      const { publicKey } = await fetcher<{ publicKey: string }>("/api/me/notifications");
      await enablePush(publicKey);
      toast.success("Notificações ativadas. Escolha os tipos em Configurações → Perfil.");
      close();
    } catch (e) {
      toast.error((e as Error).message);
      close();
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;
  return (
    <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 sm:left-auto sm:right-6 sm:w-[380px]" role="dialog" aria-label="Ativar notificações">
      <div className="anim-rise flex gap-3 rounded-[20px] border border-line bg-white p-4 shadow-[var(--shadow-pop)]">
        <span className="anim-pop flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-selected text-brand" aria-hidden>
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Receber avisos no celular?</p>
          <p className="mt-0.5 text-[13px] text-muted">Vendas fechadas, reuniões agendadas e movimentos do funil.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} onClick={enable}>
              Ativar
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              Agora não
            </Button>
          </div>
        </div>
        <button onClick={close} className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page" aria-label="Fechar">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
