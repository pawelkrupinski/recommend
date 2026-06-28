// Origin-geography reference: continents and their film-producing countries.
// Single source of truth for the "where is this film from" origin filter — both
// the Settings country picker (served to the browser via /api/origins) and the
// recommendation pool's allowed-origin check (see taste.js matchesOrigin) derive
// from this list. Codes are ISO 3166-1 alpha-2, matching TMDB's
// production_countries[].iso_3166_1.
//
// The list is deliberately film-centric, not exhaustive: a continent filter is
// only as useful as the countries that actually produce the movies people watch.
// Extend a continent's array to widen its reach.
export const CONTINENTS = [
  { code: 'EU', name: 'Europe', countries: [
    ['FR', 'France'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['IT', 'Italy'],
    ['ES', 'Spain'], ['PL', 'Poland'], ['NL', 'Netherlands'], ['SE', 'Sweden'],
    ['DK', 'Denmark'], ['NO', 'Norway'], ['FI', 'Finland'], ['IE', 'Ireland'],
    ['BE', 'Belgium'], ['AT', 'Austria'], ['CH', 'Switzerland'], ['PT', 'Portugal'],
    ['GR', 'Greece'], ['CZ', 'Czechia'], ['HU', 'Hungary'], ['RO', 'Romania'],
    ['RU', 'Russia'], ['UA', 'Ukraine'], ['IS', 'Iceland'], ['RS', 'Serbia'],
    ['HR', 'Croatia'], ['BG', 'Bulgaria'], ['SK', 'Slovakia'], ['EE', 'Estonia'],
    ['LT', 'Lithuania'], ['LV', 'Latvia'],
  ] },
  { code: 'NA', name: 'North America', countries: [
    ['US', 'United States'], ['CA', 'Canada'], ['MX', 'Mexico'],
  ] },
  { code: 'SA', name: 'South America', countries: [
    ['BR', 'Brazil'], ['AR', 'Argentina'], ['CL', 'Chile'], ['CO', 'Colombia'],
    ['PE', 'Peru'], ['UY', 'Uruguay'], ['VE', 'Venezuela'],
  ] },
  { code: 'AS', name: 'Asia', countries: [
    ['JP', 'Japan'], ['KR', 'South Korea'], ['CN', 'China'], ['HK', 'Hong Kong'],
    ['TW', 'Taiwan'], ['IN', 'India'], ['TH', 'Thailand'], ['IR', 'Iran'],
    ['TR', 'Turkey'], ['IL', 'Israel'], ['ID', 'Indonesia'], ['PH', 'Philippines'],
    ['VN', 'Vietnam'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['LB', 'Lebanon'],
    ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'],
  ] },
  { code: 'AF', name: 'Africa', countries: [
    ['ZA', 'South Africa'], ['NG', 'Nigeria'], ['EG', 'Egypt'], ['MA', 'Morocco'],
    ['TN', 'Tunisia'], ['SN', 'Senegal'], ['KE', 'Kenya'], ['DZ', 'Algeria'],
  ] },
  { code: 'OC', name: 'Oceania', countries: [
    ['AU', 'Australia'], ['NZ', 'New Zealand'],
  ] },
];

// Country codes belonging to a continent (empty for an unknown/blank code).
export function countriesInContinent(continentCode) {
  const c = CONTINENTS.find((x) => x.code === continentCode);
  return c ? c.countries.map(([code]) => code) : [];
}

// The set of country codes an origin filter permits, given a chosen continent
// (broad) plus explicitly chosen countries (narrow) — their union. An empty set
// means "no origin restriction": every country passes.
export function allowedOriginSet({ continent, countries } = {}) {
  const set = new Set(countriesInContinent(continent));
  for (const code of countries || []) set.add(code);
  return set;
}
