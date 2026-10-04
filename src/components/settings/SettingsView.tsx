"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Building, CircleCheck, CircleX, Copy, MessageSquareQuote, Plug, RefreshCw, Send, ShieldCheck, SlidersHorizontal, Trash2, Unplug, UserRound, Users } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { ROLE_LABEL, type Member, type Role, type Stage } from "@/lib/types";
import { formatDateTime, relativeTime } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, Input, LoadingState, NoPermission, PageHeader, Select, Switch, Tabs, Textarea } from "@/components/ui";
import { StagesEditor } from "@/components/social/EditStagesDialog";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";
import { ACCOUNT_STATUS, type IntegrationAccount } from "@/components/social/AccountPill";

type Tab = "perfil" | "organizacao" | "equipe" | "funis" | "integracoes" | "respostas";

function Section({ title, description, children, actions }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold">{title}</h2>
          {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

function ProfileTab() {
  const me = useMe();
  return (
    <div className="flex flex-col gap-5">
    <Section title="Seu perfil">
      <div className="flex items-center gap-4">
        <Avatar name={me.user.name} size={64} tone="neutral" />
        <div>
          <p className="text-[17px] font-semibold">{me.user.name}</p>
          <p className="text-[14px] text-muted">{me.user.email}</p>
          <Badge tone="brand" className="mt-1">
            {ROLE_LABEL[me.user.role]} · {me.org.name}
          </Badge>
        </div>
      </div>
      <p className="mt-5 text-[13.5px] text-muted">Alterações de papel são feitas pelo administrador.</p>
    </Section>
    <ChangePassword />
    </div>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFields({});
    if (form.next.length < 10) return setFields({ next: "A nova senha precisa ter pelo menos 10 caracteres." });
    if (form.next !== form.confirm) return setFields({ confirm: "As senhas não conferem." });
    setLoading(true);
    try {
      await api.post("/api/me/password", { current: form.current, next: form.next });
      toast.success("Senha alterada. As outras sessões abertas foram encerradas.");
      setForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      const ae = err as ApiError;
      setFields(ae.fields);
      if (!Object.keys(ae.fields).length) toast.error(ae.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Section title="Alterar senha">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3 sm:items-end">
        <Field label="Senha atual" htmlFor="pw-cur" error={fields.current}>
          <Input id="pw-cur" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </Field>
        <Field label="Nova senha" htmlFor="pw-new" error={fields.next} hint="Mínimo de 10 caracteres.">
          <Input id="pw-new" type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        </Field>
        <Field label="Confirme a nova senha" htmlFor="pw-conf" error={fields.confirm}>
          <Input id="pw-conf" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <div className="sm:col-span-3 flex justify-end">
          <Button type="submit" loading={loading} disabled={!form.current || !form.next}>
            Salvar nova senha
          </Button>
        </div>
      </form>
    </Section>
  );
}

type OrgSettings = { name: string; timezone: string; isDemo: boolean; sharedInbox: boolean; autoEntryStageId: string | null; autoCreateFromMessages: boolean; autoCreateFromComments: boolean; retentionDaysAfterDisconnect: number | null; allowSignup: boolean };

function OrgTab() {
  const me = useMe();
  const { data, mutate } = useSWR<OrgSettings>("/api/settings/org", fetcher);
  const { data: stages } = useSWR<Stage[]>("/api/stages?kind=relationship", fetcher);
  const [name, setName] = useState("");
  useEffect(() => {
    if (data) setName(data.name);
  }, [data]);
  if (!data) return <LoadingState />;
  const save = async (patch: Partial<OrgSettings>) => {
    try {
      mutate(await api.patch<OrgSettings>("/api/settings/org", patch), { revalidate: false });
      toast.success("Configuração salva.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const admin = me.permissions.orgSettings;
  return (
    <div className="flex flex-col gap-5">
      <Section title="Organização" description={data.isDemo ? "Organização de demonstração: dados fictícios e envio externo desativado." : "Dados gerais. Datas exibidas em America/Bahia; valores em reais (BRL)."}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Nome" htmlFor="org-name" className="flex-1">
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!admin} />
          </Field>
          {admin && (
            <Button variant="secondary" onClick={() => save({ name })} disabled={name === data.name || name.trim().length < 2}>
              Salvar nome
            </Button>
          )}
        </div>
      </Section>
      {!data.isDemo && (
        <Section title="Acesso à equipe">
          <Switch
            checked={data.allowSignup}
            onChange={(v) => save({ allowSignup: v })}
            disabled={!admin}
            label="Permitir pedidos de acesso pela tela “Criar conta”"
            description="Quem se cadastra fica aguardando. Só entra depois que um administrador aprovar e escolher o papel em Equipe."
          />
        </Section>
      )}
      <Section title="Atendimento e entrada de contatos">
        <div className="divide-y divide-line">
          <Switch checked={data.sharedInbox} onChange={(v) => save({ sharedInbox: v })} disabled={!me.permissions.pipelineEdit} label="Caixa compartilhada" description="Sellers também veem conversas e comentários sem responsável. Por padrão, cada seller vê apenas os próprios registros." />
          <Switch checked={data.autoCreateFromMessages} onChange={(v) => save({ autoCreateFromMessages: v })} disabled={!admin} label="Criar contato ao receber mensagem" description="Remetente novo no Direct vira contato, deduplicado pelo identificador oficial do Instagram." />
          <Switch checked={data.autoCreateFromComments} onChange={(v) => save({ autoCreateFromComments: v })} disabled={!admin} label="Criar contato ao receber comentário" description="Desligado: comentários ficam na aba Comentários até alguém associar a um contato." />
          <div className="py-3">
            <Field label="Etapa de entrada automática" htmlFor="org-auto" hint="Onde o cartão é criado para contatos novos vindos do Instagram.">
              <Select id="org-auto" value={data.autoEntryStageId ?? ""} onChange={(e) => save({ autoEntryStageId: e.target.value || null })} disabled={!admin}>
                <option value="">Não criar cartão automaticamente</option>
                {stages?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="py-3">
            <Field label="Retenção após desconectar o Instagram" htmlFor="org-ret" hint="Política aplicada às mensagens e comentários quando a conta é desconectada (ver README → Retenção).">
              <Select id="org-ret" value={String(data.retentionDaysAfterDisconnect ?? "")} onChange={(e) => save({ retentionDaysAfterDisconnect: e.target.value ? Number(e.target.value) : null })} disabled={!admin}>
                <option value="">Manter os dados existentes</option>
                <option value="30">Excluir após 30 dias</option>
                <option value="90">Excluir após 90 dias</option>
                <option value="365">Excluir após 1 ano</option>
              </Select>
            </Field>
          </div>
        </div>
      </Section>
    </div>
  );
}

function PendingRequests({ requests, onChanged }: { requests: Member[]; onChanged: () => void }) {
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<Member | null>(null);
  const approve = async (m: Member) => {
    setBusy(m.userId);
    try {
      await api.post(`/api/team/${m.userId}/approve`, { role: roles[m.userId] ?? "seller" });
      toast.success(`${m.name} aprovado(a). Enviamos um e-mail avisando.`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const reject = async (m: Member) => {
    setBusy(m.userId);
    try {
      await api.post(`/api/team/${m.userId}/reject`);
      toast.success("Pedido recusado.");
      setConfirmReject(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title="Pedidos de acesso"
      description={requests.length ? "Pessoas que se cadastraram pela tela “Criar conta”. Escolha o papel e aprove, ou recuse." : "Quando alguém se cadastrar pela tela “Criar conta”, o pedido aparece aqui."}
    >
      {requests.length === 0 ? (
        <p className="text-[13.5px] text-muted">Nenhum pedido aguardando.</p>
      ) : (
        <ul className="divide-y divide-line">
          {requests.map((m) => (
            <li key={m.userId} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
              <div className="flex flex-1 items-start gap-3 min-w-0">
                <Avatar name={m.name} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-semibold">{m.name}</p>
                  <p className="truncate text-[12.5px] text-muted">
                    {m.email}
                    {m.requestedAt ? ` · pediu ${relativeTime(m.requestedAt).toLowerCase()}` : ""}
                  </p>
                  {m.requestNote && <p className="mt-1 text-[13px] text-ink">“{m.requestNote}”</p>}
                </div>
              </div>
              <Badge tone="warning">Aguardando</Badge>
              <div className="flex flex-wrap gap-2">
                <Select aria-label={`Papel para ${m.name}`} value={roles[m.userId] ?? "seller"} onChange={(e) => setRoles((r) => ({ ...r, [m.userId]: e.target.value as Role }))} className="h-9 w-auto text-[13px]">
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                <Button size="sm" loading={busy === m.userId} onClick={() => approve(m)}>
                  Aprovar
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === m.userId} onClick={() => setConfirmReject(m)}>
                  Recusar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!confirmReject}
        onOpenChange={(v) => !v && setConfirmReject(null)}
        size="sm"
        title="Recusar pedido de acesso?"
        description={confirmReject ? `${confirmReject.name} (${confirmReject.email}) não terá acesso. O cadastro feito por essa pessoa será removido.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReject(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={!!confirmReject && busy === confirmReject.userId} onClick={() => confirmReject && reject(confirmReject)}>
              Recusar
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </Section>
  );
}

function TeamTab() {
  const me = useMe();
  const { data, mutate } = useSWR<Member[]>("/api/team", fetcher);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "seller" as Role });
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [shareLink, setShareLink] = useState<{ title: string; person: string; link: string } | null>(null);
  const invite = async () => {
    setLoading(true);
    try {
      const r = await api.post<{ emailed: boolean; link?: string }>("/api/team", form);
      if (r.emailed) toast.success("Convite enviado por e-mail.");
      else if (r.link) setShareLink({ title: "Convite criado", person: form.name, link: r.link });
      setOpen(false);
      setForm({ name: "", email: "", role: "seller" });
      mutate();
    } catch (e) {
      setFields((e as ApiError).fields);
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const update = async (m: Member, patch: { role?: Role; status?: "active" | "disabled" }) => {
    if (patch.status === "disabled" && !confirm(`Desativar ${m.name}? A pessoa perde o acesso imediatamente.`)) return;
    try {
      await api.patch(`/api/team/${m.userId}`, patch);
      toast.success("Equipe atualizada.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const resend = async (m: Member) => {
    try {
      const r = await api.post<{ emailed: boolean; link?: string }>(`/api/team/${m.userId}/resend`);
      if (r.emailed) toast.success("Convite reenviado.");
      else if (r.link) setShareLink({ title: "Novo link de convite", person: m.name, link: r.link });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const accessLink = async (m: Member) => {
    try {
      const r = await api.post<{ link: string }>(`/api/team/${m.userId}/access-link`);
      setShareLink({ title: "Link para criar nova senha", person: m.name, link: r.link });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!data) return <LoadingState />;
  const admin = me.permissions.teamManage;
  const pending = data.filter((m) => m.status === "pending");
  const members = data.filter((m) => m.status !== "pending");
  return (
    <div className="flex flex-col gap-5">
      {admin && <PendingRequests requests={pending} onChanged={() => mutate()} />}
    <Section
      title="Equipe"
      description="Pessoas entram por convite do administrador ou por pedido de acesso aprovado."
      actions={
        admin && (
          <Button icon={<Send className="size-4" />} onClick={() => setOpen(true)}>
            Convidar pessoa
          </Button>
        )
      }
    >
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-3 min-w-0">
              <Avatar name={m.name} size={40} />
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-semibold">
                  {m.name} {m.userId === me.user.id && <span className="font-normal text-muted">(você)</span>}
                </p>
                <p className="truncate text-[12.5px] text-muted">
                  {m.email ?? ROLE_LABEL[m.role]}
                  {m.lastLoginAt ? ` · último acesso ${relativeTime(m.lastLoginAt)}` : ""}
                </p>
              </div>
            </div>
            <Badge tone={m.status === "active" ? "success" : m.status === "invited" ? "info" : "neutral"}>{m.status === "active" ? "Ativo" : m.status === "invited" ? "Convite pendente" : "Desativado"}</Badge>
            {admin ? (
              <div className="flex flex-wrap gap-2">
                <Select aria-label={`Papel de ${m.name}`} value={m.role} onChange={(e) => update(m, { role: e.target.value as Role })} className="h-9 w-auto text-[13px]" disabled={m.userId === me.user.id}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                {m.status === "invited" && (
                  <Button size="sm" variant="secondary" onClick={() => resend(m)}>
                    Reenviar
                  </Button>
                )}
                {m.status === "active" && m.userId !== me.user.id && (
                  <Button size="sm" variant="ghost" onClick={() => accessLink(m)}>
                    Link de nova senha
                  </Button>
                )}
                {m.status === "active" && m.userId !== me.user.id && (
                  <Button size="sm" variant="ghost" onClick={() => update(m, { status: "disabled" })}>
                    Desativar
                  </Button>
                )}
                {m.status === "disabled" && (
                  <Button size="sm" variant="ghost" onClick={() => update(m, { status: "active" })}>
                    Reativar
                  </Button>
                )}
              </div>
            ) : (
              <Badge>{ROLE_LABEL[m.role]}</Badge>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-5 grid gap-3 rounded-[16px] bg-page/70 p-4 text-[13px] text-muted sm:grid-cols-2">
        <p>
          <strong className="text-ink">Administrador:</strong> equipe, integrações, etapas, configurações e todos os dados.
        </p>
        <p>
          <strong className="text-ink">Gestor:</strong> visão da equipe, distribuição, relatórios e funis; sem acesso a segredos.
        </p>
        <p>
          <strong className="text-ink">Social seller:</strong> contatos, conversas e tarefas atribuídos a ele.
        </p>
        <p>
          <strong className="text-ink">Closer:</strong> oportunidades e contatos atribuídos; reuniões, ganhos e perdas.
        </p>
      </div>
      <Dialog
        open={!!shareLink}
        onOpenChange={(v) => !v && setShareLink(null)}
        title={shareLink?.title ?? ""}
        description={shareLink ? `Envie este link para ${shareLink.person} (WhatsApp, e-mail…). Ele é pessoal e de uso único.` : undefined}
        footer={<Button onClick={() => setShareLink(null)}>Concluir</Button>}
      >
        {shareLink && <Copyable label="Link" value={shareLink.link} />}
      </Dialog>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Convidar pessoa"
        description="Enviaremos um link de uso único, válido por 7 dias, para a pessoa criar a senha."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={invite} loading={loading}>
              Enviar convite
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Nome" htmlFor="inv-name" error={fields.name}>
            <Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="E-mail" htmlFor="inv-email" error={fields.email}>
            <Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Papel" htmlFor="inv-role">
            <Select id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
    </Section>
    </div>
  );
}

function FunnelsTab() {
  const me = useMe();
  if (!me.permissions.pipelineEdit) return <NoPermission message="Somente administradores e gestores editam a estrutura dos funis. Você pode mover seus cartões normalmente." />;
  return (
    <div className="flex flex-col gap-5">
      <Section title="Funil de relacionamento (Social Seller)" description="Etapas do Kanban. Mudar a etapa de um cartão é diferente de editar a estrutura do funil.">
        <StagesEditor kind="relationship" />
      </Section>
      <Section title="Funil comercial" description="Etapas das oportunidades acompanhadas pelos closers.">
        <StagesEditor kind="sales" />
      </Section>
    </div>
  );
}

type IntegrationsData = {
  accounts: (IntegrationAccount & { grantedScopes: string[]; webhooksSubscribed: boolean; tokenExpiresAt: string | null; connectedAt: string | null; lastCheckedAt: string | null; authRoute: string; capabilities: Record<string, boolean> })[];
  instagram: { configured: boolean; missing: string[]; httpsPublic: boolean; redirectUri: string; webhookUrl: string; graphVersion: string; humanAgentEnabled: boolean } | null;
  mail: { mode: string; ready: boolean; note: string } | null;
};

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="flex items-center gap-2 rounded-[12px] border border-line bg-page/60 px-3 py-2">
        <code className="flex-1 truncate text-[12.5px]">{value}</code>
        <button
          onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copiado."))}
          className="text-muted hover:text-ink"
          aria-label={`Copiar ${label}`}
        >
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}

const CAP_LABEL: Record<string, string> = {
  receiveMessages: "Receber mensagens do Direct",
  sendMessages: "Responder mensagens (janela do provedor)",
  readComments: "Ler comentários das mídias da conta",
  replyComments: "Responder comentários publicamente",
  privateReplies: "Resposta privada a comentários (até 7 dias, 1 por comentário)",
  humanAgentTag: "Tag de atendimento humano (fora das 24 h)",
};

function IntegrationsTab() {
  const me = useMe();
  const sp = useSearchParams();
  const { data, mutate } = useSWR<IntegrationsData>("/api/integrations", fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const st = sp.get("instagram");
    if (!st) return;
    if (st === "connected") toast.success("Instagram conectado e verificado.");
    else if (st === "erro") toast.error(sp.get("motivo") ?? "Não foi possível conectar.");
    else toast.warning(`Conexão concluída com status: ${ACCOUNT_STATUS[st as IntegrationAccount["status"]]?.label ?? st}.`);
  }, [sp]);
  if (!data) return <LoadingState />;
  const account = data.accounts.find((a) => a.status !== "disconnected");
  const admin = me.permissions.integrations;

  const connect = async () => {
    setBusy("connect");
    try {
      const { url } = await api.post<{ url: string }>("/api/integrations/instagram/connect");
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };
  const test = async (id: string) => {
    setBusy("test");
    try {
      const r = await api.post<IntegrationAccount>(`/api/integrations/${id}/test`);
      toast[r.status === "connected" ? "success" : "warning"](`Status: ${ACCOUNT_STATUS[r.status].label}`);
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async (id: string) => {
    if (!confirm("Desconectar o Instagram? Novos envios e eventos param imediatamente. Os dados existentes seguem a política de retenção.")) return;
    setBusy("disconnect");
    try {
      await api.post(`/api/integrations/${id}/disconnect`);
      toast.success("Instagram desconectado.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Instagram (API oficial da Meta)"
        description="Rota: Instagram API com Login do Instagram (graph.instagram.com). O CRMLABS nunca pede a senha do Instagram."
        actions={
          admin && !me.org.isDemo ? (
            account ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={busy === "test"} onClick={() => test(account.id)}>
                  Testar conexão
                </Button>
                {account.status !== "connected" && (
                  <Button icon={<Plug className="size-4" />} loading={busy === "connect"} onClick={connect} disabled={!data.instagram?.configured}>
                    Reconectar
                  </Button>
                )}
                <Button variant="ghost" icon={<Unplug className="size-4" />} loading={busy === "disconnect"} onClick={() => disconnect(account.id)}>
                  Desconectar
                </Button>
              </div>
            ) : (
              <Button icon={<Plug className="size-4" />} loading={busy === "connect"} onClick={connect} disabled={!data.instagram?.configured}>
                Conectar Instagram
              </Button>
            )
          ) : null
        }
      >
        {me.org.isDemo && <p className="mb-4 rounded-[14px] bg-warning-soft px-4 py-3 text-[13.5px] text-[#6b4a00]">Organização de demonstração: contas reais não podem ser conectadas aqui. Use a organização real.</p>}
        <div className="flex items-center gap-4 rounded-[18px] border border-line p-4">
          <InstagramGlyph size={36} />
          <div className="flex-1 min-w-0">
            <p className="text-[15.5px] font-semibold">{account?.username ? `@${account.username}` : "Nenhuma conta conectada"}</p>
            <p className="text-[12.5px] text-muted">
              {account
                ? `Conectada ${account.connectedAt ? formatDateTime(account.connectedAt) : ""} · verificada ${account.lastCheckedAt ? relativeTime(account.lastCheckedAt) : "—"}${account.tokenExpiresAt ? ` · token renova até ${formatDateTime(account.tokenExpiresAt)}` : ""}`
                : "Cenário inicial previsto: @olucaoferraz (conta profissional)."}
            </p>
            {account?.lastError && <p className="mt-1 text-[12.5px] text-danger">{account.lastError}</p>}
          </div>
          <Badge tone={account ? ACCOUNT_STATUS[account.status].tone : "neutral"}>{account ? ACCOUNT_STATUS[account.status].label : "Desconectado"}</Badge>
        </div>

        {account && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(CAP_LABEL).map(([k, label]) => (
              <li key={k} className="flex items-center gap-2 text-[13.5px]">
                {account.capabilities[k] ? <CircleCheck className="size-4 text-success" aria-label="Disponível" /> : <CircleX className="size-4 text-muted" aria-label="Indisponível" />}
                {label}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 rounded-[16px] bg-page/70 p-4 text-[13px] text-muted">
          <p className="font-semibold text-ink">Fora do escopo oficial validado</p>
          <p className="mt-1">
            Assistir e interagir com stories de terceiros, importar todos os seguidores, histórico integral de conversas e prospecção irrestrita por DM não são oferecidos. Menções e respostas a stories da própria conta chegam como mensagens quando a API as entrega.
          </p>
        </div>

        {admin && data.instagram && (
          <div className="mt-5 flex flex-col gap-4">
            <p className="text-[14px] font-semibold">Configuração do servidor</p>
            <ul className="flex flex-col gap-2 text-[13.5px]">
              <li className="flex items-center gap-2">
                {data.instagram.configured ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}
                {data.instagram.configured ? "Credenciais do app configuradas" : `Faltam variáveis: ${data.instagram.missing.join(", ")}`}
              </li>
              <li className="flex items-center gap-2">
                {data.instagram.httpsPublic ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}
                {data.instagram.httpsPublic ? "URL pública HTTPS para callback e webhooks" : "APP_URL precisa ser HTTPS público para o OAuth e os webhooks da Meta"}
              </li>
              <li className="flex items-center gap-2 text-muted">
                <ShieldCheck className="size-4" /> Graph API {data.instagram.graphVersion} · tokens criptografados (AES-256-GCM) somente no servidor
              </li>
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <Copyable label="URI de redirecionamento OAuth" value={data.instagram.redirectUri} />
              <Copyable label="URL de callback dos webhooks" value={data.instagram.webhookUrl} />
              <Copyable label="Callback de desautorização" value={data.instagram.webhookUrl + "/deauthorize"} />
              <Copyable label="Callback de exclusão de dados" value={data.instagram.webhookUrl + "/data-deletion"} />
            </div>
            <p className="text-[12.5px] text-muted">Campos de webhook a assinar no app: messages, comments. Passo a passo completo no README (“Configurar o Instagram”).</p>
          </div>
        )}
      </Section>
      {admin && data.mail && (
        <Section title="E-mail transacional" description="Usado para convites e recuperação de senha.">
          <p className="flex items-center gap-2 text-[14px]">
            {data.mail.ready ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}
            {data.mail.mode === "console" ? "Modo desenvolvimento (console)" : "SMTP"} — {data.mail.note}
          </p>
        </Section>
      )}
    </div>
  );
}

function SavedRepliesTab() {
  const me = useMe();
  const { data, mutate } = useSWR<{ id: string; title: string; body: string }[]>("/api/saved-replies", fetcher);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const add = async () => {
    try {
      await api.post("/api/saved-replies", { title, body });
      setTitle("");
      setBody("");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const del = async (id: string) => {
    try {
      await api.del(`/api/saved-replies/${id}`);
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Section title="Respostas salvas" description="Textos prontos para agilizar respostas no Direct. Revise antes de enviar.">
      {!data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <EmptyState icon={<MessageSquareQuote />} title="Nenhuma resposta salva" />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-[14px] border border-line px-4 py-3">
              <div className="flex-1">
                <p className="text-[14px] font-semibold">{r.title}</p>
                <p className="text-[13.5px] text-muted whitespace-pre-wrap">{r.body}</p>
              </div>
              {me.permissions.savedReplies && (
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => del(r.id)}>
                  Excluir
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {me.permissions.savedReplies && (
        <div className="mt-4 flex flex-col gap-3 rounded-[16px] border border-dashed border-[#bfd6cf] p-4">
          <Field label="Título" htmlFor="sr-title">
            <Input id="sr-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Texto" htmlFor="sr-body">
            <Textarea id="sr-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
          </Field>
          <div className="flex justify-end">
            <Button onClick={add} disabled={!title.trim() || !body.trim()}>
              Adicionar resposta
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

export function SettingsView() {
  const me = useMe();
  const [tab, setTab] = useQueryParam("aba", me.permissions.dataAll ? "organizacao" : "perfil");
  const items: { value: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { value: "perfil", label: "Perfil", icon: <UserRound />, show: true },
    { value: "organizacao", label: "Organização", icon: <Building />, show: me.permissions.dataAll },
    { value: "equipe", label: "Equipe", icon: <Users />, show: true },
    { value: "funis", label: "Funis", icon: <SlidersHorizontal />, show: me.permissions.pipelineEdit },
    { value: "integracoes", label: "Integrações", icon: <Plug />, show: true },
    { value: "respostas", label: "Respostas salvas", icon: <MessageSquareQuote />, show: true },
  ];
  const visible = items.filter((i) => i.show);
  const current = (visible.some((i) => i.value === tab) ? tab : visible[0].value) as Tab;
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <PageHeader title="Configurações" subtitle="Equipe, funis, integrações e preferências da organização." />
      <Tabs value={current} onChange={(v) => setTab(v)} items={visible.map(({ value, label, icon }) => ({ value, label, icon }))} />
      {current === "perfil" && <ProfileTab />}
      {current === "organizacao" && <OrgTab />}
      {current === "equipe" && <TeamTab />}
      {current === "funis" && <FunnelsTab />}
      {current === "integracoes" && <IntegrationsTab />}
      {current === "respostas" && <SavedRepliesTab />}
    </div>
  );
}
