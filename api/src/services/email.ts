import { Resend } from 'resend';
import type { Workspace } from '@prisma/client';
import { env } from '../env';
import { prisma } from '../db';
import { logoUrl } from '../lib/supabase';

export type Brand = { name: string; logoUrl: string | null; color: string };
export const brandOf = (w: Workspace): Brand => ({
  name: w.name,
  logoUrl: logoUrl(w.logoPath),
  color: /^#[0-9a-fA-F]{6}$/.test(w.brandColor) ? w.brandColor : '#2563eb',
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type Content = {
  heading: string;
  paragraphs?: string[];
  sections?: { title: string; lines: string[] }[];
  cta?: { label: string; url: string };
};

/** Single-column layout, inline styles only, plus a plain-text twin. */
export function render(brand: Brand, c: Content, footer?: string) {
  const foot = footer ?? `Sent by ${brand.name} using ClientOS.`;
  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="" height="28" style="vertical-align:middle;margin-right:8px;border-radius:4px">`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;border:1px solid #e5e7eb">
<tr><td style="padding:20px 24px;border-bottom:3px solid ${brand.color};font-size:16px;font-weight:bold">${logo}${esc(brand.name)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(c.heading)}</h1>
${(c.paragraphs ?? []).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join('')}
${(c.sections ?? [])
  .map(
    (s) =>
      `<h2 style="margin:20px 0 6px;font-size:14px">${esc(s.title)}</h2>` +
      s.lines.map((l) => `<p style="margin:0 0 6px;font-size:14px;line-height:1.5">${esc(l)}</p>`).join(''),
  )
  .join('')}
${c.cta ? `<p style="margin:24px 0 4px"><a href="${esc(c.cta.url)}" style="display:inline-block;background:${brand.color};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:8px">${esc(c.cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">${esc(foot)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    c.heading,
    '',
    ...(c.paragraphs ?? []).flatMap((p) => [p, '']),
    ...(c.sections ?? []).flatMap((s) => [s.title, ...s.lines.map((l) => `- ${l}`), '']),
    c.cta ? `${c.cta.label}: ${c.cta.url}` : '',
    '',
    foot,
  ].join('\n');
  return { html, text };
}

/* ---------------- Templates (one per email in the guide) ---------------- */

export const templates = {
  shared: (b: Brand, p: { contactName: string; title: string; note: string; url: string }) => ({
    subject: `${b.name} shared "${p.title}" for your approval`,
    ...render(b, {
      heading: `Hi ${p.contactName}, something is ready for your approval`,
      paragraphs: [`"${p.title}"`, p.note].filter(Boolean),
      cta: { label: 'Review and approve', url: p.url },
    }),
  }),
  approvedStaff: (b: Brand, p: { who: string; title: string; version: number; client: string }) => ({
    subject: `${p.client} approved "${p.title}"`,
    ...render(b, {
      heading: 'A deliverable was approved',
      paragraphs: [`${p.who} (${p.client}) approved "${p.title}", version ${p.version}.`],
    }),
  }),
  requestStaff: (b: Brand, p: { who: string; client: string; type: string; text: string; title?: string | null }) => ({
    subject: `New ${p.type.toLowerCase()} from ${p.client}`,
    ...render(b, {
      heading: `New ${p.type.toLowerCase()} from ${p.who}`,
      paragraphs: [p.title ? `About: ${p.title}` : '', p.text].filter(Boolean),
    }),
  }),
  answered: (
    b: Brand,
    p: { contactName: string; decision: string; reply: string; impact: string[]; url?: string },
  ) => ({
    subject: `${b.name} replied to your request`,
    ...render(b, {
      heading: `Hi ${p.contactName}, your request has an answer`,
      paragraphs: [`Decision: ${p.decision}`, p.reply, ...p.impact],
      cta: p.url ? { label: 'Open your project page', url: p.url } : undefined,
    }),
  }),
  invite: (b: Brand, p: { url: string }) => ({
    subject: `You are invited to join ${b.name} on ClientOS`,
    ...render(
      b,
      {
        heading: `Join ${b.name}`,
        paragraphs: ['You have been invited to join this workspace as a team member.'],
        cta: { label: 'Accept invite', url: p.url },
      },
      'Sent using ClientOS.',
    ),
  }),
};

/* ---------------- Transport + background queue with retries ---------------- */

type Mail = { to: string; subject: string; html: string; text: string; workspaceId?: string | null };
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const MAX_ATTEMPTS = 3;

async function transport(m: Mail) {
  if (resend) {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    if (error) throw new Error(error.message);
    return;
  }
  if (env.DEV_LOG_EMAILS === 'true' && env.NODE_ENV !== 'production') {
    // Development only: prints the email so you can click the link without a mail provider.
    console.log(`\n--- DEV EMAIL to ${m.to} ---\n${m.subject}\n\n${m.text}\n---------------------------\n`);
    return;
  }
  throw new Error('No email transport configured (set RESEND_API_KEY)');
}

async function attempt(m: Mail, n: number): Promise<void> {
  try {
    await transport(m);
  } catch (e: any) {
    if (n < MAX_ATTEMPTS) {
      setTimeout(() => void attempt(m, n + 1), 1000 * 4 ** (n - 1));
      return;
    }
    await prisma.emailFailure
      .create({ data: { workspaceId: m.workspaceId ?? null, toEmail: m.to, subject: m.subject, error: String(e?.message ?? e).slice(0, 500) } })
      .catch(() => undefined);
    console.error(`Email to ${m.to} failed after ${n} attempts`);
  }
}

/** Fire and forget: a failed send never blocks the approval, reply or share. */
export function sendEmail(m: Mail) {
  void attempt(m, 1);
}
