"use client";

/**
 * Formulário público (e a prévia do editor). Mostra uma pergunta por tela ou uma etapa por tela,
 * valida no navegador para ajudar a pessoa, mas quem decide é o servidor: score e classificação
 * nunca passam por aqui.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, LoaderCircle, Maximize2, Pencil } from "lucide-react";
import { checkAnswer, displayValue, isEmpty, visibleQuestionIds } from "@/lib/quiz/engine";
import { IG_PARAM } from "@/lib/quiz/instagramLink";
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
  // No modo cartão, as cores derivadas partem da cor do cartão, não do fundo da página.
  const base = a.frame === "card" ? (a.surface ?? a.background) : a.background;
  return {
    "--q-primary": a.primary,
    // Texto pequeno na cor principal: no cartão claro, um tom mais escuro para ter contraste.
    "--q-accent": a.frame === "card" ? mix(a.primary, a.text, 0.38) : a.primary,
    "--q-secondary": a.secondary,
    "--q-bg": a.background,
    "--q-surface": base,
    "--q-text": a.text,
    "--q-muted": mix(a.text, base, 0.42),
    "--q-line": mix(a.text, base, 0.86),
    "--q-card": a.frame === "card" ? base : mix(a.background, a.text, 0.025),
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

/** Respostas em andamento (atualizar a página ou voltar no navegador não perde nada). */
const stateKey = (slug: string) => `crmlabs-form-state:${slug}`;
type SavedState = { answers: Answers; stepIndex: number; notice: boolean; marketing: boolean; at: number };

function loadState(slug: string): SavedState | null {
  try {
    const raw = sessionStorage.getItem(stateKey(slug));
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedState;
    // Depois de algumas horas, recomeça do zero.
    if (!s || typeof s !== "object" || Date.now() - (s.at ?? 0) > 6 * 3600_000) return null;
    return s;
  } catch {
    return null;
  }
}

