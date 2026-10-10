"use client";

/**
 * Formulário público (e a prévia do editor). Mostra uma pergunta por tela ou uma etapa por tela,
 * valida no navegador para ajudar a pessoa, mas quem decide é o servidor: score e classificação
 * nunca passam por aqui.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, LoaderCircle, Maximize2, Pencil } from "lucide-react";
import { checkAnswer, displayValue, isEmpty, visibleQuestionIds } from "@/lib/quiz/engine";
import type { AnswerValue, Answers, Appearance, PublicDefinition, PublicQuestion } from "@/lib/quiz/types";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "ad_id", "ad_name", "adset_name", "campaign_name", "form_name", "platform"];

export const assetSrc = (id: string | null | undefined) => (id ? `/api/public/form-assets/${id}` : null);

const FONT: Record<Appearance["font"], string> = {
  poppins: "Poppins, ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', ui-serif, serif",
  rounded: "ui-rounded, 'SF Pro Rounded', Nunito, Poppins, system-ui, sans-serif",
};

/** Mistura duas cores hex (para bordas e fundos suaves derivados do tema). */
function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return a;
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function themeVars(a: Appearance): CSSProperties {
  return {
    "--q-primary": a.primary,
    "--q-secondary": a.secondary,
    "--q-bg": a.background,
    "--q-text": a.text,
    "--q-muted": mix(a.text, a.background, 0.42),
    "--q-line": mix(a.text, a.background, 0.84),
    "--q-card": mix(a.background, a.text, 0.025),
    "--q-radius": `${a.radius}px`,
    "--q-btn-radius": a.buttonStyle === "pill" ? "999px" : `${a.radius}px`,
    fontFamily: FONT[a.font],
    color: a.text,
    background: a.background,
  } as CSSProperties;
}

