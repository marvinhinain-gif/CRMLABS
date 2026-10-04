import nodemailer, { type Transporter } from "nodemailer";
import { isProduction } from "./env";

type Mail = { to: string; subject: string; text: string };

let transport: Transporter | null = null;

/** Último e-mail enviado pelo transporte "console" (usado pelos testes automatizados). */
export const consoleOutbox: Mail[] = [];

/**
 * Transportes:
 *  - smtp:    servidor SMTP (SMTP_HOST…). Bloqueado no plano grátis do Render.
 *  - resend:  API HTTP do Resend (RESEND_API_KEY + MAIL_FROM). Funciona em qualquer plano.
 *  - console: imprime no log (desenvolvimento e modo local do Mac).
 *  - none:    sem e-mail. Convites e links de acesso aparecem para o administrador copiar.
 */
type Mode = "smtp" | "resend" | "console" | "none";

function mode(): Mode {
  const m = (process.env.MAIL_TRANSPORT ?? "smtp") as Mode;
  return ["smtp", "resend", "console", "none"].includes(m) ? m : "smtp";
}

/** Se há um canal de e-mail que realmente entrega mensagens a outras pessoas. */
export function mailDelivers() {
  const m = mode();
  if (m === "resend") return !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
  if (m === "smtp") return !!process.env.SMTP_HOST && !!process.env.MAIL_FROM;
  if (m === "console") return process.env.VITEST === "true"; // nos testes o "envio" é verificável
  return false;
}

export function mailStatus() {
  const m = mode();
  if (m === "console") return { mode: m, ready: !isProduction() || process.env.CRMLABS_LOCAL === "1", note: "Modo local: links impressos na janela do servidor." };
  if (m === "none") return { mode: m, ready: false, note: "Sem e-mail: os links de convite e de acesso aparecem para o administrador copiar e enviar." };
  if (m === "resend") {
    const ready = mailDelivers();
    return { mode: m, ready, note: ready ? "E-mail pelo Resend configurado." : "Configure RESEND_API_KEY e MAIL_FROM." };
  }
  const ready = mailDelivers();
  return { mode: "smtp", ready, note: ready ? "SMTP configurado." : "Configure SMTP_HOST, SMTP_USER, SMTP_PASSWORD e MAIL_FROM." };
}

/** Envia o e-mail. Retorna false quando não há canal de entrega (modo "none"). */
export async function sendMail(mail: Mail): Promise<boolean> {
  const m = mode();
  if (m === "none") return false;
  if (m === "console") {
    if (isProduction() && process.env.CRMLABS_LOCAL !== "1") throw new Error("MAIL_TRANSPORT=console não é permitido em produção");
    consoleOutbox.push(mail);
    if (consoleOutbox.length > 50) consoleOutbox.shift();
    if (process.env.VITEST !== "true") {
      console.info(`\n[CRMLABS e-mail · modo console]\nPara: ${mail.to}\nAssunto: ${mail.subject}\n\n${mail.text}\n`);
    }
    return true;
  }
  if (m === "resend") {
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error("Resend não configurado (RESEND_API_KEY, MAIL_FROM)");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) throw new Error(`Resend recusou o envio (HTTP ${res.status})`);
    return true;
  }
  if (!process.env.SMTP_HOST) throw new Error("SMTP não configurado (SMTP_HOST)");
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
  return true;
}
