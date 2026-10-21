"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Download, ExternalLink, KeyRound, RefreshCw, ShoppingBag } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";
import { Badge, Button, Card, Field, Input, LoadingState, Select } from "@/components/ui";
import { Copyable } from "@/components/settings/Copyable";

type Setup = {
  webhookUrl: string | null;
  webhookSecret: "panel" | "env" | "missing";
  api: "panel" | "env" | "missing";
  lastEventAt: string | null;
  lastImportAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  orders: number;
  paidOrders: number;
};

/** Cakto: cada venda paga entra no Dashboard pelo webhook. A chave da API é opcional (importar vendas antigas). */
export function CaktoSetup() {
  const { data, mutate } = useSWR<Setup>("/api/checkout/cakto", fetcher);
  const [secret, setSecret] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [days, setDays] = useState("90");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <LoadingState rows={2} />;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setFields({});
    try {
      await fn();
    } catch (err) {
      setFields((err as ApiError).fields ?? {});
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const saveSecret = (e: React.FormEvent) => {
    e.preventDefault();
    run("secret", async () => {
      mutate(await api.put<Setup>("/api/checkout/cakto", { webhookSecret: secret }), { revalidate: false });
      setSecret("");
      toast.success("Segredo do webhook salvo.");
    });
  };
  const saveApi = (e: React.FormEvent) => {
    e.preventDefault();
    run("api", async () => {
      mutate(await api.put<Setup>("/api/checkout/cakto", { clientId, clientSecret }), { revalidate: false });
      setClientId("");
      setClientSecret("");
      toast.success("Chave da API salva (criptografada).");
    });
  };
  const doImport = () =>
    run("import", async () => {
      const r = await api.post<{ imported: number; paid: number }>("/api/checkout/cakto/import", { days: Number(days) });
      toast.success(`${r.imported} pedido(s) conferidos, ${r.paid} pagos. Já aparecem no Dashboard.`);
      mutate();
    });
  const regenerate = () => {
    if (!confirm("Gerar um endereço novo? O endereço atual para de funcionar e você precisa trocar a URL na Cakto.")) return;
    run("url", async () => {
      mutate(await api.post<Setup>("/api/checkout/cakto/url"), { revalidate: false });
      toast.success("Endereço novo gerado. Atualize a URL do webhook na Cakto.");
    });
  };

  const receiving = !!data.lastEventAt;
  const errorIsLatest = data.lastErrorAt && (!data.lastEventAt || data.lastErrorAt > data.lastEventAt);
  return (
    <Card className="p-5 sm:p-6">
      <div id="cakto" className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-selected text-brand" aria-hidden>
            <ShoppingBag className="size-5" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Cakto (vendas)</h2>
            <p className="text-[13.5px] text-muted">Cada pagamento aprovado entra no Dashboard com valor, produto, comprador e origem. Reembolso e chargeback saem do total sozinhos.</p>
          </div>
        </div>
        <Badge tone={errorIsLatest ? "danger" : receiving ? "success" : "warning"} className="self-start">
          {errorIsLatest ? "Último envio recusado" : receiving ? `Conectada · ${relativeTime(data.lastEventAt).toLowerCase()}` : "Aguardando a Cakto"}
        </Badge>
      </div>
      {receiving && (
        <p className="mt-2 text-[13px] text-muted">
          {data.paidOrders} venda{data.paidOrders === 1 ? "" : "s"} paga{data.paidOrders === 1 ? "" : "s"} recebida{data.paidOrders === 1 ? "" : "s"} até agora.
        </p>
      )}
      {errorIsLatest && data.lastError && (
        <p className="mt-3 rounded-[14px] bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {data.lastError} <span className="text-muted">({formatDateTime(data.lastErrorAt)})</span>
        </p>
      )}

      <details className="mt-3" open={!receiving}>
        <summary className="cursor-pointer text-[14px] font-semibold">Como conectar (uma vez, uns 2 minutos)</summary>
        <ol className="mt-3 flex flex-col gap-2 text-[13.5px]">
          <li>1. Copie o endereço abaixo.</li>
        </ol>
        {data.webhookUrl && (
          <div className="mt-2">
            <Copyable label="URL do webhook (não compartilhe)" value={data.webhookUrl} />
          </div>
        )}
        <ol className="mt-3 flex flex-col gap-2 text-[13.5px]">
          <li>
            2. Na{" "}
            <a href="https://app.cakto.com.br/dashboard/apps" target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
              Cakto <ExternalLink className="inline size-3.5" aria-hidden />
            </a>
            , vá em <b>Integrações → Webhooks → Adicionar</b>, cole a URL e escolha <b>todos os produtos</b>.
          </li>
          <li>
            3. Marque os eventos <b>Compra aprovada</b>, <b>Reembolso</b> e <b>Chargeback</b> e salve.
          </li>
          <li>
            4. Se a Cakto mostrar a opção de <b>enviar um evento de teste</b>, use-a; se não, a primeira venda já conecta. Quando o selo aqui em cima ficar verde, está pronto: o CRM guarda o segredo da Cakto sozinho no primeiro envio.
          </li>
        </ol>
        <p className="mt-3 rounded-[14px] bg-page/70 px-4 py-3 text-[13px] text-muted">
          <b className="text-ink">Para saber de onde veio cada venda</b>, use links de checkout com UTM, por exemplo <code>?utm_source=stories</code>, <code>?utm_source=whatsapp</code> ou <code>?utm_source=trafego&amp;utm_campaign=nome-da-campanha</code>. O CRM liga o utm_source à origem de mesmo nome (Stories, WhatsApp, Tráfego Pago…). Sem UTM, vale a origem que o CRM já conhecia do comprador.
        </p>
        <form onSubmit={saveSecret} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
          <Field
            label="Segredo do webhook (opcional)"
            htmlFor="cakto-secret"
            error={fields.webhookSecret}
            hint={data.webhookSecret === "panel" ? "Já salvo. Colar outro substitui." : data.webhookSecret === "env" ? "Definido nas variáveis do servidor." : "Só se quiser colar antes do primeiro envio. Fica criptografado."}
          >
            <Input id="cakto-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} icon={<KeyRound />} autoComplete="off" />
          </Field>
          <Button type="submit" variant="secondary" loading={busy === "secret"} className="sm:mt-[27px]" disabled={!secret}>
            Salvar segredo
          </Button>
        </form>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer text-[14px] font-semibold">Trazer vendas antigas (opcional)</summary>
        <p className="mt-2 text-[13.5px] text-muted">
          Na Cakto, em <b>Integrações → Cakto API → Criar Chave de API</b>, marque a leitura de <b>pedidos</b> e cole aqui o Client ID e o Client Secret. Eles ficam criptografados no CRM e nunca aparecem de novo.
        </p>
        {data.api === "missing" ? (
          <form onSubmit={saveApi} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
            <Field label="Client ID" htmlFor="cakto-cid" error={fields.clientId}>
              <Input id="cakto-cid" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Client Secret" htmlFor="cakto-csecret" error={fields.clientSecret}>
              <Input id="cakto-csecret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} icon={<KeyRound />} autoComplete="off" />
            </Field>
            <Button type="submit" loading={busy === "api"} className="sm:mt-[27px]" disabled={!clientId || !clientSecret}>
              Salvar chave
            </Button>
          </form>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Período" htmlFor="cakto-days">
              <Select id="cakto-days" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="180">Últimos 6 meses</option>
                <option value="365">Último ano</option>
              </Select>
            </Field>
            <Button icon={<Download className="size-4" />} loading={busy === "import"} onClick={doImport}>
              Importar vendas
            </Button>
            {data.api === "panel" && (
              <Button variant="ghost" size="sm" onClick={() => run("clear", async () => void mutate(await api.put<Setup>("/api/checkout/cakto", { clear: "api" }), { revalidate: false }))}>
                Remover chave
              </Button>
            )}
            {data.lastImportAt && <span className="text-[12.5px] text-muted">Última importação: {formatDateTime(data.lastImportAt)}</span>}
          </div>
        )}
      </details>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" icon={<RefreshCw className="size-4" />} loading={busy === "url"} onClick={regenerate}>
          Gerar novo endereço
        </Button>
      </div>
    </Card>
  );
}
