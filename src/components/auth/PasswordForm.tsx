"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Button, Field, IconButton, Input } from "@/components/ui";

export function PasswordForm({ onSubmit, submitLabel, extra }: { onSubmit: (password: string) => Promise<void>; submitLabel: string; extra?: React.ReactNode }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) return setError("A senha precisa ter pelo menos 10 caracteres.");
    if (pw !== confirm) return setError("As senhas não conferem.");
    setLoading(true);
    try {
      await onSubmit(pw);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  const toggle = (
    <IconButton label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow((v) => !v)} className="size-10">
      {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
    </IconButton>
  );
  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-5" noValidate>
      {extra}
      <Field label="Nova senha" htmlFor="pw" hint="Mínimo de 10 caracteres.">
        <Input id="pw" type={show ? "text" : "password"} autoComplete="new-password" icon={<Lock />} value={pw} onChange={(e) => setPw(e.target.value)} className="h-[52px]" trailing={toggle} />
      </Field>
      <Field label="Confirme a senha" htmlFor="pw2" error={error ?? undefined}>
        <Input id="pw2" type={show ? "text" : "password"} autoComplete="new-password" icon={<Lock />} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-[52px]" />
      </Field>
      <Button type="submit" size="lg" loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}
