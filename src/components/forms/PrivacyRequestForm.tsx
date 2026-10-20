"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { PRIVACY_KIND_LABEL } from "@/lib/quiz/types";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

/** Pedido do titular (LGPD) para os dados enviados por formulários. Não exige login. */
export function PrivacyRequestForm({ form }: { form?: string }) {
  const [v, setV] = useState({ kind: "access", name: "", email: "", phone: "", message: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => {
    setV((x) => ({ ...x, [k]: val }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/public/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, form }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(data?.error?.message ?? "Não foi possível enviar. Tente novamente.", res.status, data?.error?.code, data?.error?.details);
      setDone(data.message);
    } catch (err) {
      const fields = (err as ApiError).fields ?? {};
      setErrors(Object.keys(fields).length ? fields : { form: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  if (done) return <p className="rounded-[16px] bg-selected p-4 text-[14.5px]">{done}</p>;
  return (
    <form onSubmit={send} className="flex flex-col gap-4" noValidate>
      <Field label="O que você quer pedir?" htmlFor="pr-kind">
        <Select id="pr-kind" value={v.kind} onChange={(e) => set("kind", e.target.value)}>
          {Object.entries(PRIVACY_KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Seu nome" htmlFor="pr-name" error={errors.name}>
        <Input id="pr-name" value={v.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="E-mail usado no formulário" htmlFor="pr-email" error={errors.email}>
          <Input id="pr-email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
        </Field>
        <Field label="WhatsApp usado no formulário" htmlFor="pr-phone" error={errors.phone}>
          <Input id="pr-phone" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
        </Field>
      </div>
      <Field label="Detalhes (opcional)" htmlFor="pr-msg">
        <Textarea id="pr-msg" value={v.message} maxLength={2000} onChange={(e) => set("message", e.target.value)} />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set("website", e.target.value)} className="hidden" aria-hidden />
      {errors.form && <p className="text-[13.5px] text-danger" role="alert">{errors.form}</p>}
      <Button type="submit" loading={busy} className="self-start">
        Enviar pedido
      </Button>
    </form>
  );
}
