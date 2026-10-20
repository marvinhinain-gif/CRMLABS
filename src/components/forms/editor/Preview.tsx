"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, RotateCcw, Smartphone } from "lucide-react";
import { publicDefinition } from "@/lib/quiz/engine";
import type { QuizDefinition } from "@/lib/quiz/types";
import { cx, IconButton } from "@/components/ui";
import { PREVIEW_MESSAGE } from "../PreviewHost";

const DEVICES = {
  desktop: { width: 1280, height: 860, label: "Computador" },
  mobile: { width: 390, height: 780, label: "Celular" },
} as const;

/**
 * Prévia ao vivo do rascunho num iframe do próprio CRM, na largura real do aparelho
 * (as regras de layout do celular valem de verdade) e reduzida para caber no painel.
 */
export function Preview({ formId, draft, className }: { formId: string; draft: QuizDefinition; className?: string }) {
  const [device, setDevice] = useState<keyof typeof DEVICES>("mobile");
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(360);
  const ready = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;

  const send = (restart = false) => {
    const w = frame.current?.contentWindow;
    if (!w || !ready.current) return;
    w.postMessage({ type: PREVIEW_MESSAGE, formId, definition: publicDefinition(latest.current), restart }, window.location.origin);
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: string })?.type === `${PREVIEW_MESSAGE}:ready`) {
        ready.current = true;
        send();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  useEffect(() => {
    const t = setTimeout(() => send(), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    setBoxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const d = DEVICES[device];
  const scale = Math.min(1, boxWidth / d.width);
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold">Prévia</span>
        <div className="flex items-center gap-1">
          <div className="inline-flex rounded-[12px] border border-line bg-white p-0.5" role="group" aria-label="Aparelho">
            {(Object.keys(DEVICES) as (keyof typeof DEVICES)[]).map((k) => {
              const Icon = k === "desktop" ? Monitor : Smartphone;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={device === k}
                  onClick={() => setDevice(k)}
                  className={cx("inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium", device === k ? "bg-selected text-brand" : "text-muted hover:text-ink")}
                >
                  <Icon className="size-4" aria-hidden />
                  {DEVICES[k].label}
                </button>
              );
            })}
          </div>
          <IconButton size="sm" label="Recomeçar a prévia" onClick={() => send(true)}>
            <RotateCcw className="size-4" />
          </IconButton>
        </div>
      </div>
      <div ref={box} className="w-full">
        <div
          className={cx("mx-auto overflow-hidden border border-line bg-white shadow-[var(--shadow-soft)]", device === "mobile" ? "rounded-[28px]" : "rounded-[16px]")}
          style={{ width: d.width * scale, height: d.height * scale }}
        >
          <iframe
            ref={frame}
            title="Prévia do formulário"
            src={`/previa-formulario/${formId}`}
            onLoad={() => send()}
            style={{ width: d.width, height: d.height, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }}
          />
        </div>
      </div>
      <p className="text-center text-[12px] text-muted">A prévia não envia respostas nem cria leads.</p>
    </div>
  );
}
