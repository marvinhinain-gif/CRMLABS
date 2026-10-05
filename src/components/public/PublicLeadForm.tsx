"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import type { LeadQuestion } from "@/server/db/schema";

type PublicForm = {
  slug: string;
  orgName: string;
  headline: string;
  description: string | null;
  questions: LeadQuestion[];
  askEmail: boolean;
  askInstagram: boolean;
  askPreferredTime: boolean;
};

const input =
  "w-full h-[52px] rounded-[16px] border border-[#d5e3de] bg-white px-4 text-[16px] text-ink placeholder:text-[#94a3ad] transition-colors focus:border-brand focus:outline-none focus:ring-4 focus:ring-[#008a65]/12 aria-[invalid=true]:border-danger";

function Label({ htmlFor, children, optional }: { htmlFor: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[15px] font-medium text-ink">
      {children} {optional && <span className="font-normal text-muted">(opcional)</span>}
    </label>
  );
}

function Err({ msg, id }: { msg?: string; id: string }) {
  return msg ? (
    <p id={id} className="mt-1.5 text-[13.5px] text-danger" role="alert">
      {msg}
    </p>
  ) : null;
}

/** Máscara simples de WhatsApp brasileiro: (71) 99999-1111 */
function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function todayLocal() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}

export function PublicLeadForm({ form }: { form: PublicForm }) {
  const [v, setV] = useState({ name: "", phone: "", email: "", instagram: "", date: "", time: "", website: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const started = useRef(Date.now());
  const utm = useRef<Record<string, string>>({});

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"]) {
      const x = sp.get(k);
      if (x) utm.current[k] = x.slice(0, 300);
    }
  }, []);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: k === "phone" ? maskPhone(e.target.value) : e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = "Informe seu nome.";
    if (v.phone.replace(/\D/g, "").length < 10) errs.phone = "Informe o WhatsApp com DDD.";
    for (const q of form.questions) if (q.required && !answers[q.id]?.trim()) errs[`q_${q.id}`] = "Responda esta pergunta.";
    if (form.askPreferredTime && v.date && !v.time) errs.preferredAt = "Escolha também o horário.";
    if (!consent) errs.consent = "Marque para podermos entrar em contato.";
    setErrors(errs);
    setMsg(null);
    if (Object.keys(errs).length) {
      document.getElementById(Object.keys(errs)[0] === "consent" ? "pf-consent" : Object.keys(errs)[0].startsWith("q_") ? Object.keys(errs)[0] : `pf-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/public/forms/${form.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: v.name,
          phone: v.phone,
          email: v.email,
          instagram: v.instagram,
          preferredAt: v.date && v.time ? `${v.date}T${v.time}` : "",
          answers,
          consent: true,
          utm: utm.current,
          website: v.website,
          startedAt: started.current,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrors((data?.error?.details?.fields as Record<string, string>) ?? {});
        setMsg(data?.error?.message ?? "Não foi possível enviar. Tente novamente.");
        return;
      }
      setDone(data?.message ?? "Recebemos seus dados!");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setMsg("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="anim-rise rounded-[28px] bg-white px-6 py-10 text-center shadow-[0_10px_40px_rgb(16_60_48/0.08)]">
        <span className="anim-pop mx-auto flex size-20 items-center justify-center rounded-full bg-selected text-brand" aria-hidden>
          <CircleCheck className="size-10" strokeWidth={2.2} />
        </span>
        <h1 className="mt-5 text-[24px] font-bold tracking-tight">Tudo certo, {v.name.split(" ")[0]}!</h1>
        <p className="mx-auto mt-2 max-w-[380px] text-[16px] leading-relaxed text-muted">{done}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="anim-rise rounded-[28px] bg-white p-5 shadow-[0_10px_40px_rgb(16_60_48/0.08)] sm:p-8">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-brand">{form.orgName}</p>
      <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-[#0f1f1a] sm:text-[30px]">{form.headline}</h1>
      {form.description && <p className="mt-2 whitespace-pre-line text-[15.5px] leading-relaxed text-muted">{form.description}</p>}

      <div className="mt-6 flex flex-col gap-5">
        <div>
          <Label htmlFor="pf-name">Seu nome</Label>
          <input id="pf-name" className={input} autoComplete="name" value={v.name} onChange={set("name")} aria-invalid={!!errors.name} aria-describedby="e-name" maxLength={120} />
          <Err id="e-name" msg={errors.name} />
        </div>
        <div>
          <Label htmlFor="pf-phone">WhatsApp</Label>
          <input id="pf-phone" className={input} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(71) 99999-9999" value={v.phone} onChange={set("phone")} aria-invalid={!!errors.phone} aria-describedby="e-phone" />
          <Err id="e-phone" msg={errors.phone} />
        </div>
        {form.askEmail && (
          <div>
            <Label htmlFor="pf-email" optional>
              E-mail
            </Label>
            <input id="pf-email" className={input} type="email" inputMode="email" autoComplete="email" value={v.email} onChange={set("email")} aria-invalid={!!errors.email} aria-describedby="e-email" maxLength={200} />
            <Err id="e-email" msg={errors.email} />
          </div>
        )}
        {form.askInstagram && (
          <div>
            <Label htmlFor="pf-instagram" optional>
              Seu @ no Instagram
            </Label>
            <input id="pf-instagram" className={input} autoCapitalize="none" autoCorrect="off" placeholder="@seuperfil" value={v.instagram} onChange={set("instagram")} maxLength={60} />
          </div>
        )}
        {form.questions.map((q) => {
          const id = `q_${q.id}`;
          const val = answers[q.id] ?? "";
          const setA = (x: string) => setAnswers((a) => ({ ...a, [q.id]: x }));
          return (
            <div key={q.id}>
              {q.type === "choice" ? (
                <fieldset>
                  <legend className="mb-2 text-[15px] font-medium text-ink">
                    {q.label} {!q.required && <span className="font-normal text-muted">(opcional)</span>}
                  </legend>
                  <div className="flex flex-col gap-2">
                    {(q.options ?? []).map((o, i) => (
                      <label key={o} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[16px] border px-4 py-3 text-[15.5px] transition-colors ${val === o ? "border-brand bg-selected" : "border-[#d5e3de] bg-white hover:bg-page"}`}>
                        <input id={i === 0 ? id : undefined} type="radio" name={id} value={o} checked={val === o} onChange={() => setA(o)} className="size-5 accent-[#008a65]" />
                        {o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <>
                  <Label htmlFor={id} optional={!q.required}>
                    {q.label}
                  </Label>
                  {q.type === "textarea" ? (
                    <textarea id={id} className={`${input} h-auto min-h-[110px] py-3`} value={val} onChange={(e) => setA(e.target.value)} maxLength={2000} aria-invalid={!!errors[id]} />
                  ) : (
                    <input id={id} className={input} inputMode={q.type === "number" ? "decimal" : undefined} value={val} onChange={(e) => setA(e.target.value)} maxLength={500} aria-invalid={!!errors[id]} />
                  )}
                </>
              )}
              <Err id={`e-${id}`} msg={errors[id]} />
            </div>
          );
        })}
        {form.askPreferredTime && (
          <fieldset>
            <legend className="mb-1.5 text-[15px] font-medium text-ink">
              Melhor dia e horário para conversarmos <span className="font-normal text-muted">(opcional)</span>
            </legend>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2 [&>input]:min-w-0">
              <input id="pf-preferredAt" aria-label="Dia" className={input} type="date" min={todayLocal()} value={v.date} onChange={set("date")} />
              <input aria-label="Horário" className={input} type="time" step={900} value={v.time} onChange={set("time")} />
            </div>
            <Err id="e-pref" msg={errors.preferredAt} />
          </fieldset>
        )}

        {/* Campo invisível contra robôs */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Site <input tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} />
          </label>
        </div>

        <label className="flex items-start gap-3 text-[14px] leading-snug text-muted">
          <input id="pf-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#008a65]" aria-invalid={!!errors.consent} />
          <span>
            Aceito que a equipe de <b className="text-ink">{form.orgName}</b> entre em contato comigo pelo WhatsApp e use estes dados para o atendimento.
          </span>
        </label>
        <Err id="e-consent" msg={errors.consent} />

        {msg && (
          <p className="rounded-[14px] bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert">
            {msg}
          </p>
        )}
        <button
          type="submit"
          disabled={sending}
          className="flex h-[56px] w-full items-center justify-center gap-2 rounded-[18px] bg-brand text-[17px] font-semibold text-white shadow-[0_8px_24px_rgb(0_138_101/0.25)] transition-[transform,background] hover:bg-brand-hover active:scale-[0.99] disabled:opacity-70"
        >
          {sending && <LoaderCircle className="size-5 animate-spin" aria-hidden />}
          {sending ? "Enviando…" : "Quero ser atendido"}
        </button>
      </div>
    </form>
  );
}
