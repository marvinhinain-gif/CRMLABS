"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarCheck, ExternalLink, KeyRound } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { Badge, Button, Card, Field, Input, LoadingState } from "@/components/ui";
import { Copyable } from "@/components/settings/Copyable";

type Setup = { configured: boolean; clientId: string; fromEnv: boolean; redirectUri: string; origin: string };

/** Administrador liga o Google uma vez; depois cada closer conecta a própria agenda no perfil. */
export function GoogleCalendarSetup() {
  const { data, mutate } = useSWR<Setup>("/api/calendar/google/setup", fetcher);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setClientId(data.clientId);
  }, [data]);
  if (!data) return <LoadingState rows={2} />;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFields({});
    try {
      mutate(await api.put<Setup>("/api/calendar/google/setup", { clientId, clientSecret: secret }), { revalidate: false });
      setSecret("");
      toast.success("Google ligado. Agora cada closer conecta a própria agenda em Configurações → Perfil.");
    } catch (err) {
      setFields((err as ApiError).fields);
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-info-soft text-info" aria-hidden>
            <CalendarCheck className="size-5" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Agenda dos closers (Google Agenda)</h2>
            <p className="text-[13.5px] text-muted">Reuniões entram na agenda de quem vai atender, com link do Meet e aviso de conflito de horário.</p>
          </div>
        </div>
        <Badge tone={data.configured ? "success" : "warning"} className="self-start">
          {data.configured ? "Pronto para os closers" : "Falta ligar o Google"}
        </Badge>
      </div>
      <p className="mt-3 rounded-[14px] bg-page/70 px-4 py-3 text-[13px] text-muted">
        Sem esta etapa, cada pessoa ainda pode assinar a própria agenda pelo <b>link de assinatura</b> em Configurações → Perfil → Minha agenda (funciona com Google, iPhone e Outlook, só leitura).
      </p>
      {data.fromEnv ? (
        <p className="mt-3 text-[13px]">Credenciais definidas nas variáveis do servidor.</p>
      ) : (
        <details className="mt-3" open={!data.configured}>
          <summary className="cursor-pointer text-[14px] font-semibold">Como ligar (uma vez)</summary>
          <ol className="mt-3 flex flex-col gap-2 text-[13.5px]">
            <li>
              1. Em{" "}
              <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
                Google Cloud <ExternalLink className="inline size-3.5" aria-hidden />
              </a>
              , crie um projeto e ative a <b>Google Calendar API</b>.
            </li>
            <li>
              2. Em <b>Tela de consentimento OAuth</b>, escolha <b>Externo</b>, preencha nome e e-mail e adicione os closers como <b>usuários de teste</b>.
            </li>
            <li>
              3. Em <b>Credenciais → Criar credenciais → ID do cliente OAuth</b>, tipo <b>Aplicativo da Web</b>, com estes dados:
            </li>
          </ol>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Copyable label="Origem JavaScript autorizada" value={data.origin} />
            <Copyable label="URI de redirecionamento autorizado" value={data.redirectUri} />
          </div>
          <p className="mt-3 text-[13.5px]">4. Cole o ID e a chave secreta do cliente:</p>
          <form onSubmit={save} className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
            <Field label="ID do cliente" htmlFor="g-client" error={fields.clientId}>
              <Input id="g-client" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off" />
            </Field>
            <Field label="Chave secreta do cliente" htmlFor="g-secret" error={fields.clientSecret} hint={data.configured ? "Já salva. Em branco mantém." : "Fica criptografada."}>
              <Input id="g-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} icon={<KeyRound />} autoComplete="off" />
            </Field>
            <Button type="submit" loading={busy} className="sm:mt-[27px]" disabled={!clientId || (!secret && !data.configured)}>
              Salvar
            </Button>
          </form>
        </details>
      )}
    </Card>
  );
}
