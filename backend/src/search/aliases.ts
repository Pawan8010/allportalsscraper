/**
 * Related-keyword groups. Every phrase inside a group is treated as an alias of
 * every other phrase, so searching any one of them finds tenders worded with any
 * of the others. Groups are matched against the *normalized* query (lowercase,
 * punctuation stripped, singularised), so entries here are written in that form.
 */
export const ALIAS_GROUPS: string[][] = [
  // Thermal / infrared imaging
  [
    "thermal camera",
    "thermal imaging camera",
    "thermal imager",
    "thermal imaging",
    "thermal imagery",
    "infrared camera",
    "ir camera",
    "infra red camera",
    "handheld thermal imager",
    "thermal imaging sight",
    "thermal weapon sight",
    "uncooled thermal",
    "cooled thermal",
    "lwir",
    "mwir",
    "swir",
    "thermal scope",
  ],
  // Night vision
  [
    "night vision",
    "night vision device",
    "nvd",
    "night vision goggle",
    "nvg",
    "night vision sight",
    "night vision camera",
    "night vision binocular",
    "night vision monocular",
    "image intensifier",
    "day night sight",
    "i2 tube",
  ],
  // Weapon optics
  [
    "weapon sight",
    "reflex sight",
    "red dot sight",
    "holographic sight",
    "holosight",
    "collimator sight",
    "telescopic sight",
    "rifle scope",
    "riflescope",
    "gun sight",
    "aiming device",
  ],
  // Laser range finding
  [
    "laser range finder",
    "lrf",
    "laser rangefinder",
    "range finder",
    "rangefinder",
    "laser range finder lrf integrated sight",
    "laser target designator",
  ],
  // Cameras / surveillance optics
  [
    "ptz camera",
    "pan tilt zoom camera",
    "pan tilt zoom",
    "long range ptz camera",
    "ptz with eo payload",
    "optical camera",
    "surveillance camera",
    "cctv camera",
    "day camera",
    "bullet camera",
    "dome camera",
  ],
  // Electro-optical surveillance systems
  [
    "electro optical surveillance system",
    "eoss",
    "electro optic",
    "electro optical",
    "eo ir",
    "eo payload",
    "long range observation system",
    "loros",
    "border surveillance system",
    "battlefield surveillance radar",
    "target acquisition system",
    "surveillance system",
  ],
  // Binoculars / observation
  ["binocular", "field glass", "monocular", "spotting scope", "observation telescope", "periscope"],
  // Drone / UAV optics
  ["uav", "unmanned aerial vehicle", "drone", "rpas", "remotely piloted aircraft"],
];

/**
 * Abbreviations expanded before alias lookup. Keys are single normalized tokens.
 * Multi-word aliases belong in ALIAS_GROUPS instead.
 */
export const ABBREVIATIONS: Record<string, string> = {
  lrf: "laser range finder",
  nvd: "night vision device",
  nvg: "night vision goggle",
  eoss: "electro optical surveillance system",
  loros: "long range observation system",
  ptz: "pan tilt zoom",
  eo: "electro optical",
  ir: "infrared",
  tws: "thermal weapon sight",
  ti: "thermal imager",
  cctv: "closed circuit television",
  uav: "unmanned aerial vehicle",
  bsr: "battlefield surveillance radar",
  hhti: "handheld thermal imager",
};

/**
 * Common misspellings seen in real GeM search traffic and in the tender text
 * itself. Applied token-by-token before anything else.
 */
export const SPELLING_CORRECTIONS: Record<string, string> = {
  slight: "sight",
  sigth: "sight",
  singht: "sight",
  sighte: "sight",
  thermel: "thermal",
  thermla: "thermal",
  thremal: "thermal",
  themal: "thermal",
  camara: "camera",
  camra: "camera",
  camrea: "camera",
  camerra: "camera",
  cemera: "camera",
  camera: "camera",
  kamera: "camera",
  surveilance: "surveillance",
  surveillence: "surveillance",
  survelliance: "surveillance",
  binocular: "binocular",
  binaculor: "binocular",
  infrared: "infrared",
  infrarad: "infrared",
  longe: "long",
  visibility: "visibility",
  visoin: "vision",
  visio: "vision",
};
