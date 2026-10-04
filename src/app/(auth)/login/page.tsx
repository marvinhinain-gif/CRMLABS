import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { optionalPageCtx } from "@/server/session";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await optionalPageCtx()) redirect("/dashboard");
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
