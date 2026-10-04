"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordForm } from "@/components/auth/PasswordForm";
import { api, fetcher } from "@/lib/api";
import { Button, Spinner } from "@/components/ui";

type Invite = { name: string; email: string; orgName: string; hasPassword: boolean };

function InviteInner() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { data, error, isLoading } = useSWR<Invite>(token ? `/api/auth/invite?token=${encodeURIComponent(token)}` : null, fetcher);
  if (!token || error) {
    return (
      <div className="mt-6">
        <p className="text-muted">{(error as Error)?.message ?? "Convite inválido."} Peça um novo convite ao administrador.</p>
        <Link className="mt-6 inline-block text-brand font-medium" href="/login">Ir para o login</Link>
      </div>
    );
  }
  if (isLoading || !data) return <Spinner className="mt-8" />;
  const accept = async (password: string | null) => {
    await api.post("/api/auth/invite", { token, password });
    router.replace("/dashboard");
  };
  return (
    <>
      <p className="mt-2 text-[16px] text-muted">
        Olá, {data.name}. Você foi convidado(a) para a equipe <strong className="text-ink">{data.orgName}</strong> ({data.email}).
      </p>
      {data.hasPassword ? (
        <Button size="lg" className="mt-8 w-full" onClick={() => accept(null)}>
          Aceitar convite
        </Button>
      ) : (
        <PasswordForm submitLabel="Criar senha e entrar" onSubmit={(pw) => accept(pw)} />
      )}
    </>
  );
}

export default function InvitePage() {
  return (
    <AuthShell>
      <h1 className="text-[32px] font-bold tracking-tight text-[#0f1f1a]">Aceitar convite</h1>
      <Suspense>
        <InviteInner />
      </Suspense>
    </AuthShell>
  );
}
