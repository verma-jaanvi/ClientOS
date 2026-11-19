import { prisma } from '../db';
import { createLink } from './links';
import { brandOf, render, sendEmail } from './email';

const DAY = 86_400_000;

/**
 * Builds and sends the weekly digest for one client.
 * With `previewTo`, mails one copy (built for the first contact) to that address instead.
 * Sends nothing when there is nothing to say.
 */
export async function sendDigestForClient(clientId: string, opts: { previewTo?: string } = {}) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { workspace: true, contacts: true, projects: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } } },
  });
  if (!client || client.status !== 'ACTIVE') return { sent: 0, reason: 'Client is not active' };
  if (client.contacts.length === 0) return { sent: 0, reason: 'Client has no contacts' };

  const since = new Date(Date.now() - 7 * DAY);
  const [pending, updates, replies] = await Promise.all([
    prisma.deliverable.findMany({
      where: { workspaceId: client.workspaceId, status: 'SHARED', project: { clientId } },
      select: { id: true, title: true, currentVersion: true },
    }),
    prisma.progressUpdate.findMany({
      where: { workspaceId: client.workspaceId, project: { clientId, status: 'ACTIVE' }, publishedAt: { gte: since } },
      orderBy: { publishedAt: 'desc' },
      select: { text: true },
    }),
    prisma.request.findMany({
      where: { workspaceId: client.workspaceId, clientId, status: 'ANSWERED', repliedAt: { gte: since } },
      select: { type: true, decision: true, deliverable: { select: { title: true } } },
    }),
  ]);
  if (!pending.length && !updates.length && !replies.length) return { sent: 0, reason: 'Nothing to report this week' };

  const brand = brandOf(client.workspace);
  const recipients = opts.previewTo ? client.contacts.slice(0, 1) : client.contacts;
  const homeProject = client.projects[0];
  let sent = 0;

  for (const contact of recipients) {
    // A fresh link for every contact in every digest, so old emails stop working over time.
    const { approveLinks, homeUrl } = await prisma.$transaction(async (tx) => {
      const base = { workspaceId: client.workspaceId, clientId, contactId: contact.id, contactName: contact.name, actor: { type: 'SYSTEM' as const } };
      const approveLinks = [];
      for (const d of pending) {
        approveLinks.push({ d, url: (await createLink(tx, { ...base, scope: 'DELIVERABLE', deliverableId: d.id })).url });
      }
      const homeUrl = homeProject ? (await createLink(tx, { ...base, scope: 'PROJECT', projectId: homeProject.id })).url : undefined;
      return { approveLinks, homeUrl };
    });

    const sections = [
      ...approveLinks.map(({ d, url }) => ({ title: 'Needs your approval', lines: [`${d.title}, version ${d.currentVersion}: ${url}`] })),
      ...(updates.length ? [{ title: 'Progress this week', lines: updates.map((u) => u.text) }] : []),
      ...(replies.length
        ? [{ title: 'Your requests', lines: replies.map((r) => `${r.type.toLowerCase()}${r.deliverable ? ` on ${r.deliverable.title}` : ''}: answered${r.decision ? ` (${r.decision.toLowerCase()})` : ''}` ) }]
        : []),
    ];
    // Approval links are rendered as buttons in HTML by giving each its own message block.
    const content = render(brand, {
      heading: `Weekly update for ${client.company}`,
      sections: sections.map((s) => ({ ...s, lines: s.lines.map((l) => l) })),
      cta: homeUrl ? { label: 'Open your project page', url: homeUrl } : approveLinks[0] ? { label: 'Review and approve', url: approveLinks[0].url } : undefined,
    });
    sendEmail({
      to: opts.previewTo ?? contact.email,
      subject: pending.length ? `Weekly update: ${pending.length} item${pending.length > 1 ? 's' : ''} need${pending.length > 1 ? '' : 's'} your approval` : `Weekly update from ${brand.name}`,
      html: content.html,
      text: content.text,
      workspaceId: client.workspaceId,
    });
    sent++;
  }
  return { sent };
}

/** Used by the scheduled job: every active client with the digest switched on. */
export async function runWeeklyDigest() {
  const clients = await prisma.client.findMany({ where: { status: 'ACTIVE', digestEnabled: true }, select: { id: true } });
  let total = 0;
  for (const c of clients) {
    try {
      total += (await sendDigestForClient(c.id)).sent;
    } catch (e: any) {
      console.error(`Digest failed for client ${c.id}:`, e?.message);
    }
  }
  return { clients: clients.length, emails: total };
}
