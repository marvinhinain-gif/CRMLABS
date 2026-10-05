"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { Copyable } from "@/components/settings/Copyable";
import type { Integration } from "./shared";

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-2 text-[13.5px]">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-selected text-[12px] font-semibold text-brand" aria-hidden>
            {i + 1}
          </span>
          <span className="pt-0.5">{it}</span>
        </li>
      ))}
    </ol>
  );
}

function Code({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <pre className="max-h-[260px] overflow-auto rounded-[14px] bg-[#0f1f1a] p-4 pr-12 text-[12px] leading-relaxed text-[#d7f5e7]">{code}</pre>
      <button
        onClick={() => navigator.clipboard.writeText(code).then(() => toast.success("Copiado."))}
        className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-[10px] bg-white/10 text-white hover:bg-white/20"
        aria-label={`Copiar ${label}`}
      >
        <Copy className="size-4" />
      </button>
    </div>
  );
}

function SecretBox({ integration, onChanged, hint }: { integration: Integration; onChanged: (i: Integration) => void; hint: string }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    setBusy(true);
    try {
      onChanged(await api.put<Integration>(`/api/lead-integrations/${integration.id}/secret`, { secret: value }));
      setSecret("");
      toast.success(value ? "Segredo salvo. Envios sem a assinatura correta serão recusados." : "Assinatura desligada.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-[16px] border border-line p-3.5">
      <p className="flex items-center gap-1.5 text-[13.5px] font-semibold">
        <KeyRound className="size-4" aria-hidden /> Assinatura {integration.hasSigningSecret ? <span className="font-normal text-success">· ativa</span> : <span className="font-normal text-muted">· opcional</span>}
      </p>
      <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>
      <div className="mt-2 flex gap-2">
        <Input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={integration.hasSigningSecret ? "Novo segredo (substitui o atual)" : "Cole ou invente um segredo"} />
        <Button size="sm" onClick={() => save(secret)} loading={busy} disabled={secret.trim().length < 8}>
          Salvar
        </Button>
        {integration.hasSigningSecret && (
          <Button size="sm" variant="ghost" onClick={() => save("")} disabled={busy}>
            Remover
          </Button>
        )}
      </div>
    </div>
  );
}

/** Como ligar a ferramenta ao CRMLABS, em linguagem simples. */
export function ConnectGuide({ integration, onChanged }: { integration: Integration; onChanged: (i: Integration) => void }) {
  const url = integration.webhookUrl ?? "";
  const regen = async () => {
    if (!confirm("Gerar um novo endereço? O endereço atual para de funcionar na hora e precisa ser trocado na ferramenta.")) return;
    try {
      onChanged(await api.post<Integration>(`/api/lead-integrations/${integration.id}/token`));
      toast.success("Novo endereço gerado.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const urlBox = (
    <div className="flex flex-col gap-1">
      <Copyable label="Endereço exclusivo desta integração (trate como senha)" value={url} />
      <button onClick={regen} className="inline-flex items-center gap-1 self-start text-[12.5px] font-medium text-muted hover:text-ink">
        <RefreshCw className="size-3.5" aria-hidden /> Gerar novo endereço
      </button>
    </div>
  );

  switch (integration.provider) {
    case "crmlabs_form":
      return (
        <div className="flex flex-col gap-3">
          <Copyable label="Link do formulário (destino do anúncio, bio, stories ou WhatsApp)" value={integration.publicUrl} hint="Dica: adicione ?utm_campaign=nome-da-campanha ao link para saber de qual anúncio veio cada lead." />
          <a href={integration.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start text-[13.5px] font-semibold text-brand hover:underline">
            <ExternalLink className="size-4" aria-hidden /> Ver a página
          </a>
          <details className="rounded-[14px] bg-page/60 p-3 text-[13px]">
            <summary className="cursor-pointer font-medium">Também receber de outra ferramenta (webhook)</summary>
            <div className="mt-3">{urlBox}</div>
          </details>
        </div>
      );
    case "typeform":
      return (
        <div className="flex flex-col gap-3">
          {urlBox}
          <Steps
            items={[
              <>No Typeform, abra o formulário → <b>Connect</b> → <b>Webhooks</b> → <b>Add a webhook</b>.</>,
              <>Cole o endereço acima e salve. Ative o webhook.</>,
              <>Em <b>Edit</b> do webhook, defina um <b>Secret</b> e cole o mesmo segredo abaixo.</>,
              <>Para saber o anúncio, crie <i>hidden fields</i> utm_source, utm_campaign… no Typeform.</>,
            ]}
          />
          <SecretBox integration={integration} onChanged={onChanged} hint="O CRMLABS confere o cabeçalho Typeform-Signature de cada envio." />
        </div>
      );
    case "tally":
      return (
        <div className="flex flex-col gap-3">
          {urlBox}
          <Steps items={[<>No Tally, abra o formulário → <b>Integrations</b> → <b>Webhooks</b> → <b>Connect</b>.</>, <>Cole o endereço acima em <b>Endpoint URL</b>.</>, <>Se definir um <b>Signing secret</b> no Tally, cole o mesmo aqui.</>]} />
          <SecretBox integration={integration} onChanged={onChanged} hint="O CRMLABS confere o cabeçalho Tally-Signature de cada envio." />
        </div>
      );
    case "google_forms": {
      const script = `// CRMLABS — envia cada resposta do Google Forms para o CRM
const CRMLABS_URL = "${url}";

function enviarParaCRMLABS(e) {
  const answers = {};
  e.response.getItemResponses().forEach(function (r) {
    const v = r.getResponse();
    answers[r.getItem().getTitle()] = Array.isArray(v) ? v.join(", ") : String(v);
  });
  const email = e.response.getRespondentEmail();
  if (email) answers["E-mail"] = email;
  UrlFetchApp.fetch(CRMLABS_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ answers: answers }),
    muteHttpExceptions: true,
  });
}`;
      return (
        <div className="flex flex-col gap-3">
          <Steps
            items={[
              <>No Google Forms, clique em <b>⋮</b> → <b>Editor de scripts</b> (Apps Script).</>,
              <>Apague o que estiver lá, cole o código abaixo e salve.</>,
              <>No menu à esquerda, <b>Acionadores</b> → <b>Adicionar acionador</b>: função <b>enviarParaCRMLABS</b>, evento <b>Ao enviar o formulário</b>. Autorize com sua conta Google.</>,
              <>Envie uma resposta de teste e confira em <b>Logs</b>.</>,
            ]}
          />
          <Code code={script} label="script do Google Forms" />
        </div>
      );
    }
    default: {
      const example = `curl -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "nome": "Maria Silva",
    "whatsapp": "71999990000",
    "email": "maria@exemplo.com",
    "instagram": "@mariasilva",
    "Qual seu faturamento?": "R$30.000 a R$50.000",
    "utm_source": "instagram",
    "utm_campaign": "outubro"
  }'`;
      return (
        <div className="flex flex-col gap-3">
          {urlBox}
          <p className="text-[13px] text-muted">
            Envie <b>POST</b> com JSON (ou formulário). Nome, WhatsApp, e-mail e Instagram são reconhecidos automaticamente; os demais campos seguem o mapeamento ou viram respostas. Também aceita o formato <code>field_data</code> do Lead Ads da Meta (via Zapier/Make).
          </p>
          <Code code={example} label="exemplo de envio" />
          <SecretBox integration={integration} onChanged={onChanged} hint="Opcional: assine o corpo com HMAC-SHA256 e envie no cabeçalho X-CRMLABS-Signature: sha256=<hex>." />
        </div>
      );
    }
  }
}
