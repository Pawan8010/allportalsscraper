import { describe, expect, it } from "vitest";
import { mapBiharTender } from "../src/portals/biharScraper";
import { getPortal } from "../src/portals/portalRegistry";

describe("Bihar public tender mapping", () => {
  it("maps the public JSON record into the normalized tender shape", () => {
    const portal = getPortal("bihar");
    expect(portal).toBeDefined();
    const mapped = mapBiharTender(
      {
        currenttenderid: 136474,
        currentOrgTenderId: 136279,
        currenttenderrefno: "NIT-04",
        currentdescription: "Construction of drain",
        currentdeptid: 1869,
        currentorgid: 538,
        currentTenderPublishDate: 1784440430000,
        currentbidEndDate: 1785058200000,
      },
      portal!
    );

    expect(mapped).toMatchObject({
      portal: "Bihar",
      tenderId: "136279",
      title: "Construction of drain",
      state: "Bihar",
      statusText: "LIVE",
    });
  });
});
