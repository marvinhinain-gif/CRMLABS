"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button, Checkbox, Field, IconButton, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setLoading(true);
    try {
      await api.post("/api/auth/login", { email, password, remember });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      const ae = err as ApiError;
      setFields(ae.fields ?? {});
      setError(ae.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="text-center">
        <h1 className="text-[34px] sm:text-[40px] font-bold tracking-tight text-[#0f1f1a]">Bem-vindo de volta</h1>
        <p className="mt-2 text-[16px] sm:text-[18px] text-muted">Entre na sua conta para continuar.</p>
      </div>
      <form onSubmit={submit} className="mt-10 flex flex-col gap-5" noValidate>
        {error && !Object.keys(fields).length && (
          <div role="alert" className="rounded-[14px] bg-danger-soft px-4 py-3 text-[14px] text-danger">
            {error}
          </div>
        )}
        <Field label="E-mail" htmlFor="email" error={fields.email}>
          <Input id="email" type="email" autoComplete="email" placeholder="voce@empresa.com" icon={<Mail />} value={email} onChange={(e) => setEmail(e.target.value)} required className="h-[52px]" invalid={!!fields.email} />
        </Field>
        <Field label="Senha" htmlFor="password" error={fields.password}>
          <Input
            id="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Sua senha"
            icon={<Lock />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-[52px]"
            invalid={!!fields.password}
            trailing={
              <IconButton label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow((v) => !v)} className="size-10">
                {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </IconButton>
            }
          />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <Checkbox label="Lembrar de mim" checked={remember} onChange={setRemember} />
          <Link href="/recuperar-senha" className="text-[14px] font-medium text-brand hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" size="lg" loading={loading} className="mt-2 w-full">
          Entrar
        </Button>
        <p className="text-center text-[14px] text-muted">
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="font-medium text-brand hover:underline">
            Criar conta
          </Link>
        </p>
        <p className="-mt-2 text-center text-[13px] text-muted">
          Problemas para acessar? <span className="font-medium text-brand">Fale com o administrador.</span>
        </p>
      </form>
    </div>
  );
}
