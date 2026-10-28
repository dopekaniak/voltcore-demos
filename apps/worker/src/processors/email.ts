import type { Mailer } from '../mailer';

/** Email templates. Copy lives here (server side); web copy lives in the web i18n file. */
type Vars = Record<string, string | number>;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const TEMPLATES: Record<string, (v: Vars) => { subject: string; text: string }> = {
  'magic-link': (v) => ({
    subject: 'Your Shapewright sign-in link',
    text: `Sign in to Shapewright:\n\n${v.url}\n\nThis link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
  }),
  'order-paid': (v) => ({
    subject: `Order ${v.order} confirmed`,
    text: `Thanks! We received payment of ${v.total} for order ${v.order}. We will email you when it ships.`,
  }),
  'order-shipped': (v) => ({
    subject: `Order ${v.order} shipped`,
    text: `Your order ${v.order} shipped with ${v.carrier}. Tracking number: ${v.tracking}.`,
  }),
  'order-delivered': (v) => ({
    subject: `Order ${v.order} delivered`,
    text: `Your order ${v.order} was delivered. If something is wrong, report a problem within 14 days from the order page.`,
  }),
  'job-failed': (v) => ({
    subject: 'A job did not finish',
    text: `Your ${v.kind} job failed (${v.code}). No credits were charged.`,
  }),
};

export interface EmailPayload {
  template: string;
  to: string;
  vars: Vars;
}

export async function processEmail(mailer: Mailer, p: EmailPayload): Promise<void> {
  const tpl = TEMPLATES[p.template];
  if (!tpl) throw new Error(`unknown email template ${p.template}`);
  const { subject, text } = tpl(p.vars);
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`;
  await mailer.send({ to: p.to, subject, text, html });
}
