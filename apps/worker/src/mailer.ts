import nodemailer from 'nodemailer';
import type { Env } from '@sw/config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(m: Mail): Promise<void>;
  /** Memory driver only. */
  sent?: Mail[];
}

export function createMailer(env: Env): Mailer {
  if (env.MAIL_DRIVER === 'memory') {
    const sent: Mail[] = [];
    return { sent, send: async (m) => void sent.push(m) };
  }
  if (env.MAIL_DRIVER === 'smtp') {
    const transport = nodemailer.createTransport(env.SMTP_URL!);
    return { send: async (m) => void (await transport.sendMail({ from: env.MAIL_FROM, ...m })) };
  }
  return {
    send: async (m) => console.log(JSON.stringify({ level: 'info', msg: 'email (log driver)', to: m.to, subject: m.subject, text: m.text })),
  };
}
