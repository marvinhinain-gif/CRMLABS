"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>("/api/auth/forgot", { email });
      setSent(r.message);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-[32px] font-bold tracking-tight text-[#0f1f1a]">Recuperar senha</h1>
      <p className="mt-2 text-[16px] text-muted">Informe seu e-mail e enviaremos um link temporário para criar uma nova senha.</p>
      {sent ? (
        <div className="mt-8 rounded-[18px] bg-selected p-5 text-[14.5px] text-brand-dark flex gap-3" role="status">
          <MailCheck className="size-5 shrink-0 text-brand" aria-hidden />
          <p>{sent} O link vale por 1 hora e só pode ser usado uma vez. Se não chegar, peça ao administrador um link de nova senha.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
          <Field label="E-mail" htmlFor="email" error={error ?? undefined}>
            <Input id="email" type="email" autoComplete="email" icon={<Mail />} placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-[52px]" />
          </Field>
          <Button type="submit" size="lg" loading={loading}>
            Enviar link
          </Button>
        </form>
      )}
      <Link href="/login" className="mt-8 inline-flex items-center gap-2 text-[14px] font-medium text-brand hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Voltar para o login
      </Link>
    </AuthShell>
  );
}
