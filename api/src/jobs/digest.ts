import { runWeeklyDigest } from '../services/digest';
import { prisma } from '../db';

// Run weekly from your host's scheduler (e.g. Render Cron Job: `npm run digest:prod`).
runWeeklyDigest()
  .then((r) => console.log('Digest finished', r))
  .catch((e) => {
    console.error('Digest job failed:', e?.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Give the in-process email queue a moment to finish before exiting.
    await new Promise((r) => setTimeout(r, 25000));
    await prisma.$disconnect();
  });
