"use client";

import Link from "next/link";
import useSWR from "swr";
import { ChevronDown, Settings } from "lucide-react";
import { fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { Badge, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";

export type IntegrationAccount = {
  id: string;
  username: string | null;
  status: "connected" | "insufficient_permission" | "reconnect_required" | "error" | "disconnected";
  lastError: string | null;
  capabilities: { connected: boolean; sendMessages: boolean; readComments: boolean; replyComments: boolean; privateReplies: boolean };
};
export type Integrations = { accounts: IntegrationAccount[] };

export const ACCOUNT_STATUS: Record<IntegrationAccount["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  connected: { label: "Conectado", tone: "success" },
  insufficient_permission: { label: "Permissão insuficiente", tone: "warning" },
  reconnect_required: { label: "Reconexão necessária", tone: "warning" },
  error: { label: "Erro", tone: "danger" },
  disconnected: { label: "Desconectado", tone: "neutral" },
};

export function useActiveAccount() {
  const { data } = useSWR<Integrations>("/api/integrations", fetcher);
  const account = data?.accounts.find((a) => a.status !== "disconnected") ?? null;
  return { account, loaded: !!data };
}

export function AccountPill() {
  const me = useMe();
  const { account, loaded } = useActiveAccount();
  const label = account?.username ? `Instagram · @${account.username}` : loaded ? "Instagram não conectado" : "Instagram";
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="inline-flex h-[52px] items-center gap-3 rounded-[16px] border border-line bg-white px-4 text-[15px] font-medium text-ink hover:bg-page" aria-label={`Conta selecionada: ${label}`}>
          <InstagramGlyph size={26} />
          <span className="max-w-[230px] truncate">{label}</span>
          {account && account.status !== "connected" && <span className="size-2.5 rounded-full bg-warning" aria-label={ACCOUNT_STATUS[account.status].label} />}
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Conta do Instagram</MenuLabel>
        <div className="px-3 pb-2">
          {account ? (
            <>
              <p className="text-[14px] font-medium">@{account.username}</p>
              <Badge tone={ACCOUNT_STATUS[account.status].tone} className="mt-1">
                {ACCOUNT_STATUS[account.status].label}
              </Badge>
              {account.lastError && <p className="mt-1 max-w-[260px] text-[12px] text-muted">{account.lastError}</p>}
            </>
          ) : (
            <p className="max-w-[260px] text-[13px] text-muted">Nenhuma conta conectada. Direct e comentários dependem da integração oficial com a Meta.</p>
          )}
        </div>
        {me.permissions.integrations && (
          <MenuItem icon={<Settings />} onSelect={() => (window.location.href = "/configuracoes?aba=integracoes")}>
            Gerenciar integração
          </MenuItem>
        )}
        {!me.permissions.integrations && !account && (
          <div className="px-3 pb-2 text-[12px] text-muted">
            Peça ao administrador para conectar em <Link href="/configuracoes">Configurações</Link>.
          </div>
        )}
      </MenuContent>
    </Menu>
  );
}
