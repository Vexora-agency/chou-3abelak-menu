/**
 * World dialing codes for the Google-style WhatsApp picker (country combo +
 * national-number input, committed value always full international digits).
 * Alphabetical by English name — the same convention Google uses. Names are
 * ASCII-only so the order stays deterministic; flag glyphs are derived from
 * the ISO code at runtime (no emoji data to get wrong).
 *
 * No dependency on libphonenumber: one admin field does not justify the
 * weight. Combining semantics mirror it for the cases that matter here:
 * the national part is typed in LOCAL format (trunk zero allowed) and the
 * zero is stripped when the country code is prepended.
 */

export interface DialCode {
  /** ISO 3166-1 alpha-2 (XK = Kosovo, user-assigned but standard). */
  iso: string;
  name: string;
  /** Country calling code, digits only, no '+'. */
  code: string;
}

export const DIAL_CODES: DialCode[] = [
  { iso: 'AF', name: 'Afghanistan', code: '93' },
  { iso: 'AL', name: 'Albania', code: '355' },
  { iso: 'DZ', name: 'Algeria', code: '213' },
  { iso: 'AS', name: 'American Samoa', code: '1684' },
  { iso: 'AD', name: 'Andorra', code: '376' },
  { iso: 'AO', name: 'Angola', code: '244' },
  { iso: 'AI', name: 'Anguilla', code: '1264' },
  { iso: 'AG', name: 'Antigua and Barbuda', code: '1268' },
  { iso: 'AR', name: 'Argentina', code: '54' },
  { iso: 'AM', name: 'Armenia', code: '374' },
  { iso: 'AW', name: 'Aruba', code: '297' },
  { iso: 'AU', name: 'Australia', code: '61' },
  { iso: 'AT', name: 'Austria', code: '43' },
  { iso: 'AZ', name: 'Azerbaijan', code: '994' },
  { iso: 'BS', name: 'Bahamas', code: '1242' },
  { iso: 'BH', name: 'Bahrain', code: '973' },
  { iso: 'BD', name: 'Bangladesh', code: '880' },
  { iso: 'BB', name: 'Barbados', code: '1246' },
  { iso: 'BY', name: 'Belarus', code: '375' },
  { iso: 'BE', name: 'Belgium', code: '32' },
  { iso: 'BZ', name: 'Belize', code: '501' },
  { iso: 'BJ', name: 'Benin', code: '229' },
  { iso: 'BM', name: 'Bermuda', code: '1441' },
  { iso: 'BT', name: 'Bhutan', code: '975' },
  { iso: 'BO', name: 'Bolivia', code: '591' },
  { iso: 'BA', name: 'Bosnia and Herzegovina', code: '387' },
  { iso: 'BW', name: 'Botswana', code: '267' },
  { iso: 'BR', name: 'Brazil', code: '55' },
  { iso: 'VG', name: 'British Virgin Islands', code: '1284' },
  { iso: 'BN', name: 'Brunei', code: '673' },
  { iso: 'BG', name: 'Bulgaria', code: '359' },
  { iso: 'BF', name: 'Burkina Faso', code: '226' },
  { iso: 'BI', name: 'Burundi', code: '257' },
  { iso: 'KH', name: 'Cambodia', code: '855' },
  { iso: 'CM', name: 'Cameroon', code: '237' },
  { iso: 'CA', name: 'Canada', code: '1' },
  { iso: 'CV', name: 'Cape Verde', code: '238' },
  { iso: 'KY', name: 'Cayman Islands', code: '1345' },
  { iso: 'CF', name: 'Central African Republic', code: '236' },
  { iso: 'TD', name: 'Chad', code: '235' },
  { iso: 'CL', name: 'Chile', code: '56' },
  { iso: 'CN', name: 'China', code: '86' },
  { iso: 'CO', name: 'Colombia', code: '57' },
  { iso: 'KM', name: 'Comoros', code: '269' },
  { iso: 'CD', name: 'Congo (DRC)', code: '243' },
  { iso: 'CG', name: 'Congo (Republic)', code: '242' },
  { iso: 'CK', name: 'Cook Islands', code: '682' },
  { iso: 'CR', name: 'Costa Rica', code: '506' },
  { iso: 'HR', name: 'Croatia', code: '385' },
  { iso: 'CU', name: 'Cuba', code: '53' },
  { iso: 'CW', name: 'Curacao', code: '599' },
  { iso: 'CY', name: 'Cyprus', code: '357' },
  { iso: 'CZ', name: 'Czechia', code: '420' },
  { iso: 'DK', name: 'Denmark', code: '45' },
  { iso: 'DJ', name: 'Djibouti', code: '253' },
  { iso: 'DM', name: 'Dominica', code: '1767' },
  { iso: 'DO', name: 'Dominican Republic', code: '1809' },
  { iso: 'EC', name: 'Ecuador', code: '593' },
  { iso: 'EG', name: 'Egypt', code: '20' },
  { iso: 'SV', name: 'El Salvador', code: '503' },
  { iso: 'GQ', name: 'Equatorial Guinea', code: '240' },
  { iso: 'ER', name: 'Eritrea', code: '291' },
  { iso: 'EE', name: 'Estonia', code: '372' },
  { iso: 'SZ', name: 'Eswatini', code: '268' },
  { iso: 'ET', name: 'Ethiopia', code: '251' },
  { iso: 'FK', name: 'Falkland Islands', code: '500' },
  { iso: 'FO', name: 'Faroe Islands', code: '298' },
  { iso: 'FJ', name: 'Fiji', code: '679' },
  { iso: 'FI', name: 'Finland', code: '358' },
  { iso: 'FR', name: 'France', code: '33' },
  { iso: 'GF', name: 'French Guiana', code: '594' },
  { iso: 'PF', name: 'French Polynesia', code: '689' },
  { iso: 'GA', name: 'Gabon', code: '241' },
  { iso: 'GM', name: 'Gambia', code: '220' },
  { iso: 'GE', name: 'Georgia', code: '995' },
  { iso: 'DE', name: 'Germany', code: '49' },
  { iso: 'GH', name: 'Ghana', code: '233' },
  { iso: 'GI', name: 'Gibraltar', code: '350' },
  { iso: 'GR', name: 'Greece', code: '30' },
  { iso: 'GL', name: 'Greenland', code: '299' },
  { iso: 'GD', name: 'Grenada', code: '1473' },
  { iso: 'GP', name: 'Guadeloupe', code: '590' },
  { iso: 'GU', name: 'Guam', code: '1671' },
  { iso: 'GT', name: 'Guatemala', code: '502' },
  { iso: 'GG', name: 'Guernsey', code: '1481' },
  { iso: 'GN', name: 'Guinea', code: '224' },
  { iso: 'GW', name: 'Guinea-Bissau', code: '245' },
  { iso: 'GY', name: 'Guyana', code: '592' },
  { iso: 'HT', name: 'Haiti', code: '509' },
  { iso: 'HN', name: 'Honduras', code: '504' },
  { iso: 'HK', name: 'Hong Kong', code: '852' },
  { iso: 'HU', name: 'Hungary', code: '36' },
  { iso: 'IS', name: 'Iceland', code: '354' },
  { iso: 'IN', name: 'India', code: '91' },
  { iso: 'ID', name: 'Indonesia', code: '62' },
  { iso: 'IR', name: 'Iran', code: '98' },
  { iso: 'IQ', name: 'Iraq', code: '964' },
  { iso: 'IE', name: 'Ireland', code: '353' },
  { iso: 'IM', name: 'Isle of Man', code: '1624' },
  { iso: 'IL', name: 'Israel', code: '972' },
  { iso: 'IT', name: 'Italy', code: '39' },
  { iso: 'CI', name: 'Ivory Coast', code: '225' },
  { iso: 'JM', name: 'Jamaica', code: '1876' },
  { iso: 'JP', name: 'Japan', code: '81' },
  { iso: 'JE', name: 'Jersey', code: '1534' },
  { iso: 'JO', name: 'Jordan', code: '962' },
  { iso: 'KZ', name: 'Kazakhstan', code: '7' },
  { iso: 'KE', name: 'Kenya', code: '254' },
  { iso: 'KI', name: 'Kiribati', code: '686' },
  { iso: 'XK', name: 'Kosovo', code: '383' },
  { iso: 'KW', name: 'Kuwait', code: '965' },
  { iso: 'KG', name: 'Kyrgyzstan', code: '996' },
  { iso: 'LA', name: 'Laos', code: '856' },
  { iso: 'LV', name: 'Latvia', code: '371' },
  { iso: 'LB', name: 'Lebanon', code: '961' },
  { iso: 'LS', name: 'Lesotho', code: '266' },
  { iso: 'LR', name: 'Liberia', code: '231' },
  { iso: 'LY', name: 'Libya', code: '218' },
  { iso: 'LI', name: 'Liechtenstein', code: '423' },
  { iso: 'LT', name: 'Lithuania', code: '370' },
  { iso: 'LU', name: 'Luxembourg', code: '352' },
  { iso: 'MG', name: 'Madagascar', code: '261' },
  { iso: 'MW', name: 'Malawi', code: '265' },
  { iso: 'MY', name: 'Malaysia', code: '60' },
  { iso: 'MV', name: 'Maldives', code: '960' },
  { iso: 'ML', name: 'Mali', code: '223' },
  { iso: 'MT', name: 'Malta', code: '356' },
  { iso: 'MH', name: 'Marshall Islands', code: '692' },
  { iso: 'MQ', name: 'Martinique', code: '596' },
  { iso: 'MR', name: 'Mauritania', code: '222' },
  { iso: 'MU', name: 'Mauritius', code: '230' },
  { iso: 'MX', name: 'Mexico', code: '52' },
  { iso: 'FM', name: 'Micronesia', code: '691' },
  { iso: 'MD', name: 'Moldova', code: '373' },
  { iso: 'MC', name: 'Monaco', code: '377' },
  { iso: 'MN', name: 'Mongolia', code: '976' },
  { iso: 'ME', name: 'Montenegro', code: '382' },
  { iso: 'MS', name: 'Montserrat', code: '1664' },
  { iso: 'MA', name: 'Morocco', code: '212' },
  { iso: 'MZ', name: 'Mozambique', code: '258' },
  { iso: 'MM', name: 'Myanmar', code: '95' },
  { iso: 'NA', name: 'Namibia', code: '264' },
  { iso: 'NR', name: 'Nauru', code: '674' },
  { iso: 'NP', name: 'Nepal', code: '977' },
  { iso: 'NL', name: 'Netherlands', code: '31' },
  { iso: 'NC', name: 'New Caledonia', code: '687' },
  { iso: 'NZ', name: 'New Zealand', code: '64' },
  { iso: 'NI', name: 'Nicaragua', code: '505' },
  { iso: 'NE', name: 'Niger', code: '227' },
  { iso: 'NG', name: 'Nigeria', code: '234' },
  { iso: 'NU', name: 'Niue', code: '683' },
  { iso: 'KP', name: 'North Korea', code: '850' },
  { iso: 'MK', name: 'North Macedonia', code: '389' },
  { iso: 'MP', name: 'Northern Mariana Islands', code: '1670' },
  { iso: 'NO', name: 'Norway', code: '47' },
  { iso: 'OM', name: 'Oman', code: '968' },
  { iso: 'PK', name: 'Pakistan', code: '92' },
  { iso: 'PW', name: 'Palau', code: '680' },
  { iso: 'PS', name: 'Palestine', code: '970' },
  { iso: 'PA', name: 'Panama', code: '507' },
  { iso: 'PG', name: 'Papua New Guinea', code: '675' },
  { iso: 'PY', name: 'Paraguay', code: '595' },
  { iso: 'PE', name: 'Peru', code: '51' },
  { iso: 'PH', name: 'Philippines', code: '63' },
  { iso: 'PL', name: 'Poland', code: '48' },
  { iso: 'PT', name: 'Portugal', code: '351' },
  { iso: 'PR', name: 'Puerto Rico', code: '1787' },
  { iso: 'QA', name: 'Qatar', code: '974' },
  { iso: 'RE', name: 'Reunion', code: '262' },
  { iso: 'RO', name: 'Romania', code: '40' },
  { iso: 'RU', name: 'Russia', code: '7' },
  { iso: 'RW', name: 'Rwanda', code: '250' },
  { iso: 'KN', name: 'Saint Kitts and Nevis', code: '1869' },
  { iso: 'LC', name: 'Saint Lucia', code: '1758' },
  { iso: 'VC', name: 'Saint Vincent and the Grenadines', code: '1784' },
  { iso: 'WS', name: 'Samoa', code: '685' },
  { iso: 'SM', name: 'San Marino', code: '378' },
  { iso: 'ST', name: 'Sao Tome and Principe', code: '239' },
  { iso: 'SA', name: 'Saudi Arabia', code: '966' },
  { iso: 'SN', name: 'Senegal', code: '221' },
  { iso: 'RS', name: 'Serbia', code: '381' },
  { iso: 'SC', name: 'Seychelles', code: '248' },
  { iso: 'SL', name: 'Sierra Leone', code: '232' },
  { iso: 'SG', name: 'Singapore', code: '65' },
  { iso: 'SX', name: 'Sint Maarten', code: '1721' },
  { iso: 'SK', name: 'Slovakia', code: '421' },
  { iso: 'SI', name: 'Slovenia', code: '386' },
  { iso: 'SB', name: 'Solomon Islands', code: '677' },
  { iso: 'SO', name: 'Somalia', code: '252' },
  { iso: 'ZA', name: 'South Africa', code: '27' },
  { iso: 'KR', name: 'South Korea', code: '82' },
  { iso: 'SS', name: 'South Sudan', code: '211' },
  { iso: 'ES', name: 'Spain', code: '34' },
  { iso: 'LK', name: 'Sri Lanka', code: '94' },
  { iso: 'SD', name: 'Sudan', code: '249' },
  { iso: 'SR', name: 'Suriname', code: '597' },
  { iso: 'SE', name: 'Sweden', code: '46' },
  { iso: 'CH', name: 'Switzerland', code: '41' },
  { iso: 'SY', name: 'Syria', code: '963' },
  { iso: 'TW', name: 'Taiwan', code: '886' },
  { iso: 'TJ', name: 'Tajikistan', code: '992' },
  { iso: 'TZ', name: 'Tanzania', code: '255' },
  { iso: 'TH', name: 'Thailand', code: '66' },
  { iso: 'TL', name: 'Timor-Leste', code: '670' },
  { iso: 'TG', name: 'Togo', code: '228' },
  { iso: 'TO', name: 'Tonga', code: '676' },
  { iso: 'TT', name: 'Trinidad and Tobago', code: '1868' },
  { iso: 'TN', name: 'Tunisia', code: '216' },
  { iso: 'TR', name: 'Turkey', code: '90' },
  { iso: 'TM', name: 'Turkmenistan', code: '993' },
  { iso: 'TC', name: 'Turks and Caicos', code: '1649' },
  { iso: 'TV', name: 'Tuvalu', code: '688' },
  { iso: 'UG', name: 'Uganda', code: '256' },
  { iso: 'UA', name: 'Ukraine', code: '380' },
  { iso: 'AE', name: 'United Arab Emirates', code: '971' },
  { iso: 'GB', name: 'United Kingdom', code: '44' },
  { iso: 'US', name: 'United States', code: '1' },
  { iso: 'UY', name: 'Uruguay', code: '598' },
  { iso: 'VI', name: 'US Virgin Islands', code: '1340' },
  { iso: 'UZ', name: 'Uzbekistan', code: '998' },
  { iso: 'VU', name: 'Vanuatu', code: '678' },
  { iso: 'VA', name: 'Vatican City', code: '379' },
  { iso: 'VE', name: 'Venezuela', code: '58' },
  { iso: 'VN', name: 'Vietnam', code: '84' },
  { iso: 'WF', name: 'Wallis and Futuna', code: '681' },
  { iso: 'YE', name: 'Yemen', code: '967' },
  { iso: 'ZM', name: 'Zambia', code: '260' },
  { iso: 'ZW', name: 'Zimbabwe', code: '263' },
];

