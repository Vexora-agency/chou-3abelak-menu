// Generated from src/config/dialCodes.ts — keep the list in sync when the
// country table changes. Used only to derive the restaurant's dial code and
// reject clearly-foreign long order phone numbers server-side.
const DIAL_CODES = new Set('1,1242,1246,1264,1268,1284,1340,1345,1441,1473,1481,1534,1624,1649,1664,1670,1671,1684,1721,1758,1767,1784,1787,1809,1868,1869,1876,20,211,212,213,216,218,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,248,249,250,251,252,253,254,255,256,257,258,260,261,262,263,264,265,266,267,268,269,27,291,297,298,299,30,31,32,33,34,350,351,352,353,354,355,356,357,358,359,36,370,371,372,373,374,375,376,377,378,379,380,381,382,383,385,386,387,389,39,40,41,420,421,423,43,44,45,46,47,48,49,500,501,502,503,504,505,506,507,509,51,52,53,54,55,56,57,58,590,591,592,593,594,595,596,597,598,599,60,61,62,63,64,65,66,670,673,674,675,676,677,678,679,680,681,682,683,685,686,687,688,689,691,692,7,81,82,84,850,852,855,856,86,880,886,90,91,92,93,94,95,960,961,962,963,964,965,966,967,968,970,971,972,973,974,975,976,977,98,992,993,994,995,996,998'.split(','));

/** Longest dial-code prefix of a stored international number, or ''. */
export function dialCodeFromNumber(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (!digits) return '';
  for (let len = Math.min(4, digits.length); len >= 1; len--) {
    const prefix = digits.slice(0, len);
    if (DIAL_CODES.has(prefix)) return prefix;
  }
  return '';
}
