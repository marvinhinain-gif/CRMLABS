"use client";

import { MessageCircle } from "lucide-react";
import { formatPhone, whatsappLink, whatsappOpener } from "@/lib/format";
import { cx } from "./index";

/** Mensagem padrão: "Boa tarde Ana, tá por aí?👀" (saudação pelo horário de Salvador). */
export function useWhatsAppGreeting(name: string | null | undefined) {
  return whatsappOpener(name);
}

/** Recalcula a saudação na hora do clique (a página pode ficar aberta de manhã até a tarde). */
function refreshHref(e: React.SyntheticEvent<HTMLAnchorElement>, phone: string | null | undefined, name: string | null | undefined) {
  const href = whatsappLink(phone, whatsappOpener(name));
  if (href) e.currentTarget.href = href;
}

/** Impede que o clique no link abra a linha/cartão onde ele está. */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Botão verde "WhatsApp" que abre a conversa (wa.me) em nova aba.
 * `variant="icon"` vira um botão redondo só com ícone (para linhas de lista).
 * Não renderiza nada quando o telefone não é válido.
 */
export function WhatsAppButton({
  phone,
  name,
  text,
  variant = "full",
  label = "WhatsApp",
  className,
  onOpened,
}: {
  phone: string | null | undefined;
  name?: string | null;
  /** Mensagem pronta. Sem ela, usa a mensagem padrão ("Boa tarde Ana, tá por aí?👀"). */
  text?: string;
  variant?: "full" | "icon";
  label?: string;
  className?: string;
  onOpened?: () => void;
}) {
  const greeting = useWhatsAppGreeting(name);
  const href = whatsappLink(phone, text ?? greeting);
  if (!href) return null;
  const a11y = `Abrir conversa no WhatsApp${name ? ` com ${name}` : ""}`;
  if (variant === "icon") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={a11y}
        title={a11y}
        data-no-open
        suppressHydrationWarning
        onClick={(e) => {
          stop(e);
          if (text === undefined) refreshHref(e, phone, name);
          onOpened?.();
        }}
        onKeyDown={stop}
        onPointerDown={stop}
        className={cx(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[#bfe8d3] bg-[#e9f9f1] text-[#0f7a4f] transition-colors hover:bg-[#d8f3e6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f7a4f]/20",
          className,
        )}
      >
        <MessageCircle className="size-5 shrink-0" aria-hidden />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={a11y}
      data-no-open
      suppressHydrationWarning
      onClick={(e) => {
        stop(e);
        if (text === undefined) refreshHref(e, phone, name);
        onOpened?.();
      }}
      onKeyDown={stop}
      onPointerDown={stop}
      className={cx(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[12px] bg-[#16a34a] px-3.5 text-[14px] font-semibold text-white transition-colors whitespace-nowrap hover:bg-[#15803d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#16a34a]/25",
        className,
      )}
    >
      <MessageCircle className="size-[18px] shrink-0" aria-hidden />
      {label}
    </a>
  );
}

/** Telefone formatado que, ao clicar, abre a conversa no WhatsApp. Sem telefone válido, mostra só o texto. */
export function PhoneWhatsAppLink({ phone, name, className }: { phone: string | null | undefined; name?: string | null; className?: string }) {
  const greeting = useWhatsAppGreeting(name);
  const href = whatsappLink(phone, greeting);
  if (!phone) return null;
  if (!href) return <span className={className}>{formatPhone(phone)}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-no-open
      suppressHydrationWarning
      onClick={(e) => {
        stop(e);
        refreshHref(e, phone, name);
      }}
      onKeyDown={stop}
      onPointerDown={stop}
      title="Abrir conversa no WhatsApp"
      className={cx("inline-flex items-center gap-1 font-medium text-[#0f7a4f] underline-offset-2 hover:underline", className)}
    >
      {formatPhone(phone)}
    </a>
  );
}