export function QuizRunner({ definition: def, slug, orgName, mode = "live", embed = false, fullscreen = false, publicUrl }: Props) {
  const compact = embed && !fullscreen;
  const a = def.appearance;
  const live = mode === "live";
  const labels = def.settings.labels ?? {};
  const counter = a.counter ?? "section";
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
  const restored = useRef(false);
  const stepIndexRef = useRef(0);
  useEffect(() => {
    stepIndexRef.current = stepIndex;
    if (live && !compact && restored.current) window.history.replaceState({ ...(window.history.state ?? {}), quizStep: stepIndex }, "");
  }, [stepIndex, live, compact]);

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
    void fetch(`/api/public/quiz/${slug}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.current, kind: "view", embed, utmSource: utm().utm_source, origem: origem(), ig: ig(), referrer: document.referrer.slice(0, 500) || undefined }) }).catch(() => {});
    // Retoma de onde parou (atualizou a página, voltou de outra aba).
    const saved = loadState(slug);
    if (saved) {
      setAnswers(saved.answers ?? {});
      setStepIndex(Math.max(0, saved.stepIndex ?? 0));
      setNotice(!!saved.notice);
      setMarketing(!!saved.marketing);
      started.current = true;
    }
    restored.current = true;
  }, [live, slug, embed]);

  useEffect(() => {
    if (!live || !restored.current || done) return;
    try {
      sessionStorage.setItem(stateKey(slug), JSON.stringify({ answers, stepIndex, notice, marketing, at: Date.now() } satisfies SavedState));
    } catch {}
  }, [live, slug, answers, stepIndex, notice, marketing, done]);

  // Botões voltar/avançar do navegador navegam entre as perguntas (fora de iframes).
  useEffect(() => {
    if (!live || compact) return;
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { quizStep?: number } | null)?.quizStep;
      if (typeof s === "number") {
        setDir(s < stepIndexRef.current ? "back" : "fwd");
        setStepIndex(s);
      }
    };
    window.history.replaceState({ ...(window.history.state ?? {}), quizStep: stepIndexRef.current }, "");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [live, compact]);

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
    void fetch(`/api/public/quiz/${slug}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.current, kind: "start", embed, utmSource: utm().utm_source, origem: origem(), ig: ig(), referrer: document.referrer.slice(0, 500) || undefined }) }).catch(() => {});
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
    const target = Math.max(0, Math.min(steps.length - 1, to));
    setDir(target < stepIndex ? "back" : "fwd");
    setStepIndex(target);
    setFormError(null);
    if (live && !compact && target !== stepIndex) {
      // Avançar cria uma entrada no histórico; voltar pelo botão do quiz volta junto.
      if (target > stepIndex) window.history.pushState({ ...(window.history.state ?? {}), quizStep: target }, "");
      else window.history.replaceState({ ...(window.history.state ?? {}), quizStep: target }, "");
    }
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!compact) window.scrollTo({ top: 0, behavior: a.animations && !reduce ? "smooth" : "auto" });
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
        body: JSON.stringify({ sessionId: session.current, answers: payload, consent: { notice, marketing }, utm: utm(), origem: origem(), ig: ig(), referrer: document.referrer.slice(0, 500) || undefined, embed, website, startedAt: startedAt.current }),
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
        sessionStorage.removeItem(stateKey(slug));
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
  const visibleList = def.sections.flatMap((s) => s.questions.filter((q) => visible.has(q.id)));
  const questionNumber = step?.kind === "questions" ? visibleList.findIndex((q) => q.id === step.questions[0].id) + 1 : 0;
  const nextLabel = labels.next || (nextIsNewSection ? "Continuar" : "Próximo");
  const submitLabel = labels.submit || "Enviar respostas";

  const logo = assetSrc(a.logoAssetId);
  const cover = assetSrc(a.coverAssetId);
  const card = a.frame === "card";
  const brand = (size: "lg" | "sm") => <Brand orgName={orgName} logo={logo} size={size} />;
  const introMeta = def.settings.welcome || `${visibleList.length} pergunta${visibleList.length === 1 ? "" : "s"} · leva poucos minutos`;
  const btn = (variant: "primary" | "ghost"): CSSProperties =>
    variant === "primary"
      ? a.buttonStyle === "outline"
        ? card
          ? { background: "var(--q-surface)", color: "var(--q-text)", border: "3px solid color-mix(in srgb, var(--q-primary) 62%, var(--q-surface))", boxShadow: "0 10px 26px -12px color-mix(in srgb, var(--q-primary) 70%, transparent)", fontWeight: 500 }
          : { background: "transparent", color: "var(--q-text)", border: "2px solid var(--q-primary)" }
        : { background: "var(--q-primary)", color: readableOn(a.primary), border: "2px solid var(--q-primary)" }
      : { background: "transparent", color: "var(--q-muted)", border: "2px solid transparent" };

  const footer = compact ? null : (
    <footer className={card ? "mt-6 text-center text-[12px]" : "mt-10 text-center text-[12px]"} style={{ color: card ? mix(a.text, a.background, 0.45) : "var(--q-muted)" }}>
      Seus dados são tratados conforme a LGPD.{" "}
      <a href={def.settings.consent.policyUrl || `/privacidade?form=${slug}#formularios`} target="_blank" rel="noopener" className="underline">
        Privacidade
      </a>
    </footer>
  );

  return (
    <div ref={rootRef} className={a.animations ? "quiz-anim" : undefined} style={themeVars(a)}>
      <Page card={card} compact={compact}>
        <Shell card={card} below={footer}>
          <header className={card && (done || step?.kind === "intro") ? "mb-6 flex flex-col items-center gap-3 sm:mb-8" : "mb-5 flex items-center justify-between gap-3"}>
            {card ? (
              brand(done || step?.kind === "intro" ? "lg" : "sm")
            ) : logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={orgName} className="h-9 w-auto max-w-[180px] object-contain" />
            ) : (
              <span className="text-[19px] font-bold tracking-[0.18em]" style={{ color: "var(--q-primary)" }}>
                {orgName.toUpperCase()}
              </span>
            )}
            {compact && publicUrl && (
              <a href={publicUrl} target="_blank" rel="noopener" className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium ${card ? "absolute right-5 top-5 sm:right-6 sm:top-6" : ""}`} style={{ color: "var(--q-muted)" }}>
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
              <Done title={labels.doneTitle || "Respostas enviadas!"} message={done.message} celebrate={a.finalStyle === "celebration" && a.animations} tight={card} redirecting={!!done.redirectUrl} />
            ) : step?.kind === "intro" && card ? (
              <div key="intro" className="quiz-step flex flex-col items-center text-center" data-dir={dir}>
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="mb-6 aspect-[16/7] w-full object-cover" style={{ borderRadius: "var(--q-radius)" }} />
                )}
                <h1 className="text-[30px] font-bold leading-[1.12] tracking-[-0.02em] sm:text-[44px]">{def.settings.title}</h1>
                {def.settings.description && <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed sm:text-[18px]" style={{ color: "color-mix(in srgb, var(--q-text) 78%, var(--q-surface))" }}>{def.settings.description}</p>}
                <QButton style={btn("primary")} onClick={() => go(1)} className="mt-8 h-[60px] min-w-[220px] px-9 text-[17px]">
                  {labels.start || "Começar"} <ArrowRight className="size-5" aria-hidden />
                </QButton>
                <p className="mt-4 text-[14px]" style={{ color: "var(--q-muted)" }}>{introMeta}</p>
              </div>
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
                    {labels.start || "Começar"} <ArrowRight className="size-5" aria-hidden />
                  </QButton>
                </div>
              </div>
            ) : step?.kind === "questions" ? (
              <div key={`s${stepIndex}`} className="quiz-step" data-dir={dir}>
                {counter === "question" && a.layout === "one_per_screen" && questionNumber > 0 && (
                  <p className="mb-4 text-[12.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--q-accent)" }} aria-live="polite">
                    Pergunta {questionNumber} de {visibleList.length}
                  </p>
                )}
                {counter !== "question" && (a.layout === "by_section" || step.questions[0] === def.sections[step.sectionIndex].questions.find((q) => visible.has(q.id))) && (
                  <div className="mb-5">
                    {totalSections > 1 && counter === "section" && (
                      <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--q-accent)" }}>
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
                      <a href={def.settings.consent.policyUrl || `/privacidade?form=${slug}#formularios`} target="_blank" rel="noopener" className="underline" style={{ color: "var(--q-accent)" }}>
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
                    <QButton style={btn("ghost")} onClick={() => go(stepIndex - 1)} aria-label={labels.back || "Voltar"}>
                      <ArrowLeft className="size-5" aria-hidden /> <span className="max-sm:sr-only">{labels.back || "Voltar"}</span>
                    </QButton>
                  )}
                  <QButton style={btn("primary")} onClick={next} disabled={busy} className="flex-1 sm:flex-none">
                    {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
                    {isLast ? (busy ? "Enviando…" : submitLabel) : nextLabel}
                    {!busy && !isLast && <ArrowRight className="size-5" aria-hidden />}
                  </QButton>
                </div>
                {a.layout === "one_per_screen" && step.kind === "questions" && !isLast && <p className="mt-3 hidden text-[12px] sm:block" style={{ color: "var(--q-muted)" }}>Pressione Enter ↵ para avançar</p>}
              </div>
            )}
          </main>
        </Shell>
        {!card && footer}

      </Page>
    </div>
  );
}