/** Fallback bucket for values that match no known code — kept verbatim. */
export const OTHER_ISO = 'OTHER';

/** Default country for a blank field (this client's home country). */
export const DEFAULT_DIAL_ISO = 'LB';

/** Regional-indicator flag glyph derived from the ISO code (no data table). */
export function flagEmoji(iso: string): string {
  const letters = iso.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length !== 2) return '';
  return String.fromCodePoint(
    ...letters.split('').map((c) => 127397 + c.charCodeAt(0))
  );
}

/**
 * Split stored full-international digits into country + national part.
 * Longest-code-prefix wins; unknown values land in OTHER untouched.
 */
export function splitDialCode(digits: string): { iso: string; code: string; national: string } {
  const clean = (digits || '').replace(/\D/g, '');
  if (!clean) {
    const def = DIAL_CODES.find((c) => c.iso === DEFAULT_DIAL_ISO) as DialCode;
    return { iso: def.iso, code: def.code, national: '' };
  }
  const sorted = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (clean.startsWith(c.code)) {
      return { iso: c.iso, code: c.code, national: clean.slice(c.code.length) };
    }
  }
  return { iso: OTHER_ISO, code: '', national: clean };
}

/**
 * Compose the stored value from a country code + locally-typed national
 * digits. Leading trunk zeros are stripped (Google/libphonenumber behavior);
 * with no country (OTHER) the digits pass through untouched.
 */
