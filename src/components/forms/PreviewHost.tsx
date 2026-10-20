"use client";

import { useEffect, useState } from "react";
import type { PublicDefinition } from "@/lib/quiz/types";
import { QuizRunner } from "./QuizRunner";

export const PREVIEW_MESSAGE = "crmlabs-form-preview";

/** Mostra o rascunho que o editor envia (mesma origem), atualizando a cada alteração. */
export function PreviewHost({ formId, orgName }: { formId: string; orgName: string }) {
  const [def, setDef] = useState<PublicDefinition | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; formId?: string; definition?: PublicDefinition; restart?: boolean };
      if (d?.type !== PREVIEW_MESSAGE || d.formId !== formId || !d.definition) return;
      setDef(d.definition);
      if (d.restart) setKey((k) => k + 1);
    };
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: `${PREVIEW_MESSAGE}:ready`, formId }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [formId]);
  if (!def) return <div className="min-h-dvh bg-white" />;
  return (
    <div className="min-h-dvh" style={{ background: def.appearance.background }}>
      <QuizRunner key={key} definition={def} slug="previa" orgName={orgName} mode="preview" />
    </div>
  );
}
