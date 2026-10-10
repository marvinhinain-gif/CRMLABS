"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import * as RDialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import useSWR, { SWRConfig } from "swr";
import {
  ArrowLeft,
  ChartNoAxesColumn,
  Bell,
  ChevronDown,
  ChevronRight,
  House,
  LogOut,
  Menu as MenuIcon,
  MessageCircle,
  Search,
  Settings,
  SquareCheck,
  SquareUser,
  Users,
  X,
  Building,
  Check,
  UserRound,
  Megaphone,
  CalendarDays,
  Plug,
  CheckCheck,
  ClipboardList,
} from "lucide-react";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";
import { api, fetcher, qs } from "@/lib/api";
import { MeProvider, useMe } from "@/lib/me";
import { RealtimeBridge } from "@/lib/realtime";
import { ROLE_LABEL, type Me } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { Avatar, cx, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui";
import { ContactPanel } from "@/components/contacts/ContactPanel";
import { PushPrompt } from "./PushPrompt";
import { InstagramNavIcon } from "@/components/ui/ChannelIcon";

const NAV: { href: string; label: string; icon: typeof House | typeof InstagramNavIcon; badge?: "instagram" | "leads"; adminOnly?: boolean; permission?: keyof Me["permissions"] }[] = [
  { href: "/dashboard", label: "Visão geral", icon: House },
  { href: "/social-seller", label: "Social Seller", icon: Users },
  { href: "/leads", label: "Leads", icon: Megaphone, badge: "leads" },
  { href: "/agendamentos", label: "Agendamentos", icon: CalendarDays },
  { href: "/instagram", label: "Instagram", icon: InstagramNavIcon, badge: "instagram" },
  { href: "/contatos", label: "Contatos", icon: SquareUser },
  { href: "/comercial", label: "Comercial", icon: ChartNoAxesColumn },
  { href: "/tarefas", label: "Tarefas", icon: SquareCheck },
  { href: "/formularios", label: "Formulários & Quizzes", icon: ClipboardList, permission: "forms" },
  { href: "/integracoes", label: "Integrações", icon: Plug, adminOnly: true },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Visão geral",
  "/social-seller": "Social Seller",
  "/leads": "Leads",
  "/agendamentos": "Agendamentos",
  "/integracoes": "Integrações",
  "/conversas": "Instagram",
  "/instagram": "Instagram",
  "/contatos": "Contatos",
  "/comercial": "Comercial",
  "/tarefas": "Tarefas",
  "/formularios": "Formulários & Quizzes",
  "/configuracoes": "Configurações",
};

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const me = useMe();
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-1.5">
      {NAV.filter((item) => (!item.adminOnly || me.user.role === "admin") && (!item.permission || me.permissions[item.permission])).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const count = item.badge === "instagram" ? (me.counts.pendingDirects ?? 0) + (me.counts.pendingComments ?? 0) : item.badge === "leads" ? (me.counts.newLeads ?? 0) : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cx(
              "group relative flex items-center gap-3.5 rounded-[16px] h-12 text-[16px] transition-colors",
              collapsed ? "justify-center px-0" : "px-4",
              active ? "bg-selected text-brand font-semibold" : "text-ink hover:bg-page",
            )}
          >
            <Icon className="size-[22px] shrink-0" {...(Icon === InstagramNavIcon ? {} : { strokeWidth: active ? 2.2 : 1.8 })} aria-hidden />
            {!collapsed && <span className="flex-1">{item.label}</span>}
            {count > 0 && (
              <span
                className={cx("flex items-center justify-center rounded-full bg-brand text-white text-[12px] font-semibold", collapsed ? "absolute right-1.5 top-1.5 size-5" : "min-w-7 h-7 px-1.5")}
                aria-label={item.badge === "leads" ? `${count} leads novos` : `${count} interações esperando resposta`}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SettingsLink({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname.startsWith("/configuracoes");
  return (
    <Link
      href="/configuracoes"
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? "Configurações" : undefined}
      className={cx(
        "flex items-center gap-3.5 rounded-[16px] h-[52px] text-[16px] transition-colors",
        collapsed ? "justify-center" : "px-4",
        active ? "bg-selected text-brand font-semibold" : "text-ink hover:bg-page",
      )}
    >
      <Settings className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
      {!collapsed && "Configurações"}
    </Link>
  );
}

async function logout() {
  await api.post("/api/auth/logout").catch(() => {});
  window.location.href = "/login";
}

function ProfileMenu({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" }) {
  const me = useMe();
  const router = useRouter();
  const switchOrg = async (orgId: string) => {
    await api.post("/api/auth/switch-org", { orgId });
    window.location.href = "/dashboard";
  };
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent align={align}>
        <div className="px-3 py-2">
          <p className="text-[14px] font-semibold">{me.user.name}</p>
          <p className="text-[12.5px] text-muted">{me.user.email}</p>
        </div>
        {me.orgs.length > 1 && (
          <>
            <MenuSeparator />
            <MenuLabel>Organização</MenuLabel>
            {me.orgs.map((o) => (
              <MenuItem key={o.id} icon={o.id === me.org.id ? <Check /> : <Building />} onSelect={() => o.id !== me.org.id && switchOrg(o.id)}>
                {o.name}
                {o.isDemo && <span className="ml-auto text-[11px] text-muted">demo</span>}
              </MenuItem>
            ))}
          </>
        )}
        <MenuSeparator />
        <MenuItem icon={<UserRound />} onSelect={() => router.push("/configuracoes?aba=perfil")}>
          Meu perfil e foto
        </MenuItem>
        <MenuItem icon={<Settings />} onSelect={() => router.push("/configuracoes")}>
          Configurações
        </MenuItem>
        <MenuItem icon={<LogOut />} onSelect={logout} danger>
          Sair
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Sidebar() {
  const me = useMe();
  return (
    <aside className="hidden md:flex sticky top-0 h-dvh shrink-0 flex-col bg-white border-r border-line/60 md:w-[88px] xl:w-[270px] px-3 xl:px-4 py-6">
      <Link href="/dashboard" className="flex h-12 items-center xl:px-3 justify-center xl:justify-start" aria-label="CRMLABS — início">
        <span className="hidden xl:inline-flex">
          <AnimatedLogo size={32} />
        </span>
        <span className="xl:hidden">
          <AnimatedLogo size={36} showWord={false} />
        </span>
      </Link>
      <div className="mt-8 hidden xl:block">
        <NavLinks />
      </div>
      <div className="mt-8 xl:hidden">
        <NavLinks collapsed />
      </div>
      <div className="mt-auto flex flex-col gap-3">
        <div className="hidden xl:block">
          <SettingsLink />
        </div>
        <div className="xl:hidden">
          <SettingsLink collapsed />
        </div>
        <div className="border-t border-line pt-4">
          <ProfileMenu align="start">
            <button className="flex w-full items-center gap-3 rounded-[16px] p-2 text-left hover:bg-page justify-center xl:justify-start" aria-label="Perfil e sair">
              <Avatar name={me.user.name} src={me.user.avatarUrl} size={48} tone="neutral" />
              <span className="hidden xl:block flex-1 min-w-0">
                <span className="block truncate text-[15px] font-semibold">{me.user.name}</span>
                <span className="block text-[13px] text-muted">{ROLE_LABEL[me.user.role]}</span>
              </span>
              <ChevronRight className="hidden xl:block size-5 text-muted" aria-hidden />
            </button>
          </ProfileMenu>
        </div>
      </div>
    </aside>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  const me = useMe();
  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <span className="md:hidden">
        <RDialog.Trigger asChild>
          <IconButton label="Abrir menu">
            <MenuIcon className="size-6" />
          </IconButton>
        </RDialog.Trigger>
      </span>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[#0d2a22]/30 md:hidden" />
        <RDialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[320px] flex-col bg-white p-5 md:hidden">
          <RDialog.Title className="sr-only">Menu</RDialog.Title>
          <RDialog.Description className="sr-only">Navegação principal</RDialog.Description>
          <div className="flex items-center justify-between">
            <AnimatedLogo size={28} />
            <RDialog.Close asChild>
              <IconButton label="Fechar menu">
                <X className="size-5" />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="mt-6 overflow-y-auto">
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-2">
              <SettingsLink onNavigate={() => setOpen(false)} />
            </div>
          </div>
          <div className="mt-auto border-t border-line pt-4 flex items-center gap-3">
            <Avatar name={me.user.name} src={me.user.avatarUrl} size={44} tone="neutral" />
            <div className="flex-1 min-w-0">
              <p className="truncate font-semibold">{me.user.name}</p>
              <p className="text-[13px] text-muted">{ROLE_LABEL[me.user.role]}</p>
            </div>
            <IconButton label="Sair" onClick={logout}>
              <LogOut className="size-5" />
            </IconButton>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

type SearchResult = {
  contacts: { id: string; name: string; username: string | null; avatarUrl: string | null; stageName: string | null }[];
  conversations: { id: string; contactName: string; lastMessagePreview: string | null }[];
};

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useSWR<SearchResult>(debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null, fetcher);
  const openContact = (id: string) => {
    setOpen(false);
    setQ("");
    const sp = new URLSearchParams(window.location.search);
    sp.set("contato", id);
    router.push(`${pathname}?${sp}`);
  };
  return (
    <Popover.Root open={open && debounced.length >= 2} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative w-full max-w-[560px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Buscar contato..."
            aria-label="Buscar contato ou conversa"
            className="h-11 w-full rounded-[14px] border border-line bg-white pl-11 pr-4 text-[14.5px] placeholder:text-[#8a99a3] focus:border-brand focus:outline-none focus:ring-4 focus:ring-[#008a65]/10"
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[320px] rounded-[18px] border border-line bg-white p-2 shadow-[var(--shadow-pop)]"
        >
          {isLoading && <p className="p-3 text-[13.5px] text-muted">Buscando…</p>}
          {data && !data.contacts.length && !data.conversations.length && <p className="p-3 text-[13.5px] text-muted">Nada encontrado para “{debounced}”.</p>}
          {!!data?.contacts.length && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[12px] font-medium text-muted">Contatos</p>
              {data.contacts.map((c) => (
                <button key={c.id} onClick={() => openContact(c.id)} className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left hover:bg-page">
                  <Avatar name={c.name} src={c.avatarUrl} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{c.name}</span>
                    <span className="block truncate text-[12.5px] text-muted">{c.username ? `@${c.username}` : c.stageName ?? "—"}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {!!data?.conversations.length && (
            <div>
              <p className="px-3 pt-3 pb-1 text-[12px] font-medium text-muted">Conversas</p>
              {data.conversations.map((c) => (
                <Link key={c.id} href={`/instagram?aba=directs&c=${c.id}`} onClick={() => setOpen(false)} className="flex flex-col rounded-[12px] px-3 py-2 hover:bg-page">
                  <span className="text-[14px] font-medium">{c.contactName}</span>
                  <span className="truncate text-[12.5px] text-muted">{c.lastMessagePreview ?? "Sem mensagens"}</span>
                </Link>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type Notifs = { unread: number };

type Notif = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

function notifIcon(type: string) {
  if (type.startsWith("daily.")) return type === "daily.morning" ? "☀️" : "🌙";
  if (type.startsWith("task.")) return "✅";
  if (type.startsWith("sale")) return "🏆";
  if (type.startsWith("opportunity") || type.startsWith("lead")) return "🔥";
  if (type.startsWith("meeting")) return "📅";
  if (type.startsWith("message")) return "💬";
  return "🔔";
}

const whenFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Central de notificações: não lidas / todas, data e hora, marcar como lida (uma ou todas). */
function Notifications() {
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data, mutate } = useSWR<Notifs & { rows: Notif[] }>(`/api/notifications${qs({ unread: tab === "unread" ? "1" : "", limit: 50 })}`, fetcher, { refreshInterval: 120_000, keepPreviousData: true });
  const unread = data?.unread ?? 0;
  const markAll = async () => {
    mutate(data && { ...data, unread: 0, rows: tab === "unread" ? [] : data.rows.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) }, { revalidate: false });
    await api.post("/api/notifications", {});
    mutate();
  };
  const markOne = async (n: Notif) => {
    if (n.readAt) return;
    mutate(data && { ...data, unread: Math.max(0, data.unread - 1), rows: tab === "unread" ? data.rows.filter((r) => r.id !== n.id) : data.rows.map((r) => (r.id === n.id ? { ...r, readAt: new Date().toISOString() } : r)) }, { revalidate: false });
    await api.post("/api/notifications", { ids: [n.id] });
    mutate();
  };
  const go = (n: Notif) => {
    void markOne(n);
    setOpen(false);
    if (n.link) router.push(n.link);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="relative inline-flex size-11 items-center justify-center rounded-[12px] text-ink hover:bg-page" aria-label={unread ? `Notificações: ${unread} não lidas` : "Notificações"}>
          <Bell className={cx("size-[22px]", unread > 0 && "anim-ring")} strokeWidth={1.8} aria-hidden />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white ring-2 ring-white" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={8} className="z-50 flex max-h-[min(560px,80dvh)] w-[380px] max-w-[94vw] flex-col rounded-[20px] border border-line bg-white shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
            <p className="text-[16px] font-semibold">🔔 Notificações</p>
            {unread > 0 && (
              <button onClick={markAll} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                <CheckCheck className="size-4" aria-hidden /> Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="mx-4 mt-2.5 inline-flex rounded-[12px] bg-page p-1 text-[13px]" role="tablist">
            {(
              [
                ["unread", `Não lidas${unread ? ` (${unread})` : ""}`],
                ["all", "Todas"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cx("flex-1 rounded-[9px] px-3 py-1.5 font-medium", tab === v ? "bg-white text-ink shadow-sm" : "text-muted")}>
                {l}
              </button>
            ))}
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto scroll-thin px-2 pb-2">
            {!data ? (
              <div className="skeleton m-2 h-20" />
            ) : !data.rows.length ? (
              <p className="px-4 py-8 text-center text-[13.5px] text-muted">{tab === "unread" ? "Tudo lido por aqui. ✨" : "Nenhuma notificação por enquanto."}</p>
            ) : (
              data.rows.map((n) => (
                <div key={n.id} className={cx("group relative flex gap-3 rounded-[14px] px-3 py-2.5 hover:bg-page", !n.readAt && "bg-[#f3faf7]")}>
                  <span className="mt-0.5 text-[18px] leading-none" aria-hidden>
                    {notifIcon(n.type)}
                  </span>
                  <button onClick={() => go(n)} className="min-w-0 flex-1 text-left">
                    <p className={cx("text-[14px] leading-snug", n.readAt ? "font-medium text-ink/80" : "font-semibold")}>{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-3 text-[13px] text-muted">{n.body}</p>}
                    <p className="mt-1 text-[11.5px] text-muted">{whenFmt.format(new Date(n.createdAt)).replace(",", " ·")}</p>
                  </button>
                  {!n.readAt ? (
                    <span className="flex flex-col items-center gap-1">
                      <span className="mt-1.5 size-2.5 rounded-full bg-brand" aria-label="Nova" />
                      <button onClick={() => markOne(n)} className="rounded-[8px] p-1 text-muted opacity-100 hover:bg-white hover:text-brand sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100" aria-label="Marcar como lida" title="Marcar como lida">
                        <Check className="size-4" />
                      </button>
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const title = TITLES[Object.keys(TITLES).find((k) => pathname.startsWith(k)) ?? ""] ?? "";
  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 bg-white/95 backdrop-blur px-4 sm:px-6 border-b border-line/60 md:border-b-0">
      <MobileNav />
      <Link href="/dashboard" className="md:hidden -ml-1 flex shrink-0 items-center" aria-label="CRMLABS — início">
        <AnimatedLogo size={30} showWord={false} />
      </Link>
      <span className="hidden md:block">
        <IconButton label="Voltar" onClick={() => router.back()}>
          <ArrowLeft className="size-5" />
        </IconButton>
      </span>
      <span className="hidden md:block h-6 w-px bg-line" aria-hidden />
      <p className="hidden sm:block text-[16px] font-medium text-ink whitespace-nowrap">{title}</p>
      <div className="flex flex-1 justify-center px-2">
        <GlobalSearch />
      </div>
      <Notifications />
      <ProfileMenu>
        <button className="hidden sm:flex items-center gap-1.5 rounded-[14px] p-1 hover:bg-page" aria-label="Perfil">
          <Avatar name={me.user.name} src={me.user.avatarUrl} size={40} tone="neutral" />
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
      </ProfileMenu>
    </header>
  );
}

function ContactPanelHost() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = sp.get("contato");
  const close = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete("contato");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return <ContactPanel contactId={id} onClose={close} />;
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const mainRef = useRef<HTMLDivElement>(null);
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, shouldRetryOnError: false }}>
      <MeProvider initial={me}>
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:shadow">
          Pular para o conteúdo
        </a>
        <div className="flex min-h-dvh bg-white">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main id="conteudo" ref={mainRef} className="flex-1 min-w-0 bg-page md:rounded-tl-[32px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              {children}
            </main>
          </div>
        </div>
        <RealtimeBridge />
        <PushPrompt />
        <Suspense>
          <ContactPanelHost />
        </Suspense>
      </MeProvider>
    </SWRConfig>
  );
}
