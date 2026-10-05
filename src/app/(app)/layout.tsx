import { AppSplash } from "@/components/brand/AppSplash";
import { AppShell } from "@/components/shell/AppShell";
import { requirePageCtx } from "@/server/session";
import { buildMe } from "@/server/services/me";
import type { Me } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageCtx();
  const me = JSON.parse(JSON.stringify(await buildMe(ctx))) as Me;
  return (
    <>
      <AppSplash />
      <AppShell me={me}>{children}</AppShell>
    </>
  );
}
