"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordForm } from "@/components/auth/PasswordForm";
import { api } from "@/lib/api";

function ResetInner() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  if (!token) {
    return (
      <p className="mt-6 text-muted">
        Link inválido. <Link className="text-brand font-medium" href="/recuperar-senha">Solicite um novo link</Link>.
      </p>
    );
  }
  return (
    <PasswordForm
      submitLabel="Salvar nova senha"
      onSubmit={async (password) => {
        await api.post("/api/auth/reset", { token, password });
        toast.success("Senha alterada. Entre com a nova senha.");
        router.replace("/login");
      }}
    />
  );
}

export default function ResetPage() {
  return (
    <AuthShell>
      <h1 className="text-[32px] font-bold tracking-tight text-[#0f1f1a]">Criar nova senha</h1>
      <p className="mt-2 text-[16px] text-muted">Por segurança, as sessões abertas serão encerradas.</p>
      <Suspense>
        <ResetInner />
      </Suspense>
    </AuthShell>
  );
}