/** Link de origem (?origem=stories), cadastrado em Publicação. */
function origem() {
  if (typeof window === "undefined") return undefined;
  const v = new URLSearchParams(window.location.search).get("origem");
  return v && /^[a-z0-9-]{1,40}$/i.test(v) ? v.toLowerCase() : undefined;
}

/** @ do Instagram no link personalizado (?ig=fulano), gerado pelo CRM no Direct. */
function ig() {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(IG_PARAM)?.slice(0, 100) || undefined;
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

/**
 * Área da página. No modo cartão, o cartão fica sempre centralizado na horizontal e na vertical
 * (computador, celular e incorporado); se for mais alto que a tela, a página rola normalmente.
 */
function Page({ card, compact, children }: { card: boolean; compact: boolean; children: ReactNode }) {
  const safe = "pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]";
  const cls = card
    ? compact
      ? "mx-auto flex w-full max-w-[780px] flex-col justify-center px-3 pb-12 pt-3 sm:px-4 sm:pt-5"
      : `mx-auto flex min-h-dvh w-full max-w-[780px] flex-col justify-center px-3 py-16 sm:px-6 sm:py-20`
    : compact
      ? "px-4 py-5 sm:px-6"
      : `mx-auto flex min-h-dvh w-full max-w-[640px] flex-col px-4 sm:px-6 sm:pt-8 ${safe}`;
  return <div className={cls}>{children}</div>;
}

/**
 * O cartão em si (no modo página inteira, não acrescenta nada). O rodapé fica pendurado abaixo
 * do cartão, fora do cálculo da centralização, para o cartão ficar no centro exato da tela.
 */
function Shell({ card, below, children }: { card: boolean; below?: ReactNode; children: ReactNode }) {
  if (!card) return <>{children}</>;
  return (
    <div className="relative w-full">
      <div className="flex w-full flex-col rounded-[28px] px-5 py-7 sm:rounded-[32px] sm:px-14 sm:py-12" style={{ background: "var(--q-surface)", border: "1px solid var(--q-line)", boxShadow: "0 30px 60px -36px rgba(15, 15, 15, 0.22)" }}>
        {children}
      </div>
      {below && <div className="absolute inset-x-0 top-full">{below}</div>}
    </div>
  );
}

/** Marca no topo do cartão: a logo enviada ou a inicial com o ponto dourado e o nome espaçado. */
function Brand({ orgName, logo, size }: { orgName: string; logo: string | null; size: "lg" | "sm" }) {
  const lg = size === "lg";
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={orgName} className={lg ? "h-16 w-auto max-w-[220px] object-contain sm:h-20" : "h-8 w-auto max-w-[160px] object-contain"} />;
  }
  const axion = orgName.trim().toLowerCase() === "axion";
  const initial = (orgName.trim()[0] ?? "").toUpperCase();
  return (
    <span className={lg ? "flex flex-col items-center gap-3" : "flex items-center gap-2.5"} aria-label={orgName} role="img">
      {axion ? (
        <AxionMark className={lg ? "h-[64px] w-auto sm:h-[76px]" : "h-[24px] w-auto"} />
      ) : (
        <span aria-hidden className={`relative font-extrabold leading-none tracking-[-0.06em] ${lg ? "text-[64px] sm:text-[76px]" : "text-[26px]"}`}>
          {initial}
          <span className={`absolute rounded-full ${lg ? "-right-3 bottom-[0.06em] size-3.5 sm:size-4" : "-right-1.5 bottom-[0.06em] size-1.5"}`} style={{ background: "var(--q-primary)" }} />
        </span>
      )}
      <span aria-hidden className={`font-bold ${lg ? "pl-[0.34em] text-[22px] tracking-[0.34em] sm:text-[26px]" : "ml-1 text-[13px] tracking-[0.3em]"}`}>
        {orgName.toUpperCase()}
      </span>
    </span>
  );
}

