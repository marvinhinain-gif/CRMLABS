"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Lock, Mail, MailCheck, UserRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, IconButton, Input, Textarea } from "@/components/ui";

export function SignupForm({ open }: { open: boolean }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", note: "" });
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    if (form.password.length < 10) return setFields({ password: "A senha precisa ter pelo menos 10 caracteres." });
    if (form.password !== form.confirm) return setFields({ confirm: "As senhas não conferem." });
    setLoading(true);
    try {
      const r = await api.post<{ message: string }>("/api/auth/signup", { name: form.name, email: form.email, password: form.password, note: form.note || undefined });
      setDone(r.message);
    } catch (err) {
      const ae = err as ApiError;
      setFields(ae.fields ?? {});
      setError(ae.message);
    } finally {
      setLoading(false);
    }
  }

  const back = (
    <Link href="/login" className="mt-8 inline-flex items-center gap-2 text-[14px] font-medium text-brand hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> Voltar para o login
    </Link>
  );

  if (!open) {
    return (
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-[#0f1f1a]">Criar conta</h1>
        <p className="mt-3 text-[16px] text-muted">O cadastro está fechado no momento. Peça um convite ao administrador da sua equipe.</p>
        {back}
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <h1 className="text-[32px] font-bold tracking-tight text-[#0f1f1a]">Pedido enviado</h1>
        <div className="mt-6 flex gap-3 rounded-[18px] bg-selected p-5 text-[14.5px] text-brand-dark" role="status">
          <MailCheck className="size-5 shrink-0 text-brand" aria-hidden />
          <p>{done}</p>
        </div>
        {back}
      </div>
    );
  }

  const toggle = (
    <IconButton label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow((v) => !v)} className="size-10">
      {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
    </IconButton>
  );

  return (
    <div>
      <div className="text-center">
        <h1 className="text-[34px] sm:text-[38px] font-bold tracking-tight text-[#0f1f1a]">Criar conta</h1>
        <p className="mt-2 text-[16px] text-muted">Preencha seus dados. O administrador aprova o acesso antes do primeiro login.</p>
      </div>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
        {error && !Object.keys(fields).length && (
          <div role="alert" className="rounded-[14px] bg-danger-soft px-4 py-3 text-[14px] text-danger">
            {error}
          </div>
        )}
        <Field label="Nome completo" htmlFor="su-name" error={fields.name}>
          <Input id="su-name" autoComplete="name" icon={<UserRound />} value={form.name} onChange={set("name")} className="h-[52px]" invalid={!!fields.name} />
        </Field>
        <Field label="E-mail" htmlFor="su-email" error={fields.email}>
          <Input id="su-email" type="email" autoComplete="email" placeholder="voce@empresa.com" icon={<Mail />} value={form.email} onChange={set("email")} className="h-[52px]" invalid={!!fields.email} />
        </Field>
        <Field label="Senha" htmlFor="su-pw" error={fields.password} hint="Mínimo de 10 caracteres.">
          <Input id="su-pw" type={show ? "text" : "password"} autoComplete="new-password" icon={<Lock />} value={form.password} onChange={set("password")} className="h-[52px]" trailing={toggle} invalid={!!fields.password} />
        </Field>
        <Field label="Confirme a senha" htmlFor="su-pw2" error={fields.confirm}>
          <Input id="su-pw2" type={show ? "text" : "password"} autoComplete="new-password" icon={<Lock />} value={form.confirm} onChange={set("confirm")} className="h-[52px]" invalid={!!fields.confirm} />
        </Field>
        <Field label="Mensagem para o administrador (opcional)" htmlFor="su-note" error={fields.note} hint="Ex.: sua função na equipe.">
          <Textarea id="su-note" value={form.note} onChange={set("note")} maxLength={300} className="min-h-[72px]" />
        </Field>
        <Button type="submit" size="lg" loading={loading} className="mt-2 w-full" disabled={!form.name.trim() || !form.email.trim()}>
          Pedir acesso
        </Button>
        <p className="text-center text-[14px] text-muted">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </div>
  );
}
