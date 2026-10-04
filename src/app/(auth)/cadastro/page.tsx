import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/SignupForm";
import { optionalPageCtx } from "@/server/session";
import { signupOrganization } from "@/server/auth/signup";

export const metadata: Metadata = { title: "Criar conta" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await optionalPageCtx()) redirect("/dashboard");
  const open = !!(await signupOrganization());
  return (
    <AuthShell>
      <SignupForm open={open} />
    </AuthShell>
  );
}
