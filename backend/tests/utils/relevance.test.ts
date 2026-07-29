import { classifyRelevance } from "../../src/utils/relevance";

describe("classifyRelevance", () => {
  it("marks a spare-parts tender irrelevant even for a defence client", () => {
    expect(
      classifyRelevance({
        title: "Supply of Spare Parts for Night Vision Goggles",
        organisation: "Indian Army",
        department: "Department of Military Affairs",
      })
    ).toBe("irrelevant");
  });

  it("marks an AMC/repair tender irrelevant", () => {
    expect(classifyRelevance({ title: "AMC of Thermal Imaging Systems", organisation: "Ministry of Defence" })).toBe(
      "irrelevant"
    );
    expect(classifyRelevance({ title: "Repair of Optical Camera Mount" })).toBe("irrelevant");
  });

  it("marks a whole-system tender for a defence client relevant", () => {
    expect(
      classifyRelevance({
        title: "Procurement of Thermal Weapon Sights",
        organisation: "Ordnance Factory Board",
        department: "Department of Defence Production",
      })
    ).toBe("relevant");
  });

  it("recognises DRDO, BSF, and Coast Guard as defence clients", () => {
    expect(classifyRelevance({ title: "Supply of Surveillance Radar", organisation: "DRDO" })).toBe("relevant");
    expect(classifyRelevance({ title: "Border Fencing Equipment", organisation: "BSF" })).toBe("relevant");
    expect(classifyRelevance({ title: "Patrol Vessel Equipment", department: "Indian Coast Guard" })).toBe("relevant");
  });

  it("marks a tender for a college or university irrelevant", () => {
    expect(classifyRelevance({ title: "Supply of Lab Equipment", organisation: "Indian Institute of Technology" })).toBe(
      "unclassified" // "Institute of Technology" alone doesn't match the college/university pattern
    );
    expect(classifyRelevance({ title: "Supply of Furniture", organisation: "Government Degree College" })).toBe(
      "irrelevant"
    );
    expect(classifyRelevance({ title: "Lab equipment", department: "State University" })).toBe("irrelevant");
  });

  it("returns unclassified when there is no clear signal either way", () => {
    expect(classifyRelevance({ title: "Supply of Office Chairs", organisation: "Karnataka Power Corporation" })).toBe(
      "unclassified"
    );
    expect(classifyRelevance({})).toBe("unclassified");
  });

  it("is case-insensitive", () => {
    expect(classifyRelevance({ title: "SPARE PARTS for radio set" })).toBe("irrelevant");
    expect(classifyRelevance({ title: "Procurement of Radios", organisation: "indian army" })).toBe("relevant");
  });
});
