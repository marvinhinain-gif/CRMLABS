"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CircleCheck, ExternalLink, KeyRound, Lock } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { Badge, Button, Card, Field, Input, LoadingState } from "@/components/ui";
import { Copyable } from "./Copyable";

type SetupState = {
  canEdit: boolean;
  appId: string;
  appIdSource: "env" | "panel" | "missing";
  appSecretSet: boolean;
  appSecretSource: "env" | "panel" | "missing";
  verifyToken: string;
  encryptionReady: boolean;
};

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="group relative flex gap-3.5 pb-6 last:pb-0">
      <span className="absolute left-[15px] top-9 bottom-0 w-px bg-line group-last:hidden" aria-hidden />
      <span
        className={`relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${done ? "bg-brand text-white" : "bg-selected text-brand"}`}
        aria-hidden
      >
        {done ? <CircleCheck className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-[14.5px] font-semibold">{title}</p>
        <div className="mt-1.5 flex flex-col gap-3 text-[13.5px] text-muted">{children}</div>
      </div>
    </li>
  );
}

/**
 * Assistente para ligar o CRMLABS a um app da Meta (Instagram API com Login do Instagram).
 * As credenciais ficam no servidor, criptografadas; a chave secreta nunca é exibida de volta.
 */
export function InstagramSetup({ redirectUri, webhookUrl, connected, onSaved }: { redirectUri: string; webhookUrl: string; connected: boolean; onSaved: () => void }) {
  const { data, mutate } = useSWR<SetupState>("/api/integrations/instagram/credentials", fetcher);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setAppId(data.appId);
  }, [data]);
  if (!data) return <LoadingState rows={3} />;
  const origin = new URL(redirectUri).origin;
  const fromEnv = data.appIdSource === "env" || data.appSecretSource === "env";
  const credsDone = !!data.appId && data.appSecretSet;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFields({});
    setSaving(true);
    try {
      mutate(await api.put<SetupState>("/api/integrations/instagram/credentials", { appId, appSecret }), { revalidate: false });
      setAppSecret("");
      toast.success("Credenciais salvas com segurança. Agora faça os passos 3 e 4 no painel da Meta.");
      onSaved();
    } catch (err) {
      const ae = err as ApiError;
      setFields(ae.fields);
      if (!Object.keys(ae.fields).length) toast.error(ae.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold">Ligar o app da Meta</h2>
          <p className="mt-1 text-[13.5px] text-muted">Faça uma vez. Depois disso, o botão “Conectar Instagram” leva ao login oficial do Instagram.</p>
        </div>
        <Badge tone={credsDone ? "success" : "warning"} className="self-start">
          {credsDone ? "Credenciais salvas" : "Aguardando credenciais"}
        </Badge>
      </div>

      {!data.canEdit ? (
        <p className="rounded-[14px] bg-page/70 px-4 py-3 text-[13.5px] text-muted">
          <Lock className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
          Só o administrador da organização principal configura o app da Meta.
        </p>
      ) : (
        <ol className="flex flex-col">
          <Step n={1} title="Crie o app na Meta" done={credsDone}>
            <p>
              Em <b className="text-ink">developers.facebook.com</b> → Meus apps → Criar app. Escolha o caso de uso de <b className="text-ink">Instagram</b> (gerenciar mensagens e conteúdo) e o tipo <b className="text-ink">Empresa</b>.
            </p>
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 font-semibold text-brand hover:underline">
              Abrir o painel da Meta <ExternalLink className="size-4" aria-hidden />
            </a>
          </Step>

          <Step n={2} title="Cole as credenciais do Instagram aqui" done={credsDone}>
            <p>
              No app, abra <b className="text-ink">Instagram → Configuração da API com login do Instagram</b> e copie o <b className="text-ink">ID do app do Instagram</b> e a <b className="text-ink">Chave secreta do app do Instagram</b> (não use o ID do app do Facebook).
            </p>
            {fromEnv ? (
              <p className="rounded-[12px] bg-page/70 px-3 py-2">Definidas nas variáveis de ambiente do servidor (ID {data.appId || "—"}).</p>
            ) : !data.encryptionReady ? (
              <p className="rounded-[12px] bg-danger-soft px-3 py-2 text-danger">O servidor está sem ENCRYPTION_KEY: não é possível guardar a chave secreta.</p>
            ) : (
              <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
                <Field label="ID do app do Instagram" htmlFor="ig-app-id" error={fields.appId}>
                  <Input id="ig-app-id" inputMode="numeric" autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="Ex.: 1234567890123456" />
                </Field>
                <Field label="Chave secreta do app" htmlFor="ig-app-secret" error={fields.appSecret} hint={data.appSecretSet ? "Já salva. Deixe em branco para manter." : "Fica criptografada no servidor."}>
                  <Input
                    id="ig-app-secret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    placeholder={data.appSecretSet ? "••••••••••••••••" : "32 caracteres"}
                    icon={<KeyRound />}
                  />
                </Field>
                <Button type="submit" loading={saving} className="sm:mt-[27px]" disabled={!appId || (!appSecret && !data.appSecretSet)}>
                  Salvar
                </Button>
              </form>
            )}
          </Step>

          <Step n={3} title="Configure os webhooks na Meta">
            <p>
              Em <b className="text-ink">Configurar webhooks</b>, cole a URL e o token abaixo, clique em <b className="text-ink">Verificar e salvar</b> e assine os campos <b className="text-ink">messages</b> e <b className="text-ink">comments</b>.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Copyable label="URL de callback" value={webhookUrl} />
              {data.verifyToken ? <Copyable label="Token de verificação" value={data.verifyToken} /> : <p className="text-[12.5px]">O token aparece depois de salvar o passo 2.</p>}
            </div>
          </Step>

          <Step n={4} title="Configure o login do Instagram na Meta">
            <p>
              Em <b className="text-ink">Configurar login comercial do Instagram</b>, adicione a URI de redirecionamento. Nas configurações do app, informe também a política de privacidade e os callbacks de desautorização e exclusão de dados.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Copyable label="URI de redirecionamento OAuth" value={redirectUri} />
              <Copyable label="Política de privacidade" value={`${origin}/privacidade`} />
              <Copyable label="Callback de desautorização" value={`${webhookUrl}/deauthorize`} />
              <Copyable label="Callback de exclusão de dados" value={`${webhookUrl}/data-deletion`} />
            </div>
          </Step>

          <Step n={5} title="Libere a sua conta e conecte" done={connected}>
            <p>
              Enquanto o app estiver em modo de desenvolvimento, adicione a conta em <b className="text-ink">Funções do app → Testadores do Instagram</b> e aceite o convite no Instagram (Configurações → Apps e sites). A conta precisa ser <b className="text-ink">profissional</b> (empresa ou criador).
            </p>
            <p>
              Depois, clique em <b className="text-ink">Conectar Instagram</b> acima. Para receber mensagens de qualquer pessoa, a Meta exige o acesso avançado (análise do app); até lá, só contas com função no app funcionam.
            </p>
          </Step>
        </ol>
      )}
      <p className="mt-5 text-[12px] text-muted">Os nomes dos menus no painel da Meta podem variar um pouco. O CRMLABS nunca pede a senha do Instagram.</p>
    </Card>
  );
}
