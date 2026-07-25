import { Prisma } from "@prisma/client";
import { RawScrapedTender } from "../types/scraper";
import { parseCurrency, parseGemDate, parseStatus, cleanText } from "./parser";
import { matchKeywordsAsString } from "./keywords";

/** Converts a raw scraped tender into the shape Prisma's upsert expects. */
export function mapRawTenderToUpsertData(raw: RawScrapedTender) {
  const description = cleanText(raw.description);
  const title = cleanText(raw.title) ?? raw.title;

  const estimatedValue = parseCurrency(raw.estimatedValueText);
  const emdAmount = parseCurrency(raw.emdAmountText);
  const tenderFee = parseCurrency(raw.tenderFeeText);

  const closingDate = parseGemDate(raw.closingDateText);

  let status = parseStatus(raw.statusText);
  if (status === "UNKNOWN" && closingDate) {
    status = closingDate.getTime() > Date.now() ? "LIVE" : "CLOSED";
  }

  const data = {
    tenderId: raw.tenderId,
    portal: cleanText(raw.portal) ?? "GeM",
    title,
    organisation: cleanText(raw.organisation),
    department: cleanText(raw.department),
    location: cleanText(raw.location),
    state: cleanText(raw.state),
    category: cleanText(raw.category),
    description,
    estimatedValue: estimatedValue !== null ? new Prisma.Decimal(estimatedValue) : null,
    emdAmount: emdAmount !== null ? new Prisma.Decimal(emdAmount) : null,
    tenderFee: tenderFee !== null ? new Prisma.Decimal(tenderFee) : null,
    publishedDate: parseGemDate(raw.publishedDateText),
    closingDate,
    openingDate: parseGemDate(raw.openingDateText),
    keywordMatched: matchKeywordsAsString(title, description),
    tenderStatus: status,
    tenderURL: raw.tenderURL,
    documentURL: raw.documentURL ?? null,
    lastUpdated: new Date(),
  };

  return data;
}
