/** Outbound email via SMTP_URL (nodemailer). Falls back to logging when unconfigured so flows still work in dev. */
import { config } from "../config";
import { createLogger } from "../logger";

const log = createLogger("email");

export interface Mail { to: string | string[]; subject: string; text?: string; html?: string; attachments?: { filename: string; content: Buffer | string; contentType?: string }[] }

let transport: import("nodemailer").Transporter | null | undefined;

async function getTransport() {
  if (transport !== undefined) return transport;
  if (!config.smtp.url) { transport = null; return null; }
  const nodemailer = await import("nodemailer");
  transport = nodemailer.createTransport(config.smtp.url);
  return transport;
}

export function isEmailConfigured() { return !!config.smtp.url; }

export async function sendMail(mail: Mail): Promise<{ sent: boolean; error?: string }> {
  const t = await getTransport();
  const to = Array.isArray(mail.to) ? mail.to.join(", ") : mail.to;
  if (!t) {
    log.info(`SMTP not configured - email to ${to} not sent`, { subject: mail.subject });
    return { sent: false, error: "SMTP not configured" };
  }
  try {
    await t.sendMail({ from: config.smtp.from, to, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
    return { sent: true };
  } catch (err) {
    log.error("send failed", { to, err: String(err) });
    return { sent: false, error: String((err as Error).message || err) };
  }
}

/** Minimal branded HTML wrapper for transactional mails. */
export function emailLayout(opts: { title: string; body: string; cta?: { label: string; url: string }; productName?: string; footer?: string }): string {
  const name = opts.productName || "MagicWand RMM";
  return `<!doctype html><html><body style="margin:0;background:#0b0e14;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#e8ebf2">
<div style="max-width:560px;margin:32px auto;background:#11151d;border:1px solid #222a3a;border-radius:14px;padding:28px">
<div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7c6cff;margin-bottom:12px">${name}</div>
<h1 style="font-size:20px;margin:0 0 12px">${opts.title}</h1>
<div style="font-size:14px;line-height:1.6;color:#b7bfcf">${opts.body}</div>
${opts.cta ? `<a href="${opts.cta.url}" style="display:inline-block;margin-top:20px;background:#7c6cff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">${opts.cta.label}</a>` : ""}
<div style="margin-top:28px;font-size:11px;color:#5f6880">${opts.footer || `Sent by ${name}.`}</div>
</div></body></html>`;
}
