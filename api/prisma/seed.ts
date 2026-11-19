import { prisma } from '../src/db';
import { supabase } from '../src/lib/supabase';

const EMAIL = process.env.SEED_EMAIL ?? 'demo@northwind.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

async function main() {
  if (await prisma.user.findFirst({ where: { email: EMAIL } })) {
    console.log('Seed data already exists. Nothing to do.');
    return;
  }
  const { data, error } = await supabase.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`Could not create the seed login: ${error?.message}`);

  const ws = await prisma.workspace.create({ data: { name: 'Northwind Digital', brandColor: '#2563eb' } });
  const staff = await prisma.user.create({ data: { workspaceId: ws.id, authId: data.user.id, email: EMAIL, name: 'Priya', role: 'ADMIN' } });

  const acme = await prisma.client.create({ data: { workspaceId: ws.id, company: 'Acme Logistics', industry: 'Logistics', website: 'https://acme.example', ownerId: staff.id } });
  const bright = await prisma.client.create({ data: { workspaceId: ws.id, company: 'Bright Studio', industry: 'Design', ownerId: staff.id } });
  await prisma.contact.create({ data: { workspaceId: ws.id, clientId: acme.id, name: 'Jane Doe', email: 'jane@acme.example' } });
  await prisma.contact.create({ data: { workspaceId: ws.id, clientId: bright.id, name: 'Sam Lee', email: 'sam@bright.example' } });

  const project = await prisma.project.create({ data: { workspaceId: ws.id, clientId: acme.id, name: 'Website redesign' } });
  const milestone = await prisma.milestone.create({ data: { workspaceId: ws.id, projectId: project.id, title: 'Design sign-off', dueDate: new Date(Date.now() + 14 * 86_400_000) } });
  await prisma.deliverable.create({ data: { workspaceId: ws.id, projectId: project.id, milestoneId: milestone.id, title: 'Homepage design v2', description: 'Updated hero section and pricing layout. Please review the mobile view in particular.' } });
  await prisma.deliverable.create({ data: { workspaceId: ws.id, projectId: project.id, title: 'Brand guidelines', description: 'Logo usage, colours and type.' } });

  console.log(`Seeded. Log in with ${EMAIL} / ${PASSWORD}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