/** Símbolo da AXION: o "A" de topo reto com a barra destacada e o ponto dourado. */
function AxionMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 100" className={className} aria-hidden>
      <path d="M48.9 0H74.1L111 100H88.7L60.7 24L23.5 100H0Z" fill="currentColor" />
      <path d="M47.8 58.6H76L84 79.6H37.5Z" fill="currentColor" />
      <circle cx="115" cy="88" r="12" fill="var(--q-primary)" />
    </svg>
  );
}

/** Texto branco ou escuro, o que tiver mais contraste com a cor do botão. */
function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.4 ? "#10201a" : "#ffffff";
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
          {q.required && <span style={{ color: "var(--q-accent)" }}> *</span>}
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

function Done({ title, message, celebrate, redirecting, tight }: { title: string; message: string; celebrate: boolean; redirecting: boolean; tight?: boolean }) {
  return (
    <div className={`quiz-step relative flex flex-col items-center text-center ${tight ? "pb-2 pt-2" : "py-10"}`}>
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
      <h2 className="mt-6 text-[26px] font-bold">{title}</h2>
      <p className="mt-3 max-w-[460px] text-[16px] leading-relaxed" style={{ color: "var(--q-muted)" }}>
        {message}
      </p>
      {redirecting && <p className="mt-6 text-[13px]" style={{ color: "var(--q-muted)" }}>Redirecionando…</p>}
    </div>
  );
}
