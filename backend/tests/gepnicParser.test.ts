import { describe, expect, it } from "vitest";
import { parseGepnicTenderRows } from "../src/portals/gepnicScraper";
import { getPortal } from "../src/portals/portalRegistry";

describe("GePNIC tender parser", () => {
  it("normalizes an organisation tender row", () => {
    const portal = getPortal("cppp");
    expect(portal).toBeTruthy();

    const html = `
      <table class="list_table">
        <tr class="list_header">
          <td>S.No</td><td>e-Published Date</td><td>Closing Date</td>
          <td>Opening Date</td><td>Title and Ref.No./Tender ID</td><td>Organisation Chain</td>
        </tr>
        <tr class="even">
          <td>1</td>
          <td>22-Jul-2026 12:00 PM</td>
          <td>30-Jul-2026 11:00 AM</td>
          <td>31-Jul-2026 11:00 AM</td>
          <td>
            <a title="View Tender Information" href="/eprocure/app?session=temporary">[Thermal Camera System]</a>
            [REF/2026/17][2026_TEST_918462_1]
          </td>
          <td>Test Ministry||Test Department||Test Division</td>
        </tr>
      </table>
    `;

    const rows = parseGepnicTenderRows(html, portal!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      portal: "CPPP",
      tenderId: "2026_TEST_918462_1",
      title: "Thermal Camera System",
      organisation: "Test Ministry",
      department: "Test Department",
      publishedDateText: "22-Jul-2026 12:00 PM",
      closingDateText: "30-Jul-2026 11:00 AM",
      tenderURL: "https://eprocure.gov.in/eprocure/app?session=temporary",
      statusText: "LIVE",
    });
  });
});