export function composeFull(code: string, national: string): string {
  const digits = (national || '').replace(/\D/g, '');
  if (!code) return digits;
  const rest = digits.replace(/^0+/, '');
  if (!rest) return '';
  // A full number pasted without +/00 already starts with the country code.
  // Prefixing it again would save 961961… / 970970… to the store settings.
  if (rest.startsWith(code) && rest.length > 9) return rest;
  return `${code}${rest}`;
}

/** Arabic aliases for the countries an owner is most likely to search for. */
export const DIAL_AR_NAMES: Record<string, string> = {
  LB: 'لبنان',
  EG: 'مصر',
  SA: 'السعودية',
  JO: 'الأردن',
  SY: 'سوريا',
  AE: 'الإمارات',
  IQ: 'العراق',
  PS: 'فلسطين',
  KW: 'الكويت',
  QA: 'قطر',
  OM: 'عمان',
  BH: 'البحرين',
  YE: 'اليمن',
  TR: 'تركيا',
  US: 'الولايات المتحدة',
  GB: 'بريطانيا',
  FR: 'فرنسا',
  DE: 'ألمانيا',
  CA: 'كندا',
  AU: 'أستراليا',
  BR: 'البرازيل',
  ES: 'إسبانيا',
  IT: 'إيطاليا',
};

/**
 * Search the table by English name, Arabic alias, or dial digits
 * ("e" -> Egypt/Yemen/..., "961" -> Lebanon, "لب" -> Lebanon).
 */
export function filterDialCodes(query: string): DialCode[] {
  const raw = (query || '').trim();
  if (!raw) return DIAL_CODES;
  const q = raw.toLowerCase();
  // Digit matching only for digit-ish queries ("961", "+961") — a query
  // with letters ("xyz123") matches names alone, never area codes.
  const qd = /^[+\d\s-]+$/.test(raw) ? raw.replace(/\D/g, '') : '';
  return DIAL_CODES.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    const ar = DIAL_AR_NAMES[c.iso];
    if (ar && ar.includes(raw)) return true;
    if (qd && (c.code.startsWith(qd) || qd.startsWith(c.code))) return true;
    return false;
  });
}
