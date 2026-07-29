import { prisma } from "./prisma";
import { searchTenders, SearchResultRow } from "./searchService";
import { sendAlertEmail } from "./mailer";
import { logger } from "../utils/logger";

// A cap per keyword per cycle -- this is a periodic digest, not a full
// export; a genuinely huge backlog (e.g. right after subscribing) still
// gets the most relevant/newest matches rather than everything at once.
const MAX_MATCHES_PER_KEYWORD = 20;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEmail(rows: SearchResultRow[]): { subject: string; html: string; text: string } {
  const subject = `${rows.length} new tender${rows.length === 1 ? "" : "s"} matching your alerts`;
  const lines = rows.map(
    (r) =>
      `- [${r.portalName}] ${r.title} (closes ${r.closingDate ? new Date(r.closingDate).toLocaleDateString() : "unknown"}) — ${r.tenderURL}`
  );
  const text = `New tenders matching your saved keywords:\n\n${lines.join("\n")}`;
  const htmlItems = rows
    .map(
      (r) =>
        `<li><strong>[${escapeHtml(r.portalName)}]</strong> ${escapeHtml(r.title)}<br/>` +
        `Closes: ${r.closingDate ? new Date(r.closingDate).toLocaleDateString() : "unknown"} — ` +
        `<a href="${escapeHtml(r.tenderURL)}">View tender</a></li>`
    )
    .join("");
  const html = `<p>New tenders matching your saved keywords:</p><ul>${htmlItems}</ul>`;
  return { subject, html, text };
}

/**
 * Finds new tenders matching each active subscription's keywords and emails
 * one batched digest per user -- not one email per tender. Idempotent by
 * design (no in-memory "last run" timestamp to lose on restart): every
 * currently-matching, still-open tender is a candidate every cycle, and
 * AlertSentLog's unique constraint is what actually prevents a tender from
 * ever being emailed to the same user twice.
 */
export async function runAlertCycle(): Promise<{ usersNotified: number; tendersSent: number }> {
  const subscriptions = await prisma.alertSubscription.findMany({
    where: { active: true, keywords: { isEmpty: false } },
    include: { user: { select: { id: true, email: true } } },
  });

  let usersNotified = 0;
  let tendersSent = 0;

  for (const sub of subscriptions) {
    try {
      const matched = new Map<string, SearchResultRow>();
      for (const keyword of sub.keywords) {
        const { rows } = await searchTenders({ q: keyword, limit: MAX_MATCHES_PER_KEYWORD });
        for (const row of rows) matched.set(`${row.portal}:${row.tenderId}`, row);
      }
      if (matched.size === 0) continue;

      const alreadySent = await prisma.alertSentLog.findMany({
        where: { userId: sub.userId, portal: { in: [...new Set([...matched.values()].map((r) => r.portal))] } },
        select: { portal: true, tenderId: true },
      });
      const sentKeys = new Set(alreadySent.map((s) => `${s.portal}:${s.tenderId}`));
      const toSend = [...matched.entries()].filter(([key]) => !sentKeys.has(key)).map(([, row]) => row);
      if (toSend.length === 0) continue;

      const { subject, html, text } = buildEmail(toSend);
      const sent = await sendAlertEmail(sub.user.email, subject, html, text);
      if (!sent) continue; // don't record as sent if the email never actually went out

      await prisma.alertSentLog.createMany({
        data: toSend.map((r) => ({ userId: sub.userId, portal: r.portal, tenderId: r.tenderId, title: r.title })),
        skipDuplicates: true,
      });

      usersNotified += 1;
      tendersSent += toSend.length;
    } catch (err) {
      logger.error({ err: String(err), userId: sub.userId }, "alert cycle failed for subscription");
    }
  }

  if (usersNotified > 0) {
    logger.info({ usersNotified, tendersSent }, "alert cycle finished");
  }
  return { usersNotified, tendersSent };
}
