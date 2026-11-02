"use client";

import { MessageCircle } from "lucide-react";
import { useMe } from "@/lib/me";
import { formatPhone, whatsappLink } from "@/lib/format";
import { cx } from "./index";

/** Saudação curta padrão (mesma ideia do LeadSheet): "Olá, Ana! Aqui é Marvin, da AXION." */
export function useWhatsAppGreeting(name: string | null | undefined) {
  const me = useMe();
  const first = (name ?? "").trim().split(/\s+/)[0];
  const mine = me.user.name.trim().split(/\s+/)[0];
  return `Olá${first ? `, ${first}` : ""}! Aqui é ${mine}, da ${me.org.name}.`;
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
  /** Mensagem pronta. Sem ela, usa a saudação curta padrão. */
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
        onClick={(e) => {
          stop(e);
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
      onClick={(e) => {
        stop(e);
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
      onClick={stop}
      onKeyDown={stop}
      onPointerDown={stop}
      title="Abrir conversa no WhatsApp"
      className={cx("inline-flex items-center gap-1 font-medium text-[#0f7a4f] underline-offset-2 hover:underline", className)}
    >
      {formatPhone(phone)}
    </a>
  );
}