/** Máscara brasileira: (71) 99999-0000. Com "+" no início, aceita número internacional. */
export function maskPhone(v: string) {
  if (v.trim().startsWith("+")) return "+" + v.replace(/[^\d ]/g, "").slice(0, 20);
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

type Step = { kind: "intro" } | { kind: "questions"; sectionIndex: number; questions: PublicQuestion[] } | { kind: "review" };

type Props = {
  definition: PublicDefinition;
  slug: string;
  orgName: string;
  mode?: "live" | "preview";
  embed?: boolean;
  /** Incorporado ocupando a página inteira: layout de página, mas a resposta conta como "incorporado". */
  fullscreen?: boolean;
  publicUrl?: string;
};

function newSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export function QuizRunner({ definition: def, slug, orgName, mode = "live", embed = false, fullscreen = false, publicUrl }: Props) {
  const compact = embed && !fullscreen;
  const a = def.appearance;
  const live = mode === "live";
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [notice, setNotice] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; redirectUrl: string | null } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const startedAt = useRef<number>(Date.now());
  const session = useRef<string>("");
  const started = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => visibleQuestionIds(def, answers), [def, answers]);
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    if (def.settings.welcome || def.settings.description || a.coverAssetId) out.push({ kind: "intro" });
    def.sections.forEach((s, si) => {
      const qs = s.questions.filter((q) => visible.has(q.id));
      if (!qs.length) return;
      if (a.layout === "by_section") out.push({ kind: "questions", sectionIndex: si, questions: qs });
      else for (const q of qs) out.push({ kind: "questions", sectionIndex: si, questions: [q] });
    });
    if (a.review) out.push({ kind: "review" });
    return out;
  }, [def, visible, a.layout, a.review, a.coverAssetId]);

  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;

  // Sessão (mesmo envio repetido não duplica) e eventos de visualização.
  useEffect(() => {
    if (!live) return;
    const key = `crmlabs-form:${slug}`;
    try {
      session.current = sessionStorage.getItem(key) || newSessionId();
      sessionStorage.setItem(key, session.current);
    } catch {
      session.current = newSessionId();
    }
    void fetch(`/api/public/quiz/${slug}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.current, kind: "view", embed, utmSource: utm().utm_source }) }).catch(() => {});
  }, [live, slug, embed]);

  // Incorporado: avisa a página de fora sobre a altura (ajuste automático do iframe).
  useEffect(() => {
    if (!compact || typeof window === "undefined" || window.parent === window) return;
    // Mede o conteúdo (não o documento, que nunca fica menor que o próprio iframe) para também encolher.
    const el = rootRef.current;
    if (!el) return;
    const send = () => window.parent.postMessage({ type: "crmlabs-form:height", slug, height: Math.ceil(el.getBoundingClientRect().height) }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, slug, stepIndex, done]);

  const markStarted = useCallback(() => {
    if (!live || started.current) return;
    started.current = true;
    void fetch(`/api/public/quiz/${slug}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.current, kind: "start", embed, utmSource: utm().utm_source }) }).catch(() => {});
  }, [live, slug, embed]);

  const setValue = (id: string, v: AnswerValue) => {
    markStarted();
    setAnswers((prev) => ({ ...prev, [id]: v }));
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  };

  const go = (to: number) => {
    setDir(to < stepIndex ? "back" : "fwd");
    setStepIndex(Math.max(0, Math.min(steps.length - 1, to)));
    setFormError(null);
    if (!compact) window.scrollTo({ top: 0, behavior: a.animations ? "smooth" : "auto" });
    else rootRef.current?.scrollIntoView({ block: "start" });
  };

  const validateStep = (s: Step) => {
    if (s.kind !== "questions") return true;
    const errs: Record<string, string> = {};
    for (const q of s.questions) {
      const r = checkAnswer(q, answers[q.id]);
      if (r.error) errs[q.id] = r.error;
    }
    setErrors((e) => ({ ...e, ...errs }));
    return !Object.keys(errs).length;
  };

  const next = () => {
    if (!step) return;
    if (!validateStep(step)) return;
    if (isLast) void submit();
    else go(stepIndex + 1);
  };

  async function submit() {
    // Valida tudo antes de enviar (inclusive etapas puladas por condições).
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.kind === "questions" && !validateStep(s)) {
        go(i);
        return;
      }
    }
    if (!notice) {
      setFormError("Confirme que leu o aviso de privacidade para enviar.");
      return;
    }
    if (!live) {
      setDone({ message: def.settings.completion, redirectUrl: null });
      return;
    }
    setBusy(true);
    setFormError(null);
    const payload: Record<string, AnswerValue> = {};
    for (const id of visible) if (!isEmpty(answers[id])) payload[id] = answers[id];
    try {
      const res = await fetch(`/api/public/quiz/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.current, answers: payload, consent: { notice, marketing }, utm: utm(), referrer: document.referrer || undefined, embed, website, startedAt: startedAt.current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const fields = (data?.error?.details?.fields ?? {}) as Record<string, string>;
        setErrors(fields);
        const firstBad = steps.findIndex((s) => s.kind === "questions" && s.questions.some((q) => fields[q.id]));
        if (firstBad >= 0) go(firstBad);
        setFormError(data?.error?.message ?? "Não foi possível enviar. Tente novamente.");
        return;
      }
      try {
        sessionStorage.removeItem(`crmlabs-form:${slug}`);
      } catch {}
      setDone({ message: data.message, redirectUrl: data.redirectUrl ?? null });
      if (data.redirectUrl) {
        setTimeout(() => {
          if (embed) window.open(data.redirectUrl, "_top");
          else window.location.href = data.redirectUrl;
        }, 2600);
      }
    } catch {
      setFormError("Sem conexão. Verifique sua internet e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const questionSteps = steps.filter((s) => s.kind === "questions").length;
  const currentQ = steps.slice(0, stepIndex + 1).filter((s) => s.kind === "questions").length;
  const progress = done ? 1 : step?.kind === "review" ? 1 : questionSteps ? Math.max(0, (currentQ - (step?.kind === "questions" ? 1 : 0)) / questionSteps) : 0;
  const totalSections = def.sections.filter((s) => s.questions.some((q) => visible.has(q.id))).length;
  const nextIsNewSection = step?.kind === "questions" && steps[stepIndex + 1]?.kind === "questions" && (steps[stepIndex + 1] as { sectionIndex: number }).sectionIndex !== step.sectionIndex;
  const showConsent = isLast;

  const logo = assetSrc(a.logoAssetId);
  const cover = assetSrc(a.coverAssetId);
  const btn = (variant: "primary" | "ghost") =>
    variant === "primary"
      ? a.buttonStyle === "outline"
        ? { background: "transparent", color: "var(--q-primary)", border: "2px solid var(--q-primary)" }
        : { background: "var(--q-primary)", color: readableOn(a.primary), border: "2px solid var(--q-primary)" }
      : { background: "transparent", color: "var(--q-muted)", border: "2px solid transparent" };

  return (
    <div ref={rootRef} className={a.animations ? "quiz-anim" : undefined} style={themeVars(a)}>
      <div className={compact ? "px-4 py-5 sm:px-6" : "mx-auto flex min-h-dvh w-full max-w-[640px] flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 sm:pt-8"}>
        <header className="mb-5 flex items-center justify-between gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={orgName} className="h-9 w-auto max-w-[180px] object-contain" />
          ) : (
            <span className="text-[19px] font-bold tracking-[0.18em]" style={{ color: "var(--q-primary)" }}>
              {orgName.toUpperCase()}
            </span>
          )}
          {compact && publicUrl && (
            <a href={publicUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: "var(--q-muted)" }}>
              <Maximize2 className="size-3.5" aria-hidden /> Tela cheia
            </a>
          )}
        </header>

        {a.progressBar && !done && step?.kind !== "intro" && (
          <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--q-line)" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Progresso">
            <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(4, progress * 100)}%`, background: "var(--q-primary)" }} />
          </div>
        )}

        <main className="flex-1">
          {done ? (
            <Done message={done.message} celebrate={a.finalStyle === "celebration" && a.animations} redirecting={!!done.redirectUrl} />
          ) : step?.kind === "intro" ? (
            <div key="intro" className="quiz-step" data-dir={dir}>
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="mb-6 aspect-[16/7] w-full object-cover" style={{ borderRadius: "var(--q-radius)" }} />
              )}
              <h1 className="text-[27px] font-bold leading-tight sm:text-[34px]">{def.settings.title}</h1>
              {def.settings.description && <p className="mt-3 text-[16px] leading-relaxed sm:text-[17px]" style={{ color: "var(--q-muted)" }}>{def.settings.description}</p>}
              {def.settings.welcome && <p className="mt-5 rounded-[14px] px-4 py-3 text-[14.5px]" style={{ background: "var(--q-secondary)" }}>{def.settings.welcome}</p>}
              <div className="mt-8">
                <QButton style={btn("primary")} onClick={() => go(1)}>
                  Começar <ArrowRight className="size-5" aria-hidden />
                </QButton>
              </div>
            </div>
          ) : step?.kind === "questions" ? (
            <div key={`s${stepIndex}`} className="quiz-step" data-dir={dir}>
              {(a.layout === "by_section" || step.questions[0] === def.sections[step.sectionIndex].questions.find((q) => visible.has(q.id))) && (
                <div className="mb-5">
                  {totalSections > 1 && (
                    <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--q-primary)" }}>
                      Etapa {def.sections.slice(0, step.sectionIndex + 1).filter((s) => s.questions.some((q) => visible.has(q.id))).length} de {totalSections}
                    </p>
                  )}
                  {def.sections[step.sectionIndex].title && <h2 className="mt-1 text-[20px] font-semibold">{def.sections[step.sectionIndex].title}</h2>}
                  {def.sections[step.sectionIndex].description && <p className="mt-1 text-[14.5px]" style={{ color: "var(--q-muted)" }}>{def.sections[step.sectionIndex].description}</p>}
                </div>
              )}
              <div className="flex flex-col gap-8">
                {step.questions.map((q) => (
                  <QuestionField
                    key={q.id}
                    q={q}
                    value={answers[q.id]}
                    error={errors[q.id]}
                    big={a.layout === "one_per_screen"}
                    onPrimary={readableOn(a.primary)}
                    onChange={(v) => setValue(q.id, v)}
                    onEnter={next}
                    onAutoAdvance={() => {
                      if (a.layout === "one_per_screen" && !isLast) setTimeout(() => go(stepIndex + 1), 260);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : step?.kind === "review" ? (
            <div key="review" className="quiz-step" data-dir={dir}>
              <h2 className="text-[24px] font-bold">Revise suas respostas</h2>
              <p className="mt-1 text-[14.5px]" style={{ color: "var(--q-muted)" }}>Confira antes de enviar. Toque em uma resposta para corrigir.</p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {def.sections.flatMap((s) => s.questions.filter((q) => visible.has(q.id))).map((q) => {
                  const target = steps.findIndex((st) => st.kind === "questions" && st.questions.some((x) => x.id === q.id));
                  return (
                    <li key={q.id}>
                      <button type="button" onClick={() => go(target)} className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors" style={{ border: "1px solid var(--q-line)", borderRadius: "var(--q-radius)", background: "var(--q-card)" }}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px]" style={{ color: "var(--q-muted)" }}>{q.title}</span>
                          <span className="mt-0.5 block break-words text-[15px] font-medium">{displayValue(q as never, answers[q.id]) || <em className="font-normal" style={{ color: "var(--q-muted)" }}>Sem resposta</em>}</span>
                        </span>
                        <Pencil className="mt-1 size-4 shrink-0 opacity-50 group-hover:opacity-100" aria-label="Editar" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {!done && step && step.kind !== "intro" && (
            <div className="mt-8">
              {showConsent && (
                <div className="mb-5 flex flex-col gap-3 text-[13.5px] leading-snug">
                  <Tick checked={notice} onChange={setNotice} id="q-notice">
                    {def.settings.consent.noticeText}{" "}
                    <a href={def.settings.consent.policyUrl || `/privacidade?form=${slug}#formularios`} target="_blank" rel="noopener" className="underline" style={{ color: "var(--q-primary)" }}>
                      Política de privacidade
                    </a>
                  </Tick>
                  {def.settings.consent.marketingEnabled && (
                    <Tick checked={marketing} onChange={setMarketing} id="q-marketing">
                      {def.settings.consent.marketingText}
                    </Tick>
                  )}
                </div>
              )}
              {/* Campo invisível contra robôs */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />
              {formError && (
                <p role="alert" className="mb-4 flex items-center gap-2 rounded-[12px] px-3.5 py-2.5 text-[14px]" style={{ background: "#fbe9eb", color: "#a32a38" }}>
                  <CircleAlert className="size-4 shrink-0" aria-hidden /> {formError}
                </p>
              )}
              <div className="flex items-center gap-3">
                {stepIndex > 0 && steps[stepIndex - 1]?.kind !== undefined && (
                  <QButton style={btn("ghost")} onClick={() => go(stepIndex - 1)} aria-label="Voltar">
                    <ArrowLeft className="size-5" aria-hidden /> <span className="max-sm:sr-only">Voltar</span>
                  </QButton>
                )}
                <QButton style={btn("primary")} onClick={next} disabled={busy} className="flex-1 sm:flex-none">
                  {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
                  {isLast ? (busy ? "Enviando…" : "Enviar respostas") : nextIsNewSection ? "Continuar" : "Próximo"}
                  {!busy && !isLast && <ArrowRight className="size-5" aria-hidden />}
                </QButton>
              </div>
              {a.layout === "one_per_screen" && step.kind === "questions" && !isLast && <p className="mt-3 hidden text-[12px] sm:block" style={{ color: "var(--q-muted)" }}>Pressione Enter ↵ para avançar</p>}
            </div>
          )}
        </main>

        {!compact && (
          <footer className="mt-10 text-center text-[12px]" style={{ color: "var(--q-muted)" }}>
            Seus dados são tratados conforme a LGPD.{" "}
            <a href={def.settings.consent.policyUrl || `/privacidade?form=${slug}#formularios`} target="_blank" rel="noopener" className="underline">
              Privacidade
            </a>
          </footer>
        )}
      </div>
    </div>
  );
}

function utm() {
  if (typeof window === "undefined") return {} as Record<string, string>;
  const sp = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = sp.get(k);
    if (v) out[k] = v.slice(0, 300);
  }
  return out;
}

/** Texto branco ou escuro, o que tiver mais contraste com a cor do botão. */
function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.45 ? "#10201a" : "#ffffff";
}

function QButton({ children, style, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { style: CSSProperties }) {
  return (
    <button
      type="button"
      className={`inline-flex h-[52px] items-center justify-center gap-2 px-6 text-[16px] font-semibold transition-[transform,filter,opacity] hover:brightness-[1.04] active:scale-[0.98] disabled:opacity-60 ${className ?? ""}`}
      style={{ borderRadius: "var(--q-btn-radius)", ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

function Tick({ checked, onChange, id, children }: { checked: boolean; onChange: (v: boolean) => void; id: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 shrink-0 cursor-pointer" style={{ accentColor: "var(--q-primary)" }} />
      <span>{children}</span>
    </label>
  );
}

function QuestionField({ q, value, error, big, onPrimary, onChange, onEnter, onAutoAdvance }: { q: PublicQuestion; value: AnswerValue | undefined; error?: string; big: boolean; onPrimary: string; onChange: (v: AnswerValue) => void; onEnter: () => void; onAutoAdvance: () => void }) {
  const inputId = `q-${q.id}`;
  const img = assetSrc(q.imageAssetId);
  const field = {
    border: `1.5px solid ${error ? "#c93646" : "var(--q-line)"}`,
    borderRadius: "var(--q-radius)",
    background: "var(--q-card)",
    color: "var(--q-text)",
  } as CSSProperties;
  const inputCls = "w-full px-4 text-[16px] outline-none transition-shadow focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--q-primary)_18%,transparent)] placeholder:opacity-50";
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      onEnter();
    }
  };
  const text = typeof value === "string" ? value : "";
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

  let control: ReactNode;
  switch (q.type) {
    case "short_text":
    case "email":
    case "url":
    case "phone":
      control = (
        <input
          id={inputId}
          type={q.type === "email" ? "email" : q.type === "phone" ? "tel" : "text"}
          inputMode={q.type === "phone" ? "tel" : q.type === "email" ? "email" : undefined}
          autoComplete={q.identity === "name" ? "name" : q.type === "email" ? "email" : q.type === "phone" ? "tel" : q.identity === "company" ? "organization" : "off"}
          autoCapitalize={q.type === "email" || q.type === "url" ? "none" : undefined}
          value={text}
          placeholder={q.placeholder ?? (q.type === "phone" ? "(71) 99999-0000" : q.type === "url" ? "@seuperfil" : "")}
          onChange={(e) => onChange(q.type === "phone" ? maskPhone(e.target.value) : e.target.value)}
          onKeyDown={onKey}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${inputId}-err` : undefined}
          className={`${inputCls} h-14`}
          style={field}
          maxLength={q.type === "url" ? 300 : 200}
        />
      );
      break;
    case "long_text":
      control = <textarea id={inputId} value={text} placeholder={q.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} rows={4} className={`${inputCls} py-3`} style={field} maxLength={3000} aria-invalid={!!error || undefined} />;
      break;
    case "date":
      control = <input id={inputId} type="date" value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} className={`${inputCls} h-14`} style={field} aria-invalid={!!error || undefined} />;
      break;
    case "dropdown":
      control = (
        <select id={inputId} value={text} onChange={(e) => onChange(e.target.value || null)} className={`${inputCls} h-14 appearance-none`} style={field} aria-invalid={!!error || undefined}>
          <option value="">Selecione…</option>
          {q.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "single_choice":
    case "yes_no":
    case "multi_choice": {
      const multi = q.type === "multi_choice";
      control = (
        <div role={multi ? "group" : "radiogroup"} aria-labelledby={`${inputId}-label`} className={q.type === "yes_no" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-2.5"}>
          {q.options?.map((o, i) => {
            const on = list.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => {
                  if (multi) onChange(on ? list.filter((x) => x !== o.id) : [...list, o.id]);
                  else {
                    onChange(o.id);
                    onAutoAdvance();
                  }
                }}
                className="quiz-option flex min-h-[56px] items-center gap-3 px-4 py-3 text-left text-[15.5px] transition-[background,border-color,transform] active:scale-[0.99]"
                style={{
                  "--i": i,
                  border: `1.5px solid ${on ? "var(--q-primary)" : error ? "#e7a9b1" : "var(--q-line)"}`,
                  borderRadius: "var(--q-radius)",
                  background: on ? "var(--q-secondary)" : "var(--q-card)",
                  fontWeight: on ? 600 : 500,
                } as CSSProperties}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center text-[12px] font-bold"
                  style={{ borderRadius: multi ? 7 : 999, border: `2px solid ${on ? "var(--q-primary)" : "var(--q-line)"}`, background: on ? "var(--q-primary)" : "transparent", color: on ? onPrimary : "var(--q-muted)" }}
                  aria-hidden
                >
                  {on ? <Check className="size-3.5" strokeWidth={3} /> : !multi && q.type !== "yes_no" ? String.fromCharCode(65 + i) : null}
                </span>
                <span className="flex-1">{o.label}</span>
              </button>
            );
          })}
          {multi && <p className="text-[12.5px]" style={{ color: "var(--q-muted)" }}>Escolha quantas quiser.</p>}
        </div>
      );
      break;
    }
    case "scale": {
      const min = q.scale?.min ?? 0;
      const max = q.scale?.max ?? 10;
      const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      control = (
        <div>
          <div role="radiogroup" aria-labelledby={`${inputId}-label`} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(nums.length, 11)}, minmax(0,1fr))` }}>
            {nums.map((n) => {
              const on = value === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    onChange(n);
                    onAutoAdvance();
                  }}
                  className="h-12 text-[15px] font-semibold transition-colors"
                  style={{ borderRadius: "calc(var(--q-radius) * 0.6)", border: `1.5px solid ${on ? "var(--q-primary)" : "var(--q-line)"}`, background: on ? "var(--q-primary)" : "var(--q-card)", color: on ? onPrimary : "var(--q-text)" }}
                >
                  {n}
                </button>
              );
            })}
          </div>
          {(q.scale?.minLabel || q.scale?.maxLabel) && (
            <div className="mt-2 flex justify-between text-[12.5px]" style={{ color: "var(--q-muted)" }}>
              <span>{q.scale?.minLabel}</span>
              <span>{q.scale?.maxLabel}</span>
            </div>
          )}
        </div>
      );
      break;
    }
    case "consent":
      control = (
        <Tick checked={value === true} onChange={(v) => onChange(v)} id={inputId}>
          {q.description || "Concordo"}
        </Tick>
      );
      break;
  }

  return (
    <fieldset className="min-w-0">
      <legend id={`${inputId}-label`} className="mb-1 w-full">
        <label htmlFor={["single_choice", "multi_choice", "yes_no", "scale"].includes(q.type) ? undefined : inputId} className={big ? "block text-[22px] font-semibold leading-snug sm:text-[26px]" : "block text-[17px] font-semibold leading-snug"}>
          {q.title}
          {q.required && <span style={{ color: "var(--q-primary)" }}> *</span>}
        </label>
      </legend>
      {q.description && q.type !== "consent" && <p className="mb-3 text-[14.5px]" style={{ color: "var(--q-muted)" }}>{q.description}</p>}
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="mb-4 max-h-[280px] w-full object-cover" style={{ borderRadius: "var(--q-radius)" }} />
      )}
      <div className={big ? "mt-4" : "mt-2"}>{control}</div>
      {error && (
        <p id={`${inputId}-err`} role="alert" className="mt-2 flex items-center gap-1.5 text-[13.5px]" style={{ color: "#c93646" }}>
          <CircleAlert className="size-4" aria-hidden /> {error}
        </p>
      )}
    </fieldset>
  );
}

function Done({ message, celebrate, redirecting }: { message: string; celebrate: boolean; redirecting: boolean }) {
  return (
    <div className="quiz-step relative flex flex-col items-center py-10 text-center">
      {celebrate && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-16">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="quiz-confetti absolute block size-2.5 rounded-[3px]"
              style={{ "--i": i, "--dx": `${Math.cos((i / 14) * Math.PI * 2) * 110}px`, "--dy": `${Math.sin((i / 14) * Math.PI * 2) * 90 - 40}px`, background: i % 3 ? "var(--q-primary)" : "var(--q-secondary)" } as CSSProperties}
            />
          ))}
        </div>
      )}
      <div className="anim-pop flex size-20 items-center justify-center rounded-full" style={{ background: "var(--q-secondary)", color: "var(--q-primary)" }}>
        <Check className="size-10" strokeWidth={2.6} aria-hidden />
      </div>
      <h2 className="mt-6 text-[26px] font-bold">Respostas enviadas!</h2>
      <p className="mt-3 max-w-[460px] text-[16px] leading-relaxed" style={{ color: "var(--q-muted)" }}>
        {message}
      </p>
      {redirecting && <p className="mt-6 text-[13px]" style={{ color: "var(--q-muted)" }}>Redirecionando…</p>}
    </div>
  );
}
