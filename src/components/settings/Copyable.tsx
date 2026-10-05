"use client";

import { toast } from "sonner";
import { Copy } from "lucide-react";

/** Valor para copiar e colar em outro sistema (URLs, tokens de verificação). */
export function Copyable({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const copy = () =>
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success("Copiado."))
      .catch(() => toast.error("Não foi possível copiar. Selecione o texto e copie manualmente."));
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="flex items-center gap-1 rounded-[12px] border border-line bg-page/60 py-1 pl-3 pr-1">
        <code className="flex-1 truncate text-[12.5px] select-all">{value}</code>
        <button onClick={copy} className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-white hover:text-ink" aria-label={`Copiar ${label}`}>
          <Copy className="size-4" />
        </button>
      </div>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}
