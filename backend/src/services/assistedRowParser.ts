import { PortalRegistryEntry, PortalTender } from "../portals/portal.types";
import { parseAssistedDate } from "../utils/dateParser";

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseAssistedRows(
  rows: Array<{ cells: string[]; links: string[] }>,
  portal: PortalRegistryEntry
): PortalTender[] {
  const tenders: PortalTender[] = [];
  for (const row of rows) {
    const cells = row.cells.map(clean).filter(Boolean);
    const text = cells.join(" | ");
    if (cells.length < 2) continue;
    if (portal.key === "ireps" && cells.length < 4) continue;
    if (/tender id|tender no|closing date|published date/i.test(text) && cells.length < 4) continue;
    if (/no results found/i.test(text)) continue;

    const tenderId =
      text.match(/\b(?:GEM\/\d{4}\/[A-Z]\/\d+|[A-Z0-9][A-Z0-9_./-]{4,}\d)\b/i)?.[0] ??
      text.match(/\b\d{5,}\b/)?.[0];
    if (!tenderId) continue;
    if (portal.key === "ireps" && !/\d/.test(tenderId)) continue;

    const dateMatches = text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi) ?? [];
    const parsedDates = dateMatches
      .map((date) => parseAssistedDate(date))
      .filter((date): date is Date => date !== null);
    const title =
      cells
        .filter((cell) => cell !== tenderId && cell.length > 8 && !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(cell))
        .sort((left, right) => right.length - left.length)[0] ?? text;
    const absoluteLink = row.links.find((link) => /^https?:\/\//i.test(link)) ?? portal.baseUrl;

    tenders.push({
      portal: portal.key,
      tenderId,
      title,
      organisation: cells.find((cell) => /department|ministry|division|corporation|railway|board/i.test(cell)),
      tenderURL: absoluteLink,
      documentURL: absoluteLink,
      description: text,
      publishedDate: parsedDates[0]?.toISOString(),
      closingDate: parsedDates.at(-1)?.toISOString(),
      status: "active",
    });
  }
  return tenders;
}
