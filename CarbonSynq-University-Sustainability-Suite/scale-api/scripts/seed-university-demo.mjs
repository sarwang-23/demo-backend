// Synthetic demonstration seeding for an isolated rehearsal tenant. Every record is labelled SYNTHETIC DEMO.
// It creates no factors or claims about real activity data: values are illustrative placeholders for a product walkthrough.
// Usage: node --env-file-if-exists=.env scripts/seed-university-demo.mjs [--phase=all|1-identity,...]
// A fresh tenant must come from scripts/provision.mjs; this script never provisions, deletes or resets a tenant.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const BASE = process.env.DEMO_BASE || 'http://localhost:5000';
const SAMPLES = fileURLToPath(new URL('../../samples/', import.meta.url));
const EVIDENCE_DIR = process.env.DEMO_EVIDENCE_DIR || tmpdir() + '/carbonsynq-demo-evidence';
const STATE_FILE = EVIDENCE_DIR + '/seed-state.json';
const TENANT_ID = process.env.DEMO_TENANT_ID || '';
const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL || 'admin@university.example';
const REVIEWER_EMAIL = process.env.DEMO_REVIEWER_EMAIL || 'reviewer@university.example';
const PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'Demo@12345678';
const REVIEW_PASSWORD = process.env.DEMO_REVIEWER_PASSWORD || 'Review@123456';
const SAMPLE_PDF = SAMPLES + '/sample-electricity.pdf';
// Document uploads are deduplicated per tenant by content hash, so the second invoice confirmation needs its own copy.
const SAMPLE_PDF_2 = EVIDENCE_DIR + '/demo-evidence-electricity-second-period.pdf';
const DIESEL_CSV = EVIDENCE_DIR + '/demo-evidence-diesel-deliveries.csv';
const WASTE_TXT = EVIDENCE_DIR + '/demo-evidence-waste-manifest.txt';
const KPI_CSV = EVIDENCE_DIR + '/demo-evidence-campus-meter-readings.csv';
const KPI_CSV_2 = EVIDENCE_DIR + '/demo-evidence-water-waste-meter-log.csv';
mkdirSync(EVIDENCE_DIR, { recursive: true });

const phaseArg = (process.argv.find(a => a.startsWith('--phase=')) || '').split('=')[1] || 'all';
const only = new Set(phaseArg.split(',').map(s => s.trim()).filter(Boolean));
if (!TENANT_ID) throw Error('DEMO_TENANT_ID is required. Provision an isolated tenant with scripts/provision.mjs first.');

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const log = (...a) => console.log(...a);

async function req(method, path, o = {}) {
  const headers = { ...(o.headers || {}) };
  if (o.token) headers.Authorization = 'Bearer ' + o.token;
  if (o.capability) headers.Authorization = 'Capability ' + o.capability;
  if (o.raw) headers['Content-Type'] = headers['Content-Type'] || 'application/octet-stream';
  else if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && !o.capability) headers['Idempotency-Key'] = o.key || randomUUID().replace(/-/g, '');
  const res = await fetch(BASE + path, { method, headers, body: o.raw || (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { }
  if (!res.ok) {
    if (res.status === 401 && !o.__retry && !o.capability) {
      const kind = kindOf(o.token);
      if (kind) {
        const token = await freshToken(kind);
        return req(method, path, { ...o, token, __retry: true });
      }
    }
    const err = json?.error || {};
    const e = new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (err.code || '') + ': ' + (err.message || text.slice(0, 400)));
    e.status = res.status; e.details = err.details; throw e;
  }
  return json?.data ?? json;
}

const TOKENS = {
  admin: ['tokenAdmin', ADMIN_EMAIL, PASSWORD],
  reviewer: ['tokenReviewer', REVIEWER_EMAIL, REVIEW_PASSWORD],
  entryEnergy: ['tokenEntryEnergy', 'energy.data@university.example', PASSWORD],
  entryAnalyst: ['tokenEntryAnalyst', 'sustainability.analyst@university.example', PASSWORD],
};
const TOKEN_FIELD = { admin: 'admin', reviewer: 'reviewer', entryEnergy: 'entryEnergyToken', entryAnalyst: 'entryAnalystToken' };
const kindOf = token => { if (!token) return null; return Object.keys(TOKENS).find(k => token === T[TOKEN_FIELD[k]] || token === state[TOKENS[k][0]]) || null; };

async function freshToken(kind) {
  const [key, email, password] = TOKENS[kind];
  const r = await req('POST', '/api/v2/auth/login', { body: { tenantId: TENANT_ID, email, password } });
  const token = r.token || r.sessionToken || r.accessToken;
  state[key] = token; save();
  T[TOKEN_FIELD[kind]] = token;
  return token;
}

async function loginCached(kind) { return state[TOKENS[kind][0]] || freshToken(kind); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function list(token, path) {
  const out = [];
  let cursor = null;
  const sep = path.includes('?') ? '&' : '?';
  for (let i = 0; i < 30; i++) {
    const q = cursor ? sep + 'limit=100&cursor=' + encodeURIComponent(cursor) : sep + 'limit=100';
    const page = await req('GET', path + q, { token });
    out.push(...(page.items || []));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

async function download(token, path) {
  const res = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
  const text = await res.text();
  if (!res.ok) { let json = null; try { json = JSON.parse(text); } catch { } throw new Error('GET ' + path + ' -> ' + res.status + ' ' + (json?.error?.code || '') + ': ' + (json?.error?.message || text.slice(0, 300))); }
  return { bytes: text, contentType: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '' };
}

const PERIODS = {
  'FY2024-25': { name: 'FY2024-25', startDate: '2024-04-01', endDate: '2025-03-31' },
  'FY2025-26': { name: 'FY2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
  'FY2026-27': { name: 'FY2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
};

const HIST_EMISSIONS = {
  'FY2024-25': [
    ['MAIN', 'REFRIGERANT_LEAKAGE', 'kg', '42', '2024-08-31', 'MEASURED', 'SYNTHETIC DEMO: R-134a top-ups reconciled with service reports.'],
    ['MAIN', 'PURCHASED_HEAT', 'kWh', '1850000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: district heating metered at the Main Campus plant room.'],
    ['MAIN', 'PURCHASED_COOLING', 'kWh', '640000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: chilled water delivered to Main Campus buildings.'],
    ['MAIN', 'PURCHASED_GOODS', 'kg', '210000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: stationery, laboratory consumables and contract services.'],
    ['MAIN', 'FOOD_PURCHASES', 'kg', '480000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: canteen and hostel catering purchases by mass.'],
    ['MAIN', 'WATER_SUPPLY', 'm3', '92000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: municipal water meter reads, Main Campus.'],
    ['MAIN', 'WASTE_TREATMENT', 'kg', '185000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: non-hazardous waste weighed at the gate.'],
    ['MAIN', 'WASTEWATER', 'm3', '88000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: sewer discharge estimated from water balance.'],
    ['MAIN', 'BUSINESS_TRAVEL', 'passenger_km', '1250000', '2025-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: travel desk records extrapolated for unreturned claims.'],
    ['MAIN', 'EMPLOYEE_COMMUTING', 'passenger_km', '4800000', '2025-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: staff commute survey extrapolated to all employees.'],
    ['MAIN', 'STUDENT_COMMUTING', 'passenger_km', '12500000', '2025-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: student travel survey; supplemental university boundary.'],
    ['MAIN', 'STUDENT_TRAVEL', 'passenger_km', '3100000', '2025-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: student society and placement travel; supplemental only.'],
    ['NORTH', 'WATER_SUPPLY', 'm3', '41000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: municipal water meter reads, North Campus.'],
    ['NORTH', 'WASTE_TREATMENT', 'kg', '72000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: non-hazardous waste weighed at the gate.'],
    ['NORTH', 'PURCHASED_COOLING', 'kWh', '310000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: chilled water delivered to the library and academic blocks.'],
    ['NORTH', 'FOOD_PURCHASES', 'kg', '165000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: North Campus refectory purchases by mass.'],
    ['SOUTH', 'PURCHASED_HEAT', 'kWh', '980000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: district heating supplied to South Campus hostels.'],
    ['SOUTH', 'WASTE_TREATMENT', 'kg', '58000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: hostel and residential waste weighed at the gate.'],
    ['SOUTH', 'WATER_SUPPLY', 'm3', '33000', '2025-03-31', 'MEASURED', 'SYNTHETIC DEMO: municipal water meter reads, South Campus.'],
    ['SOUTH', 'BUSINESS_TRAVEL', 'passenger_km', '320000', '2025-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: travel desk records extrapolated for unreturned claims.'],
  ],
  'FY2025-26': [
    ['MAIN', 'REFRIGERANT_LEAKAGE', 'kg', '38', '2025-08-31', 'MEASURED', 'SYNTHETIC DEMO: R-134a top-ups reconciled with service reports.'],
    ['MAIN', 'PURCHASED_HEAT', 'kWh', '1776000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: district heating metered at the Main Campus plant room.'],
    ['MAIN', 'PURCHASED_COOLING', 'kWh', '620000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: chilled water delivered to Main Campus buildings.'],
    ['MAIN', 'PURCHASED_GOODS', 'kg', '216000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: stationery, laboratory consumables and contract services.'],
    ['MAIN', 'FOOD_PURCHASES', 'kg', '490000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: canteen and hostel catering purchases by mass.'],
    ['MAIN', 'WATER_SUPPLY', 'm3', '92000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: municipal water meter reads, Main Campus.'],
    ['MAIN', 'WASTE_TREATMENT', 'kg', '188000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: non-hazardous waste weighed at the gate.'],
    ['MAIN', 'WASTEWATER', 'm3', '90000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: sewer discharge estimated from water balance.'],
    ['MAIN', 'BUSINESS_TRAVEL', 'passenger_km', '1280000', '2026-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: travel desk records extrapolated for unreturned claims.'],
    ['MAIN', 'EMPLOYEE_COMMUTING', 'passenger_km', '4850000', '2026-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: staff commute survey extrapolated to all employees.'],
    ['MAIN', 'STUDENT_COMMUTING', 'passenger_km', '12700000', '2026-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: student travel survey; supplemental university boundary.'],
    ['MAIN', 'STUDENT_TRAVEL', 'passenger_km', '3180000', '2026-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: student society and placement travel; supplemental only.'],
    ['NORTH', 'WATER_SUPPLY', 'm3', '42000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: municipal water meter reads, North Campus.'],
    ['NORTH', 'WASTE_TREATMENT', 'kg', '70000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: non-hazardous waste weighed at the gate.'],
    ['NORTH', 'PURCHASED_COOLING', 'kWh', '305000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: chilled water delivered to the library and academic blocks.'],
    ['NORTH', 'FOOD_PURCHASES', 'kg', '170000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: North Campus refectory purchases by mass.'],
    ['SOUTH', 'PURCHASED_HEAT', 'kWh', '940000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: district heating supplied to South Campus hostels.'],
    ['SOUTH', 'WASTE_TREATMENT', 'kg', '56000', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: hostel and residential waste weighed at the gate.'],
    ['SOUTH', 'WATER_SUPPLY', 'm3', '33500', '2026-03-31', 'MEASURED', 'SYNTHETIC DEMO: municipal water meter reads, South Campus.'],
    ['SOUTH', 'BUSINESS_TRAVEL', 'passenger_km', '325000', '2026-03-31', 'ESTIMATED', 'SYNTHETIC DEMO: travel desk records extrapolated for unreturned claims.'],
  ],
};

const CURRENT_EMISSIONS = [
  ['MAIN', 'PURCHASED_GOODS', 'kg', '240000', 'MEASURED', 'SYNTHETIC DEMO: procurement ledger spend converted to physical mass by category.'],
  ['MAIN', 'FOOD_PURCHASES', 'kg', '520000', 'MEASURED', 'SYNTHETIC DEMO: catering invoices by mass across all campuses.'],
  ['MAIN', 'WATER_SUPPLY', 'm3', '98000', 'MEASURED', 'SYNTHETIC DEMO: municipal water meter reads, Main Campus.'],
  ['MAIN', 'EMPLOYEE_COMMUTING', 'passenger_km', '5050000', 'ESTIMATED', 'SYNTHETIC DEMO: staff commute survey extrapolated to all employees.'],
  ['MAIN', 'STUDENT_COMMUTING', 'passenger_km', '13100000', 'ESTIMATED', 'SYNTHETIC DEMO: student travel survey; supplemental university boundary.'],
  ['NORTH', 'BUSINESS_TRAVEL', 'passenger_km', '1400000', 'ESTIMATED', 'SYNTHETIC DEMO: travel desk records extrapolated for unreturned claims.'],
  ['NORTH', 'UPSTREAM_ENERGY', 'kWh', '1200000', 'ESTIMATED', 'SYNTHETIC DEMO: upstream of campus fuel and electricity, excluding Scope 1 and 2.'],
  ['NORTH', 'UPSTREAM_LEASED_ASSETS', 'kWh', '410000', 'ESTIMATED', 'SYNTHETIC DEMO: landlord-supplied energy for leased premises outside Scope 1 and 2.'],
  ['NORTH', 'HOTEL_STAYS', 'room_night', '6400', 'ESTIMATED', 'SYNTHETIC DEMO: hotel nights booked for conferences and field visits.'],
  ['NORTH', 'CAPITAL_GOODS', 'item', '1250', 'MEASURED', 'SYNTHETIC DEMO: capital equipment and construction items delivered in year.'],
  ['SOUTH', 'WASTE_TREATMENT', 'kg', '195000', 'MEASURED', 'SYNTHETIC DEMO: hostel and residential waste weighed at the gate.'],
  ['SOUTH', 'WASTEWATER', 'm3', '92000', 'MEASURED', 'SYNTHETIC DEMO: sewer discharge estimated from water balance.'],
  ['SOUTH', 'UPSTREAM_FREIGHT', 'tonne_km', '320000', 'MEASURED', 'SYNTHETIC DEMO: inbound deliveries by mass and distance from carrier records.'],
];

const SCREEN_RATIONALE = 'SYNTHETIC DEMO screening decision recorded for the demonstration tenant only.';
const screeningPlan = (key) => ([
  [1, 'INCLUDED', 'SYNTHETIC DEMO: purchased goods, food and water are material to the demonstration inventory.'],
  [2, 'INCLUDED', 'SYNTHETIC DEMO: capital goods and construction are included in the demonstration inventory.'],
  [3, key === 'FY2026-27' ? 'INCLUDED' : 'EXCLUDED', key === 'FY2026-27' ? 'SYNTHETIC DEMO: upstream energy included to show a category 3 record.' : 'SYNTHETIC DEMO: upstream energy excluded, no reviewed activity data available.'],
  [4, 'INCLUDED', 'SYNTHETIC DEMO: inbound freight is material for a residential campus.'],
  [5, 'INCLUDED', 'SYNTHETIC DEMO: waste and wastewater treatment are material for a residential campus.'],
  [6, 'INCLUDED', 'SYNTHETIC DEMO: business travel and hotel stays are material for an academic institution.'],
  [7, 'INCLUDED', 'SYNTHETIC DEMO: employee commuting is material for a residential campus.'],
  [8, key === 'FY2026-27' ? 'INCLUDED' : 'EXCLUDED', key === 'FY2026-27' ? 'SYNTHETIC DEMO: landlord-supplied leased asset energy is included in this period.' : 'SYNTHETIC DEMO: leased assets excluded, landlord data not available for this period.'],
  ...[9, 10, 11, 12, 13, 14, 15].map(n => [n, 'NOT_ASSESSED', 'SYNTHETIC DEMO: not relevant to the demonstration university value chain.']),
]);

const FACTORS = [
  ['REFRIGERANT_LEAKAGE', 'kg', '1430', 'SYNTHETIC DEMO value for R-134a; illustrative only, not an official published factor.'],
  ['PURCHASED_HEAT', 'kWh', '0.18', 'SYNTHETIC DEMO district heating value; illustrative only.'],
  ['PURCHASED_COOLING', 'kWh', '0.15', 'SYNTHETIC DEMO chilled water value; illustrative only.'],
  ['PURCHASED_GOODS', 'kg', '2.4', 'SYNTHETIC DEMO purchased goods and services value; illustrative only.'],
  ['FOOD_PURCHASES', 'kg', '1.9', 'SYNTHETIC DEMO catering value; illustrative only.'],
  ['WATER_SUPPLY', 'm3', '0.42', 'SYNTHETIC DEMO water supply value; illustrative only.'],
  ['WASTE_TREATMENT', 'kg', '0.58', 'SYNTHETIC DEMO mixed waste treatment value; illustrative only.'],
  ['WASTEWATER', 'm3', '0.55', 'SYNTHETIC DEMO wastewater treatment value; illustrative only.'],
  ['BUSINESS_TRAVEL', 'passenger_km', '0.156', 'SYNTHETIC DEMO average air and rail business travel value; illustrative only.'],
  ['HOTEL_STAYS', 'room_night', '12.5', 'SYNTHETIC DEMO business accommodation value; illustrative only.'],
  ['EMPLOYEE_COMMUTING', 'passenger_km', '0.104', 'SYNTHETIC DEMO staff commuting value; illustrative only.'],
  ['UPSTREAM_LEASED_ASSETS', 'kWh', '0.09', 'SYNTHETIC DEMO landlord supplied energy value; illustrative only.'],
  ['UPSTREAM_ENERGY', 'kWh', '0.045', 'SYNTHETIC DEMO upstream fuel and electricity value; illustrative only.'],
  ['UPSTREAM_FREIGHT', 'tonne_km', '0.062', 'SYNTHETIC DEMO inbound freight value; illustrative only.'],
  ['CAPITAL_GOODS', 'item', '8500', 'SYNTHETIC DEMO capital goods value per item; illustrative only.'],
  ['STUDENT_COMMUTING', 'passenger_km', '0.098', 'SYNTHETIC DEMO student commuting value; supplemental boundary.'],
  ['STUDENT_TRAVEL', 'passenger_km', '0.121', 'SYNTHETIC DEMO student travel value; supplemental boundary.'],
  ['PCF_ENERGY', 'kWh', '0.65', 'SYNTHETIC DEMO process energy screening value; PCF only, never inventory.'],
  ['PCF_MATERIAL', 'kg', '3.1', 'SYNTHETIC DEMO material screening value; PCF only, never inventory.'],
];

const KPI_TASKS = {
  normalization: [['STUDENT_FTE', 'FTE'], ['STAFF_FTE', 'FTE'], ['FLOOR_AREA_M2', 'm2']],
  operational: [['WATER_WITHDRAWAL_M3', 'm3'], ['WASTE_GENERATED_KG', 'kg']],
};

const BOUNDARY_STATEMENT = 'SYNTHETIC DEMO boundary: operational control over the Main, North and South campuses of CarbonSynq Demo University for the full financial year, covering purchased energy, refrigerant leakage, purchased goods and services, waste and wastewater, business travel and employee commuting, with student commuting and student travel reported as supplemental only. Every figure is illustrative demonstration data and is not independently assured.';

const CARBON_SOURCES = [
  ['MAIN', 'GRID-ELEC-MAIN', 'Main Campus grid electricity supply', 'PURCHASED_ELECTRICITY', 'ELECTRICITY', 'kWh', 'ADMINISTRATION', 'SYNTHETIC DEMO: utility account for the Main Campus HT intake.'],
  ['MAIN', 'DG-SET-MAIN', 'Main Campus standby diesel generator', 'STATIONARY_COMBUSTION', 'DIESEL', 'litre', 'ACADEMIC', 'SYNTHETIC DEMO: standby generator serving examinations and emergency power.'],
  ['MAIN', 'FLEET-DIESEL-MAIN', 'Main Campus owned bus fleet', 'MOBILE_COMBUSTION', 'DIESEL', 'litre', 'OTHER', 'SYNTHETIC DEMO: university owned buses and grounds vehicles.'],
  ['MAIN', 'CHILLER-R32-MAIN', 'Main Campus laboratory chillers and split units', 'REFRIGERANT', 'R32', 'kg', 'LABORATORY', 'SYNTHETIC DEMO: R-32 charge in laboratory and library cooling equipment.'],
  ['NORTH', 'GRID-ELEC-NORTH', 'North Campus grid electricity supply', 'PURCHASED_ELECTRICITY', 'ELECTRICITY', 'kWh', 'ACADEMIC', 'SYNTHETIC DEMO: utility account for the North Campus HT intake.'],
  ['SOUTH', 'GRID-ELEC-SOUTH', 'South Campus grid electricity supply', 'PURCHASED_ELECTRICITY', 'ELECTRICITY', 'kWh', 'HOSTEL', 'SYNTHETIC DEMO: utility account for the South Campus residential estate.'],
  ['SOUTH', 'STEAM-SOUTH', 'South Campus district steam for hostels', 'PURCHASED_STEAM', 'STEAM', 'kWh', 'HOSTEL', 'SYNTHETIC DEMO: district steam supplied in delivered energy units.'],
];

const SCREENING_CODES = ['DG_BOILERS_KITCHENS', 'OWNED_FLEET', 'AC_CHILLERS', 'LAB_HOSPITAL_GASES', 'CAMPUS_PROCESSES', 'GRID_AND_PPA', 'DISTRICT_ENERGY', 'SOLAR_ATTRIBUTES'];
const screeningKinds = { DG_BOILERS_KITCHENS: 'STATIONARY_COMBUSTION', OWNED_FLEET: 'MOBILE_COMBUSTION', AC_CHILLERS: 'REFRIGERANT', LAB_HOSPITAL_GASES: 'DIRECT_GAS', CAMPUS_PROCESSES: 'ONSITE_PROCESS', GRID_AND_PPA: 'PURCHASED_ELECTRICITY', DISTRICT_ENERGY: 'THERMAL_ENERGY' };
const THERMAL_SOURCE_KINDS = ['PURCHASED_STEAM', 'PURCHASED_HEAT', 'PURCHASED_COOLING'];

function carbonScreeningFor(campusKey, sourceRows) {
  const kinds = new Set(sourceRows.filter(s => s.campusKey === campusKey).map(s => s.kind));
  return SCREENING_CODES.map(code => {
    if (code === 'SOLAR_ATTRIBUTES') {
      const present = campusKey === 'MAIN';
      return [code, present ? 'PRESENT' : 'NOT_APPLICABLE', present ? 'SYNTHETIC DEMO: rooftop solar generation and exports are metered on this campus.' : 'SYNTHETIC DEMO: no on-site generation recorded for this campus.'];
    }
    const present = screeningKinds[code] === 'THERMAL_ENERGY' ? THERMAL_SOURCE_KINDS.some(k => kinds.has(k)) : kinds.has(screeningKinds[code]);
    return [code, present ? 'PRESENT' : 'NOT_APPLICABLE', present ? 'SYNTHETIC DEMO: a registered source of this kind exists on this campus.' : 'SYNTHETIC DEMO: no registered source of this kind exists on this campus.'];
  });
}

const CARBON_RECORDS = [
  ['GRID-ELEC-MAIN', '2026-04-01', '2026-06-30', { mode: 'ELECTRICITY_BALANCE', grossImportsKwh: '1120000', onsiteGenerationKwh: '180000', exportsKwh: '40000' }, 'elc', 150000],
  ['GRID-ELEC-MAIN', '2026-07-01', '2026-09-30', { mode: 'METER', unit: 'kWh', opening: '1120000', closing: '2240000', multiplier: '1' }, 'elc', 150000],
  ['GRID-ELEC-MAIN', '2026-10-01', '2026-12-31', { mode: 'METER', unit: 'kWh', opening: '2240000', closing: '3390000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-MAIN', '2027-01-01', '2027-03-31', { mode: 'METER', unit: 'kWh', opening: '3390000', closing: '4500000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-NORTH', '2026-04-01', '2026-06-30', { mode: 'METER', unit: 'kWh', opening: '1000000', closing: '1520000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-NORTH', '2026-07-01', '2026-09-30', { mode: 'METER', unit: 'kWh', opening: '1520000', closing: '2080000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-NORTH', '2026-10-01', '2026-12-31', { mode: 'METER', unit: 'kWh', opening: '2080000', closing: '2665000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-NORTH', '2027-01-01', '2027-03-31', { mode: 'METER', unit: 'kWh', opening: '2665000', closing: '3250000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-SOUTH', '2026-04-01', '2026-06-30', { mode: 'METER', unit: 'kWh', opening: '500000', closing: '790000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-SOUTH', '2026-07-01', '2026-09-30', { mode: 'METER', unit: 'kWh', opening: '790000', closing: '1100000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-SOUTH', '2026-10-01', '2026-12-31', { mode: 'METER', unit: 'kWh', opening: '1100000', closing: '1425000', multiplier: '1' }, 'elc', 0],
  ['GRID-ELEC-SOUTH', '2027-01-01', '2027-03-31', { mode: 'METER', unit: 'kWh', opening: '1425000', closing: '1750000', multiplier: '1' }, 'elc', 0],
  ['DG-SET-MAIN', '2026-04-01', '2027-03-31', { mode: 'FUEL_STOCK', unit: 'litre', opening: '1200', received: '9000', transfersIn: '0', closing: '900', transfersOut: '300' }, 'dsl', 0],
  ['FLEET-DIESEL-MAIN', '2026-04-01', '2027-03-31', { mode: 'FUEL_STOCK', unit: 'litre', opening: '300', received: '4200', transfersIn: '0', closing: '250', transfersOut: '0' }, 'dsl', 0],
  ['CHILLER-R32-MAIN', '2026-04-01', '2027-03-31', { mode: 'REFRIGERANT_BALANCE', openingEquipmentKg: '120', openingStockKg: '40', acquiredKg: '25', closingEquipmentKg: '120', closingStockKg: '55', transferredOutKg: '5' }, 'dsl', 0],
  ['STEAM-SOUTH', '2026-04-01', '2027-03-31', { mode: 'ENERGY_CONVERSION', quantity: '1500', unit: 'GJ' }, 'dsl', 0],
];

const CARBON_FACTORS = [
  ['C-DIESEL-STATIONARY', 'Diesel generator combustion', 'STATIONARY_COMBUSTION', 'DIESEL', 'litre', 'DIRECT', [{ gas: 'CO2E', massPerUnit: '2.68', gwp: '1' }], 'Direct combustion, all-gas CO2e shorthand for the demonstration tenant.'],
  ['C-DIESEL-MOBILE', 'University fleet diesel combustion', 'MOBILE_COMBUSTION', 'DIESEL', 'litre', 'DIRECT', [{ gas: 'CO2E', massPerUnit: '2.7', gwp: '1' }], 'Direct combustion, all-gas CO2e shorthand for the demonstration tenant.'],
  ['C-R32-REFRIGERANT', 'R-32 refrigerant release', 'REFRIGERANT', 'R32', 'kg', 'DIRECT', [{ gas: 'R32', massPerUnit: '1', gwp: '675' }], 'Gas-specific 100-year global warming potential for the demonstration tenant.'],
  ['C-STEAM-LOCATION', 'District steam generation only', 'PURCHASED_STEAM', 'STEAM', 'kWh', 'LOCATION', [{ gas: 'CO2E', massPerUnit: '0.18', gwp: '1' }], 'Generation-only, upstream fuel and network excluded.'],
  ['C-STEAM-RESIDUAL', 'Residual district steam mix for unmatched delivered load', 'PURCHASED_STEAM', 'STEAM', 'kWh', 'RESIDUAL', [{ gas: 'CO2E', massPerUnit: '0.22', gwp: '1' }], 'Residual mix applied to delivered steam not covered by a reviewed supplier product allocation.'],
  ['C-ELEC-LOCATION', 'Grid electricity generation only', 'PURCHASED_ELECTRICITY', 'ELECTRICITY', 'kWh', 'LOCATION', [{ gas: 'CO2E', massPerUnit: '0.71', gwp: '1' }], 'Generation-only location-based value, upstream fuel and network excluded.'],
  ['C-ELEC-MARKET', 'Rooftop PPA contracted electricity', 'PURCHASED_ELECTRICITY', 'ELECTRICITY', 'kWh', 'MARKET_CONTRACT', [{ gas: 'CO2E', massPerUnit: '0.05', gwp: '1' }], 'Contractual supplier factor for the registered rooftop PPA.'],
  ['C-ELEC-RESIDUAL', 'Residual grid mix for unmatched load', 'PURCHASED_ELECTRICITY', 'ELECTRICITY', 'kWh', 'RESIDUAL', [{ gas: 'CO2E', massPerUnit: '0.78', gwp: '1' }], 'Residual mix applied to consumption not covered by a reviewed instrument.'],
];

const MATERIALITY_TOPICS = [
  ['CLIMATE_CHANGE', 'Climate change mitigation and adaptation'],
  ['ENERGY_TRANSITION', 'Campus energy transition and decarbonisation'],
  ['WASTE_CIRCULARITY', 'Waste reduction and circular purchasing'],
  ['WATER_STEWARDSHIP', 'Water stewardship on a residential campus'],
  ['DIVERSITY_INCLUSION', 'Diversity, equity and inclusion'],
  ['RESEARCH_INNOVATION', 'Sustainability research and open innovation'],
];
const STAKEHOLDER_GROUPS = ['STUDENTS', 'FACULTY', 'STAFF', 'SUPPLIERS', 'COMMUNITY', 'LEADERSHIP'];

let T = { ...state };
const phases = [];
const phase = (name, fn) => phases.push([name, fn]);
const run = async (name, fn) => { if (only.has('all') || only.has(name)) { log('\n=== PHASE ' + name + ' ==='); await fn(); } };

phase('1-identity', async () => {
  T.admin = await loginCached('admin');
  T.reviewer = await loginCached('reviewer');
  log('logged in as admin and reviewer');
  const meta = await req('GET', '/api/v2/meta', { token: T.admin });
  T.tenantName = meta.tenant.name;
  state.tenantName = meta.tenant.name; save();
  log('tenant:', T.tenantName);
  const users = await list(T.admin, '/api/v2/users');
  const ensure = async (email, name, role) => {
    let u = users.find(x => x.email === email);
    if (!u) u = await req('POST', '/api/v2/users', { token: T.admin, body: { name, email, role, password: PASSWORD } });
    return u.id;
  };
  T.entryEnergy = await memoAsync('entryEnergy', () => ensure('energy.data@university.example', 'Campus Energy Data Team', 'ENTRY'));
  T.entryAnalyst = await memoAsync('entryAnalyst', () => ensure('sustainability.analyst@university.example', 'Sustainability Analyst', 'ENTRY'));
  T.leadership = await memoAsync('leadership', () => ensure('vc.operations@university.example', 'Vice Chancellor Operations', 'LEADERSHIP'));
  T.entryEnergyToken = state.entryEnergyToken || await loginCached('entryEnergy');
  T.entryAnalystToken = state.entryAnalystToken || await loginCached('entryAnalyst');
  const campuses = await list(T.admin, '/api/v2/campuses');
  const main = campuses.find(c => /main/i.test(c.name)) || campuses[0];
  T.main = main.id; T.mainName = main.name;
  state.main = main.id; state.mainName = main.name; save();
  T.north = await memoAsync('north', async () => {
    const all = await list(T.admin, '/api/v2/campuses');
    let c = all.find(x => x.code === 'NC' || /north/i.test(x.name));
    if (!c) c = await req('POST', '/api/v2/campuses', { token: T.admin, body: { name: 'North Campus', code: 'NC' } });
    return c.id;
  });
  T.south = await memoAsync('south', async () => {
    const all = await list(T.admin, '/api/v2/campuses');
    let c = all.find(x => x.code === 'SC' || /south/i.test(x.name));
    if (!c) c = await req('POST', '/api/v2/campuses', { token: T.admin, body: { name: 'South Campus', code: 'SC' } });
    return c.id;
  });
  state.north = T.north; state.south = T.south; save();
  const periods = await list(T.admin, '/api/v2/periods');
  for (const key of Object.keys(PERIODS)) {
    const spec = PERIODS[key];
    let p = periods.find(x => x.name === spec.name);
    if (!p) p = await req('POST', '/api/v2/periods', { token: T.admin, body: spec });
    T[key] = p.id; state['period_' + key] = p.id;
  }
  save();
  const buildings = await list(T.admin, '/api/v2/buildings');
  T.mainBuilding = (buildings.find(b => b.campus_id === T.main) || {}).id;
  const ensureBuilding = async (campusId, name) => {
    const all = await list(T.admin, '/api/v2/buildings');
    let b = all.find(x => x.campus_id === campusId && x.name === name);
    if (!b) b = await req('POST', '/api/v2/buildings', { token: T.admin, body: { name, campusId } });
    return b.id;
  };
  T.northLibrary = await memoAsync('northLibrary', () => ensureBuilding(T.north, 'Central Library'));
  T.northBlock = await memoAsync('northBlock', () => ensureBuilding(T.north, 'Academic Block A'));
  T.southHostel = await memoAsync('southHostel', () => ensureBuilding(T.south, 'Student Hostel Block'));
  const depts = await list(T.admin, '/api/v2/university/departments');
  const ensureDept = async (campusId, name, code, ownerId) => {
    let d = depts.find(x => x.code === code);
    if (!d) d = await req('POST', '/api/v2/university/departments', { token: T.admin, body: { campusId, name, code, ownerId } });
    return d.id;
  };
  T.deptFacilities = await memoAsync('deptFacilities', () => ensureDept(T.main, 'Facilities and Estates', 'FAC', T.entryEnergy));
  T.deptTransport = await memoAsync('deptTransport', () => ensureDept(T.main, 'Transport and Fleet', 'TRN', T.entryEnergy));
  T.deptHostel = await memoAsync('deptHostel', () => ensureDept(T.south, 'Hostel Management', 'HST', T.entryAnalyst));
  T.campusOf = { MAIN: T.main, NORTH: T.north, SOUTH: T.south };
  const allCampuses = await list(T.admin, '/api/v2/campuses');
  T.otherCampuses = allCampuses.filter(c => ![T.main, T.north, T.south].includes(c.id));
  state.campusOf = T.campusOf; save();
  const users2 = await list(T.admin, '/api/v2/users');
  T.reviewersId = (users2.find(u => u.role === 'REVIEWER') || users2[0]).id;
  const kpiList = await list(T.admin, '/api/v2/university/kpis');
  T.kpi = Object.fromEntries(kpiList.map(k => [k.code, k]));
  log('campuses', T.mainName, T.north, T.south, 'other registered campuses excluded from the Scope 1/2 plan:', T.otherCampuses.length, '| KPI definitions:', kpiList.length);
});

async function memoAsync(key, fn) { if (state[key] === undefined) { state[key] = await fn(); save(); } return state[key]; }

phase('2-evidence', async () => {
  if (!existsSync(DIESEL_CSV)) writeFileSync(DIESEL_CSV, 'SYNTHETIC DEMO EVIDENCE - NOT A REAL DELIVERY RECORD\ndate,vehicle,litres,site\n2026-06-18,DEMO-VAN-01,1200,Main Campus generator room\n2026-08-14,DEMO-VAN-02,1500,Main Campus generator room\n2026-11-20,DEMO-VAN-01,1800,South Campus depot\n2027-02-11,DEMO-VAN-03,1400,Main Campus generator room\n');
  if (!existsSync(WASTE_TXT)) writeFileSync(WASTE_TXT, 'SYNTHETIC DEMO EVIDENCE - NOT A REAL WASTE MANIFEST\nNorth Campus non-hazardous waste transfer note\nQuarter 1: 18,400 kg | Quarter 2: 17,600 kg | Quarter 3: 17,200 kg | Quarter 4: 16,800 kg\nRecovery route: municipal recycling and landfill\n');
  if (!existsSync(KPI_CSV)) writeFileSync(KPI_CSV, 'SYNTHETIC DEMO EVIDENCE - NOT A REAL METER LOG\ndate,meter,kWh\n2026-04-01,MAIN-HT-01,332000\n2026-06-30,MAIN-HT-01,318500\n2026-09-30,MAIN-HT-01,325400\n2026-12-31,MAIN-HT-01,341200\n');
  if (!existsSync(KPI_CSV_2)) writeFileSync(KPI_CSV_2, 'SYNTHETIC DEMO EVIDENCE - NOT A REAL WATER METER LOG\ndate,water_m3,waste_kg\n2026-04-01,18400,17600\n2026-06-30,17900,16800\n2026-09-30,18100,15900\n2026-12-31,19200,15200\n');
  if (!existsSync(SAMPLE_PDF_2)) writeFileSync(SAMPLE_PDF_2, Buffer.concat([readFileSync(SAMPLE_PDF), Buffer.from('\n% SYNTHETIC DEMO: second-period electricity invoice evidence copy\n', 'ascii')]));
  const upload = async (file, name, type) => {
    const doc = await req('POST', '/api/v2/documents/upload', { token: T.admin, raw: readFileSync(file), headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent(name) } });
    for (let i = 0; i < 60; i++) {
      const d = await req('GET', '/api/v2/documents/' + doc.id, { token: T.admin });
      if (d.scan_result === 'CLEAN') return d;
      if (d.scan_result && d.scan_result !== 'PENDING') throw new Error('document scan not clean: ' + d.scan_result);
      await sleep(2000);
    }
    throw new Error('document scan timed out: ' + name);
  };
  T.docElec = await memoAsync('docElec', async () => (await upload(SAMPLE_PDF, 'sample-electricity.pdf', 'application/pdf')).id);
  T.docElec2 = await memoAsync('docElec2', async () => (await upload(SAMPLE_PDF_2, 'demo-evidence-electricity-second-period.pdf', 'application/pdf')).id);
  T.docDiesel = await memoAsync('docDiesel', async () => (await upload(DIESEL_CSV, 'demo-evidence-diesel-deliveries.csv', 'text/csv')).id);
  T.docWaste = await memoAsync('docWaste', async () => (await upload(WASTE_TXT, 'demo-evidence-waste-manifest.txt', 'text/plain')).id);
  const uploadAs = async (token, file, name, type) => {
    const doc = await req('POST', '/api/v2/documents/upload', { token, raw: readFileSync(file), headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent(name) } });
    for (let i = 0; i < 60; i++) {
      const d = await req('GET', '/api/v2/documents/' + doc.id, { token });
      if (d.scan_result === 'CLEAN') return d;
      if (d.scan_result && d.scan_result !== 'PENDING') throw new Error('document scan not clean: ' + d.scan_result);
      await sleep(2000);
    }
    throw new Error('document scan timed out: ' + name);
  };
  T.docKpiEnergy = await memoAsync('docKpiEnergy', async () => (await uploadAs(T.entryEnergyToken, KPI_CSV, 'demo-evidence-campus-meter-readings.csv', 'text/csv')).id);
  T.docKpiAnalyst = await memoAsync('docKpiAnalyst', async () => (await uploadAs(T.entryAnalystToken, KPI_CSV_2, 'demo-evidence-water-waste-meter-log.csv', 'text/csv')).id);
  log('evidence documents ready');
});

phase('3-catalog', async () => {
  const cat = await req('POST', '/api/v2/university/catalog/install', { token: T.admin, body: {} });
  log('university KPI definitions installed:', cat.added);
  const extra = await req('POST', '/api/v2/university/carbon/kpis/install', { token: T.admin, body: {} });
  log('carbon supplementary KPI definitions installed:', extra.added);
  const kpiList = await list(T.admin, '/api/v2/university/kpis');
  T.kpi = Object.fromEntries(kpiList.map(k => [k.code, k]));
  state.kpiCodes = Object.keys(T.kpi); save();
  log('KPI definitions available:', kpiList.length);
});

phase('4-factors', async () => {
  for (const [category, unit, value, note] of FACTORS) {
    T['factor_' + category] = await memoAsync('factor_' + category, async () => {
      const existing = await list(T.admin, '/api/v2/university/factors');
      const found = existing.find(f => f.category === category && f.unit === unit && f.version_label === 'DEMO-2024.1');
      if (found) { if (found.status === 'DRAFT') { const ap = await req('POST', '/api/v2/university/factors/' + found.id + '/approve', { token: T.reviewer, body: { version: found.version } }); return ap.id; } return found.id; }
      const f = await req('POST', '/api/v2/university/factors', { token: T.admin, body: { category, unit, value, method: 'ACTIVITY_BASED', source: 'SYNTHETIC DEMO FACTOR - ' + note, sourceUrl: 'https://example.org/carbonsynq-demo/factors/' + category.toLowerCase(), region: 'IN-DEMONSTRATION', boundary: 'SYNTHETIC DEMO illustrative factor boundary for the demonstration tenant only.', versionLabel: 'DEMO-2024.1', validFrom: '2024-04-01', validTo: '2027-03-31' } });
      const a = await req('POST', '/api/v2/university/factors/' + f.id + '/approve', { token: T.reviewer, body: { version: f.version } });
      return a.id;
    });
  }
  T.coreFactorElec = await memoAsync('coreFactorElec', async () => {
    let f = (await list(T.admin, '/api/v2/factors')).find(x => x.category === 'PURCHASED_ELECTRICITY' && x.version_label === 'DEMO-2026.1');
    if (!f) {
      f = await req('POST', '/api/v2/factors', { token: T.admin, body: { category: 'PURCHASED_ELECTRICITY', unit: 'kWh', value: '0.71', versionLabel: 'DEMO-2026.1', source: 'SYNTHETIC DEMO FACTOR - illustrative grid value', sourceUrl: 'https://example.org/carbonsynq-demo/factors/grid-electricity', region: 'IN-DEMONSTRATION', methodology: 'SYNTHETIC DEMO illustrative value only, not an official published factor.', validFrom: '2024-04-01', validTo: '2027-03-31' } });
      f = await req('POST', '/api/v2/factors/' + f.id + '/approve', { token: T.reviewer, body: { version: f.version } });
    }
    return f.id;
  });
  T.coreFactorDiesel = await memoAsync('coreFactorDiesel', async () => {
    let f = (await list(T.admin, '/api/v2/factors')).find(x => x.category === 'DIESEL' && x.version_label === 'DEMO-2026.1');
    if (!f) {
      f = await req('POST', '/api/v2/factors', { token: T.admin, body: { category: 'DIESEL', unit: 'litre', value: '2.68', versionLabel: 'DEMO-2026.1', source: 'SYNTHETIC DEMO FACTOR - illustrative diesel value', sourceUrl: 'https://example.org/carbonsynq-demo/factors/diesel', region: 'IN-DEMONSTRATION', methodology: 'SYNTHETIC DEMO illustrative value only, not an official published factor.', validFrom: '2024-04-01', validTo: '2027-03-31' } });
      f = await req('POST', '/api/v2/factors/' + f.id + '/approve', { token: T.reviewer, body: { version: f.version } });
    }
    return f.id;
  });
  log('university and core factors approved');
});

const CORE_ACTIVITIES = {
  'FY2024-25': [
    { campus: 'MAIN', category: 'PURCHASED_ELECTRICITY', unit: 'kWh', quantity: '4100000', date: '2025-03-31', desc: 'SYNTHETIC DEMO: Main Campus HT electricity total for the financial year.' },
    { campus: 'MAIN', category: 'DIESEL', unit: 'litre', quantity: '7400', date: '2025-03-31', desc: 'SYNTHETIC DEMO: standby generator and fleet diesel for the financial year.' },
  ],
  'FY2025-26': [
    { campus: 'MAIN', category: 'PURCHASED_ELECTRICITY', unit: 'kWh', quantity: '3980000', date: '2026-03-31', desc: 'SYNTHETIC DEMO: Main Campus HT electricity total for the financial year.' },
    { campus: 'NORTH', category: 'PURCHASED_ELECTRICITY', unit: 'kWh', quantity: '1900000', date: '2026-03-31', desc: 'SYNTHETIC DEMO: North Campus HT electricity total for the financial year.' },
    { campus: 'MAIN', category: 'DIESEL', unit: 'litre', quantity: '6900', date: '2026-03-31', desc: 'SYNTHETIC DEMO: standby generator and fleet diesel for the financial year.' },
  ],
};

async function coreActivityFlow(key, spec) {
  const existing = await list(T.admin, '/api/v2/activities');
  let a = existing.find(x => x.description === spec.desc);
  if (!a) {
    a = await req('POST', '/api/v2/activities', { token: T.admin, body: { periodId: T[key], campusId: T.campusOf[spec.campus], buildingId: spec.campus === 'MAIN' ? T.mainBuilding : T.northLibrary, category: spec.category, unit: spec.unit, quantity: spec.quantity, activityDate: spec.date, description: spec.desc } });
  }
  const walk = async () => {
    let cur = await req('GET', '/api/v2/activities/' + a.id, { token: T.admin });
    if (cur.status === 'DRAFT') cur = await req('POST', '/api/v2/activities/' + a.id + '/submit', { token: T.admin, body: { version: cur.version } });
    if (cur.status === 'SUBMITTED') cur = await req('POST', '/api/v2/activities/' + a.id + '/start-review', { token: T.admin, body: { version: cur.version } });
    if (cur.status === 'UNDER_REVIEW') cur = await req('POST', '/api/v2/activities/' + a.id + '/verify', { token: T.reviewer, body: { version: cur.version, factorId: spec.category === 'DIESEL' ? T.coreFactorDiesel : T.coreFactorElec } });
    return cur;
  };
  let cur = await walk();
  for (let i = 0; i < 40 && !['CALCULATED', 'REJECTED'].includes(cur.status); i++) { await sleep(1500); cur = await walk(); }
  return cur;
}

async function invoiceFlow(key, docId) {
  const spec = key === 'FY2024-25'
    ? { quantity: '1950000', date: '2025-03-31', invoice: 'DEMO-INV-2025-0312', amount: '3860000.00' }
    : { quantity: '1930000', date: '2026-03-31', invoice: 'DEMO-INV-2026-0288', amount: '3910000.00' };
  const description = 'SYNTHETIC DEMO: North Campus electricity confirmed from the uploaded invoice after human review for ' + key + '.';
  const existing = (await list(T.admin, '/api/v2/activities?periodId=' + T[key])).find(a => a.description === description);
  let cur = existing;
  if (!cur) {
    const doc = await req('GET', '/api/v2/documents/' + docId, { token: T.admin });
    cur = await req('POST', '/api/v2/documents/' + docId + '/confirm', { token: T.admin, body: {
      periodId: T[key], campusId: T.north, buildingId: T.northBlock, category: 'PURCHASED_ELECTRICITY', unit: 'kWh',
      quantity: spec.quantity, activityDate: spec.date, description, vendor: 'Demo Grid Energy Supplier', invoiceNumber: spec.invoice,
      amountInr: spec.amount, version: doc.version, reviewConfirmed: true } });
  }
  for (let i = 0; i < 40 && !['CALCULATED', 'REJECTED'].includes(cur.status); i++) {
    const fresh = await req('GET', '/api/v2/activities/' + cur.id, { token: T.admin });
    if (fresh.status === 'DRAFT') cur = await req('POST', '/api/v2/activities/' + cur.id + '/submit', { token: T.admin, body: { version: fresh.version } });
    else if (fresh.status === 'SUBMITTED') cur = await req('POST', '/api/v2/activities/' + cur.id + '/start-review', { token: T.admin, body: { version: fresh.version } });
    else if (fresh.status === 'UNDER_REVIEW') cur = await req('POST', '/api/v2/activities/' + cur.id + '/verify', { token: T.reviewer, body: { version: fresh.version, factorId: T.coreFactorElec } });
    else { cur = fresh; await sleep(1500); }
  }
  return cur;
}

phase('5-core-console', async () => {
  for (const key of ['FY2024-25', 'FY2025-26']) {
    for (const spec of CORE_ACTIVITIES[key]) {
      const done = await coreActivityFlow(key, spec);
      log(key, spec.category, spec.campus, '->', done.status);
    }
    const docId = key === 'FY2024-25' ? T.docElec : T.docElec2;
    const done = await invoiceFlow(key, docId);
    log(key, 'invoice-confirmed electricity ->', done.status);
  }
});

async function seedEmission(key, row, extra) {
  const [campus, category, unit, quantity, date, quality, description] = row;
  const periodId = T[key];
  const externalKey = 'DEMO-' + key + '-' + category + '-' + campus;
  const existing = (await list(T.admin, '/api/v2/university/emissions?periodId=' + periodId)).find(e => e.external_key === externalKey);
  let e = existing;
  if (!e) {
    const body = {
      periodId, campusId: T.campusOf[campus], category, unit, quantity,
      activityDate: date, externalKey, description, factorId: T['factor_' + category],
      dataQuality: quality, evidenceIds: extra?.evidenceIds || [T.docDiesel],
      ...(extra || {}),
    };
    if (quality === 'ESTIMATED') body.assumptions = 'SYNTHETIC DEMO: extrapolated from a reviewed sample and disclosed as an estimate.';
    e = await req('POST', '/api/v2/university/emissions', { token: T.admin, body });
  }
  if (e.status === 'DRAFT') e = await req('POST', '/api/v2/university/emissions/' + e.id + '/submit', { token: T.admin, body: { version: e.version } });
  if (e.status === 'SUBMITTED') e = await req('POST', '/api/v2/university/emissions/' + e.id + '/approve', { token: T.reviewer, body: { version: e.version, reason: 'SYNTHETIC DEMO: evidence reviewed and factor version matches the activity.' } });
  return e;
}

async function seedScreenings(key) {
  for (const [n, decision, rationale] of screeningPlan(key)) {
    const existing = await list(T.admin, '/api/v2/university/scope3-screenings?periodId=' + T[key]);
    const found = existing.find(s => s.category_number === n);
    if (found && found.decision === decision) continue;
    const body = { periodId: T[key], categoryNumber: n, decision, rationale };
    if (found) body.version = found.version;
    await req('POST', '/api/v2/university/scope3-screenings', { token: T.admin, body });
  }
}

phase('6-historical', async () => {
  for (const key of ['FY2024-25', 'FY2025-26', 'FY2026-27']) {
    await seedScreenings(key);
    log(key, 'scope 3 screenings recorded');
  }
  for (const key of ['FY2024-25', 'FY2025-26']) {
    for (const row of HIST_EMISSIONS[key]) {
      const e = await seedEmission(key, row);
      if (e.status !== 'CALCULATED') throw new Error('emission not calculated: ' + JSON.stringify(row));
    }
    log(key, 'university emissions calculated:', HIST_EMISSIONS[key].length);
  }
});

async function seedTasks(key, plan) {
  const tasks = await list(T.admin, '/api/v2/university/tasks?periodId=' + T[key]);
  const existing = new Set(tasks.map(t => t.kpi_id + ':' + t.campus_id + ':' + t.bucket));
  const created = [];
  for (const item of plan) {
    const { campus, kpiCode, unit, value, submit } = item;
    const kpi = T.kpi[kpiCode];
    if (!kpi) throw new Error('unknown KPI ' + kpiCode);
    const isNorm = kpi.domain === 'NORMALIZATION';
    const bucket = isNorm ? 'CAMPUS_TOTAL' : campus + '_FACILITIES';
    const dedupe = kpi.id + ':' + T.campusOf[campus] + ':' + bucket;
    let task = tasks.find(t => t.kpi_id === kpi.id && t.campus_id === T.campusOf[campus] && t.bucket === bucket);
    if (!task) {
      if (existing.has(dedupe)) continue;
      existing.add(dedupe);
      task = await req('POST', '/api/v2/university/tasks', { token: T.admin, body: { periodId: T[key], campusId: T.campusOf[campus], kpiId: kpi.id, assigneeId: campus === 'SOUTH' ? T.entryAnalyst : T.entryEnergy, reviewerId: T.reviewersId, bucket, intervalStart: PERIODS[key].startDate, intervalEnd: PERIODS[key].endDate, dueDate: PERIODS[key].endDate } });
    }
    if (!submit) { created.push(task); continue; }
    const assigneeToken = campus === 'SOUTH' ? T.entryAnalystToken : T.entryEnergyToken;
    let fresh = await req('GET', '/api/v2/university/tasks/' + task.id, { token: T.admin });
    if (fresh.status === 'OPEN') {
      let sub = await req('POST', '/api/v2/university/tasks/' + task.id + '/submissions', { token: assigneeToken, body: { taskVersion: fresh.version, value, unit, notes: 'SYNTHETIC DEMO value recorded for the demonstration tenant.', evidenceIds: [campus === 'SOUTH' ? T.docKpiAnalyst : T.docKpiEnergy] } });
      sub = await req('POST', '/api/v2/university/submissions/' + sub.id + '/submit', { token: assigneeToken, body: { version: sub.version } });
      await req('POST', '/api/v2/university/submissions/' + sub.id + '/approve', { token: T.reviewer, body: { version: sub.version, reason: 'SYNTHETIC DEMO: value checked against the attached supporting document.' } });
    }
    created.push(task);
  }
  return created;
}

phase('7-collections', async () => {
  const users = await list(T.admin, '/api/v2/users');
  T.reviewersId = (users.find(u => u.role === 'REVIEWER' && u.email !== 'admin@university.example') || users.find(u => u.role === 'REVIEWER')).id;
  for (const key of ['FY2024-25', 'FY2025-26']) {
    const plan = [];
    for (const [campus] of [['MAIN'], ['NORTH'], ['SOUTH']]) {
      for (const [code, unit] of KPI_TASKS.normalization) plan.push({ campus, kpiCode: code, unit, value: campus === 'MAIN' ? (code === 'STUDENT_FTE' ? '9600' : code === 'STAFF_FTE' ? '1240' : '186000') : campus === 'NORTH' ? (code === 'STUDENT_FTE' ? '4200' : code === 'STAFF_FTE' ? '560' : '74000') : (code === 'STUDENT_FTE' ? '5100' : code === 'STAFF_FTE' ? '470' : '92000'), submit: true });
      for (const [code, unit] of KPI_TASKS.operational) plan.push({ campus, kpiCode: code, unit, value: campus === 'MAIN' ? (code === 'WATER_WITHDRAWAL_M3' ? (key === 'FY2024-25' ? '146000' : '149000') : '245000') : campus === 'NORTH' ? (code === 'WATER_WITHDRAWAL_M3' ? '58000' : '96000') : (code === 'WATER_WITHDRAWAL_M3' ? '44000' : '78000'), submit: true });
    }
    await seedTasks(key, plan);
    log(key, 'collection tasks completed');
  }
});

phase('8-reports', async () => {
  const reports = await list(T.admin, '/api/v2/university/reports');
  for (const key of ['FY2024-25', 'FY2025-26']) {
    const periods = await list(T.admin, '/api/v2/periods');
    let period = periods.find(p => p.id === T[key]);
    if (period.status !== 'LOCKED') {
      period = await req('POST', '/api/v2/periods/' + period.id + '/lock', { token: T.admin, body: { version: period.version, reason: 'SYNTHETIC DEMO: period closed after evidence and KPI review.' } });
    }
    let r = reports.find(x => x.period_id === T[key] && x.title.startsWith('SYNTHETIC DEMO'));
    if (!r) r = await req('POST', '/api/v2/university/reports', { token: T.admin, body: { periodId: T[key], title: 'SYNTHETIC DEMO ' + key + ' university sustainability inventory', purpose: 'UNIVERSITY_SUSTAINABILITY', boundaryStatement: BOUNDARY_STATEMENT } });
    if (r.status === 'SUBMITTED') r = await req('POST', '/api/v2/university/reports/' + r.id + '/approve', { token: T.reviewer, body: { version: r.version, reason: 'SYNTHETIC DEMO: snapshot reviewed and approved for the demonstration tenant.' } });
    state['report_' + key] = r.id; save();
    log(key, 'report', r.id, r.status);
  }
  const targets = await list(T.admin, '/api/v2/university/targets');
  let target = targets.find(t => t.name.startsWith('SYNTHETIC DEMO'));
  if (!target) target = await req('POST', '/api/v2/university/targets', { token: T.admin, body: { name: 'SYNTHETIC DEMO: 25% absolute emissions reduction by 2030', baselineReportId: state.report_FY2024_25 || state['report_FY2024-25'], scopes: ['SCOPE_1', 'SCOPE_2', 'SCOPE_3'], reductionPercent: '25', targetDate: '2030-03-31', ownerId: T.entryEnergy, scope2Basis: 'LOCATION' } });
  state.target = target.id; save();
  const initiatives = await list(T.admin, '/api/v2/university/initiatives');
  const specs = [
    ['MAIN', 'SYNTHETIC DEMO: 2 MW rooftop solar PPA at Main Campus', T.entryEnergy, '2026-04-01', '2027-03-31', '620000', '85000000.00', '4200000.00'],
    ['NORTH', 'SYNTHETIC DEMO: LED retrofit and HVAC controls at North Campus', T.entryEnergy, '2026-04-01', '2027-12-31', '310000', '24000000.00', '1900000.00'],
    ['SOUTH', 'SYNTHETIC DEMO: electrify the South Campus bus fleet', T.entryAnalyst, '2026-07-01', '2028-06-30', '240000', '41000000.00', '2600000.00'],
  ];
  for (const [campus, name, ownerId, start, end, kg, capex, savings] of specs) {
    let init = initiatives.find(i => i.name === name);
    if (!init) init = await req('POST', '/api/v2/university/initiatives', { token: T.admin, body: { targetId: target.id, campusId: T.campusOf[campus], name, ownerId, startDate: start, endDate: end, estimatedReductionKg: kg, investmentInr: capex, annualSavingsInr: savings, assumptions: 'SYNTHETIC DEMO: projected saving is tracked as an initiative only and is never deducted from the inventory.' } });
  }
  const all = await list(T.admin, '/api/v2/university/initiatives');
  const first = all.find(i => i.name.startsWith('SYNTHETIC DEMO: 2 MW'));
  if (first && first.status === 'PLANNED') await req('PATCH', '/api/v2/university/initiatives/' + first.id, { token: T.admin, body: { version: first.version, status: 'IN_PROGRESS', progress: 45, reason: 'SYNTHETIC DEMO: modules installed and commissioning underway.' } });
  log('target and initiatives ready');
});

phase('9-carbon-ledger', async () => {
  const key = 'FY2026-27';
  const periodId = T[key];
  const sources = await list(T.admin, '/api/v2/university/carbon/sources');
  const sourceIds = {};
  const deptFor = { MAIN: T.deptFacilities, NORTH: null, SOUTH: T.deptHostel };
  for (const [campus, code, name, kind, substance, unit, facilityType, description] of CARBON_SOURCES) {
    let s = sources.find(x => x.code === code);
    if (!s) s = await req('POST', '/api/v2/university/carbon/sources', { token: T.admin, body: { campusId: T.campusOf[campus], buildingId: campus === 'MAIN' ? T.mainBuilding : campus === 'NORTH' ? T.northBlock : T.southHostel, departmentId: deptFor[campus] || null, ownerId: campus === 'SOUTH' ? T.entryAnalyst : T.entryEnergy, code, name, kind, substance, unit, region: 'IN-DEMONSTRATION', facilityType, activeFrom: '2026-04-01', activeTo: '2027-03-31', description } });
    sourceIds[code] = s.id;
  }
  state.sourceIds = sourceIds; save();
  log('carbon sources registered:', Object.keys(sourceIds).length);

  const cFactors = await list(T.admin, '/api/v2/university/carbon/factors');
  for (const [key2, name, kind, substance, unit, use, components, gwpBasis] of CARBON_FACTORS) {
    let f = cFactors.find(x => x.version_label === key2);
    if (!f) {
      f = await req('POST', '/api/v2/university/carbon/factors', { token: T.admin, body: { name, kind, substance, unit, use, components, gwpBasis, source: 'SYNTHETIC DEMO FACTOR - illustrative value for the demonstration tenant, not an official published factor.', sourceUrl: 'https://example.org/carbonsynq-demo/carbon-factors/' + key2.toLowerCase(), region: 'IN-DEMONSTRATION', boundary: 'SYNTHETIC DEMO illustrative factor boundary for the demonstration tenant only.', versionLabel: key2, validFrom: '2026-04-01', validTo: '2027-03-31' } });
      f = await req('POST', '/api/v2/university/carbon/factors/' + f.id + '/approve', { token: T.reviewer, body: { version: f.version, reason: 'SYNTHETIC DEMO: factor reviewed for completeness and internal consistency.' } });
    } else if (f.status === 'DRAFT') {
      f = await req('POST', '/api/v2/university/carbon/factors/' + f.id + '/approve', { token: T.reviewer, body: { version: f.version, reason: 'SYNTHETIC DEMO: factor reviewed for completeness and internal consistency.' } });
    }
    T['cf_' + key2] = f.id; state['cf_' + key2] = f.id;
  }
  save();
  log('carbon factors approved');

  const instruments = await list(T.admin, '/api/v2/university/carbon/instruments');
  let ppa = instruments.find(i => i.serial === 'DEMO-PPA-2026-001');
  if (!ppa) {
    ppa = await req('POST', '/api/v2/university/carbon/instruments', { token: T.admin, body: {
      periodId, name: 'SYNTHETIC DEMO: Main Campus rooftop solar PPA', kind: 'PPA', registry: 'DEMO REGISTRY', serial: 'DEMO-PPA-2026-001', beneficiary: T.tenantName, region: 'IN-DEMONSTRATION', quantityKwh: '300000', validFrom: '2026-04-01', validTo: '2026-09-30', vintageFrom: '2026-04-01', vintageTo: '2026-06-30', retiredOn: '2026-09-30', factorId: T['cf_C-ELEC-MARKET'], evidenceIds: [T.docElec],
      qualityChecks: {
        EMISSIONS_ATTRIBUTE: { assessment: 'PASS', explanation: 'SYNTHETIC DEMO: certificate states bundled renewable attributes for the named generation.' },
        UNIQUE_CLAIM: { assessment: 'PASS', explanation: 'SYNTHETIC DEMO: no other tenant claim is registered for this serial.' },
        RETIRED_FOR_TENANT: { assessment: 'PASS', explanation: 'SYNTHETIC DEMO: retired on 2026-09-30 for the demonstration beneficiary.' },
        VINTAGE_MATCH: { assessment: 'PASS', explanation: 'SYNTHETIC DEMO: vintage window matches the consumption window claimed.' },
        MARKET_BOUNDARY: { assessment: 'PASS', explanation: 'SYNTHETIC DEMO: generation is inside the reporting boundary of the beneficiary.' },
        SUPPLIER_ALLOCATION: { assessment: 'NOT_APPLICABLE', explanation: 'SYNTHETIC DEMO: allocation is not used for this PPA contract.' },
        DIRECT_PURCHASE_ATTRIBUTES: { assessment: 'NOT_APPLICABLE', explanation: 'SYNTHETIC DEMO: direct purchase attribute claim is not made here.' },
        RESIDUAL_MIX_TREATMENT: { assessment: 'NOT_APPLICABLE', explanation: 'SYNTHETIC DEMO: residual mix is tracked separately on the residual factor.' },
      },
    } });
    ppa = await req('POST', '/api/v2/university/carbon/instruments/' + ppa.id + '/approve', { token: T.reviewer, body: { version: ppa.version, reason: 'SYNTHETIC DEMO: instrument quality checks reviewed internally; no registry verification claimed.' } });
  } else if (ppa.status === 'DRAFT') {
    ppa = await req('POST', '/api/v2/university/carbon/instruments/' + ppa.id + '/approve', { token: T.reviewer, body: { version: ppa.version, reason: 'SYNTHETIC DEMO: instrument quality checks reviewed internally; no registry verification claimed.' } });
  }
  T.ppa = ppa.id; state.ppa = ppa.id; save();
  log('market instrument approved');

  const boundaries = await list(T.admin, '/api/v2/university/carbon/boundaries?periodId=' + periodId);
  let boundary = boundaries.find(b => b.status === 'APPROVED' || b.status === 'DRAFT');
  if (boundary && boundary.status === 'DRAFT') {
    boundary = await req('POST', '/api/v2/university/carbon/boundaries/' + boundary.id + '/approve', { token: T.reviewer, body: { version: boundary.version, reason: 'SYNTHETIC DEMO: source register and checklist reviewed and approved.' } });
  }
  if (!boundary) {
    const sourceRows = CARBON_SOURCES.map(([campus, code]) => ({ campusKey: campus, code, kind: code.startsWith('CHILLER') ? 'REFRIGERANT' : code.startsWith('FLEET') ? 'MOBILE_COMBUSTION' : code.startsWith('DG') ? 'STATIONARY_COMBUSTION' : code.startsWith('STEAM') ? 'PURCHASED_STEAM' : 'PURCHASED_ELECTRICITY' }));
    const sourcesPayload = CARBON_SOURCES.map(([, code, name]) => ({ sourceId: sourceIds[code], decision: 'INCLUDED', rationale: 'SYNTHETIC DEMO: registered source assessed as inside the demonstration boundary.', frequency: code.startsWith('GRID') ? 'MONTHLY' : 'ANNUAL', evidenceIds: [] }));
    const screening = [];
    for (const campus of ['MAIN', 'NORTH', 'SOUTH']) for (const [code, decision, rationale] of carbonScreeningFor(campus, sourceRows)) screening.push({ campusId: T.campusOf[campus], code, decision, rationale });
    boundary = await req('POST', '/api/v2/university/carbon/boundaries', { token: T.admin, body: {
      periodId, campusIds: [T.main, T.north, T.south],
      campusExclusions: (T.otherCampuses || []).map(c => ({ campusId: c.id, rationale: 'SYNTHETIC DEMO: registered reference campus outside the demonstrated Scope 1/2 consolidation boundary.' })),
      approach: 'OPERATIONAL_CONTROL',
      statement: 'SYNTHETIC DEMO: operational control over Main, North and South campuses for FY2026-27, with dual location and market reporting for Scope 2 and no offsets, avoided emissions or biogenic netting.',
      baseYear: 2024, recalculationPolicy: 'SYNTHETIC DEMO: significant changes trigger a new boundary revision rather than silent restatement.',
      scope2Mode: 'DUAL', scope2Rationale: 'SYNTHETIC DEMO: dual reporting is required because the campus holds a rooftop PPA and grid supply.',
      sources: sourcesPayload, screening, evidenceIds: [T.docElec],
    } });
    boundary = await req('POST', '/api/v2/university/carbon/boundaries/' + boundary.id + '/approve', { token: T.reviewer, body: { version: boundary.version, reason: 'SYNTHETIC DEMO: source register and checklist reviewed and approved.' } });
  }
  T.boundary = boundary.id; state.boundary = boundary.id; save();
  log('boundary approved, scope 2 mode', boundary.scope2_mode);
});

phase('10-carbon-records', async () => {
  const key = 'FY2026-27';
  const periodId = T[key];
  const records = await list(T.admin, '/api/v2/university/carbon/records?periodId=' + periodId);
  for (const [code, from, to, quantityInput, evidenceKind, allocation] of CARBON_RECORDS) {
    const externalKey = 'DEMO-' + code + '-' + from;
    if (records.find(r => r.external_key === externalKey)) continue;
    const sourceId = state.sourceIds[code];
    const isElectricity = code.startsWith('GRID');
    const evidenceIds = evidenceKind === 'elc' ? [T.docElec] : [T.docDiesel];
    const body = {
      periodId, sourceId, intervalStart: from, intervalEnd: to, externalKey,
      description: 'SYNTHETIC DEMO: ' + code + ' consumption for ' + from + ' to ' + to + '.',
      quantityInput, factorId: isElectricity ? T['cf_C-ELEC-LOCATION'] : code === 'STEAM-SOUTH' ? T['cf_C-STEAM-LOCATION'] : code === 'CHILLER-R32-MAIN' ? T['cf_C-R32-REFRIGERANT'] : code === 'FLEET-DIESEL-MAIN' ? T['cf_C-DIESEL-MOBILE'] : T['cf_C-DIESEL-STATIONARY'],
      marketAllocations: allocation ? [{ instrumentId: T.ppa, quantityKwh: String(allocation) }] : [],
      fallbackFactorId: isElectricity ? T['cf_C-ELEC-RESIDUAL'] : code === 'STEAM-SOUTH' ? T['cf_C-STEAM-RESIDUAL'] : undefined,
      fallbackReason: isElectricity ? (allocation ? 'SYNTHETIC DEMO: grid volume not covered by the registered rooftop PPA uses the residual mix factor.' : 'SYNTHETIC DEMO: PPA eligibility ended 2026-09-30, so the residual mix applies to this interval.') : code === 'STEAM-SOUTH' ? 'SYNTHETIC DEMO: delivered steam is not covered by a reviewed supplier product allocation, so the residual steam mix applies.' : undefined,
      evidenceIds, dataQuality: 'MEASURED',
    };
    let r = await req('POST', '/api/v2/university/carbon/records', { token: T.admin, body });
    r = await req('POST', '/api/v2/university/carbon/records/' + r.id + '/submit', { token: T.admin, body: { version: r.version } });
    r = await req('POST', '/api/v2/university/carbon/records/' + r.id + '/approve', { token: T.reviewer, body: { version: r.version, reason: 'SYNTHETIC DEMO: quantity derivation, factor and source coverage reviewed.' } });
  }
  const done = await list(T.admin, '/api/v2/university/carbon/records?periodId=' + periodId);
  log('carbon records calculated:', done.filter(r => r.status === 'CALCULATED').length, 'of', done.length);
});

phase('11-current-period', async () => {
  const key = 'FY2026-27';
  for (const [campus, category, unit, quantity, quality, description] of CURRENT_EMISSIONS) {
    const e = await seedEmission(key, [campus, category, unit, quantity, '2027-03-31', quality, description], { evidenceIds: [category === 'UPSTREAM_FREIGHT' || category === 'FOOD_PURCHASES' ? T.docWaste : T.docDiesel] });
    if (e.status !== 'CALCULATED') throw new Error('current emission not calculated: ' + category);
  }
  log(key, 'scope 3 and supplemental emissions calculated:', CURRENT_EMISSIONS.length);
  const plan = [];
  for (const [campus] of [['MAIN'], ['NORTH'], ['SOUTH']]) {
    for (const [code, unit] of KPI_TASKS.normalization) plan.push({ campus, kpiCode: code, unit, value: campus === 'MAIN' ? (code === 'STUDENT_FTE' ? '9750' : code === 'STAFF_FTE' ? '1265' : '189000') : campus === 'NORTH' ? (code === 'STUDENT_FTE' ? '4300' : code === 'STAFF_FTE' ? '575' : '75500') : (code === 'STUDENT_FTE' ? '5200' : code === 'STAFF_FTE' ? '480' : '93500'), submit: campus === 'MAIN' });
  }
  plan.push({ campus: 'MAIN', kpiCode: 'WATER_WITHDRAWAL_M3', unit: 'm3', value: '152000', submit: true });
  plan.push({ campus: 'MAIN', kpiCode: 'WASTE_GENERATED_KG', unit: 'kg', value: '249000', submit: true });
  plan.push({ campus: 'NORTH', kpiCode: 'WATER_WITHDRAWAL_M3', unit: 'm3', value: '59500', submit: false });
  plan.push({ campus: 'SOUTH', kpiCode: 'WASTE_GENERATED_KG', unit: 'kg', value: '74000', submit: false });
  await seedTasks(key, plan);
  log(key, 'collection tasks created with deliberate open items');
});

phase('12-actions', async () => {
  const key = 'FY2026-27';
  const periodId = T[key];
  const actions = await list(T.admin, '/api/v2/university/carbon/actions?periodId=' + periodId);
  let medium = actions.find(a => a.title.startsWith('SYNTHETIC DEMO: Replace ageing submeter'));
  if (!medium) medium = await req('POST', '/api/v2/university/carbon/actions', { token: T.admin, body: { periodId, campusId: T.main, sourceId: state.sourceIds['GRID-ELEC-MAIN'], title: 'SYNTHETIC DEMO: Replace ageing submeter on the Main Campus HT intake', severity: 'MEDIUM', ownerId: T.entryEnergy, dueDate: '2026-11-30', description: 'SYNTHETIC DEMO: submeter shows a drift of more than two percent against the utility statement.', evidenceIds: [] } });
  let high = actions.find(a => a.title.startsWith('SYNTHETIC DEMO: Generator fuel reconciliation'));
  if (!high) high = await req('POST', '/api/v2/university/carbon/actions', { token: T.admin, body: { periodId, campusId: T.main, sourceId: state.sourceIds['DG-SET-MAIN'], title: 'SYNTHETIC DEMO: Generator fuel reconciliation gap', severity: 'HIGH', ownerId: T.entryAnalyst, dueDate: '2026-10-20', description: 'SYNTHETIC DEMO: fuel stock movement does not reconcile with the delivery notes for the quarter.', evidenceIds: [T.docDiesel] } });
  if (high.status === 'OPEN') {
    let r = await req('POST', '/api/v2/university/carbon/actions/' + high.id + '/resolve', { token: T.entryAnalystToken, body: { version: high.version, reason: 'SYNTHETIC DEMO: delivery notes and stock cards reconciled with the facilities supervisor.', evidenceIds: [T.docKpiAnalyst] } });
    r = await req('POST', '/api/v2/university/carbon/actions/' + high.id + '/close', { token: T.reviewer, body: { version: r.version, reason: 'SYNTHETIC DEMO: reconciliation evidence accepted and action closed.' } });
  }
  log('corrective actions: one open medium, one closed high');
});

phase('13-collaboration', async () => {
  const key = 'FY2026-27';
  const periodId = T[key];
  const suppliers = await list(T.admin, '/api/v2/university/suppliers');
  const ensureSupplier = async (name, code, category) => {
    let s = suppliers.find(x => x.code === code);
    if (!s) s = await req('POST', '/api/v2/university/suppliers', { token: T.admin, body: { name, code, contactEmail: code.toLowerCase() + '@demo-vendor.example', category } });
    return s;
  };
  const canteen = await ensureSupplier('Demo Campus Canteen Vendor', 'DEMO-CAN', 'Food and catering');
  const lab = await ensureSupplier('Demo Laboratory Equipment Vendor', 'DEMO-LAB', 'Equipment and laboratory supplies');
  const requests = await list(T.admin, '/api/v2/university/supplier-requests');
  let req1 = requests.find(r => r.title.startsWith('SYNTHETIC DEMO: Canteen supplier data request'));
  if (!req1) req1 = await req('POST', '/api/v2/university/supplier-requests', { token: T.admin, body: {
    supplierId: canteen.id, periodId, title: 'SYNTHETIC DEMO: Canteen supplier data request FY2026-27', dueDate: '2026-11-15',
    questions: [
      { key: 'FOOD_PURCHASED_KG', label: 'Total food mass purchased for the university in FY2026-27', type: 'NUMBER', required: true, unit: 'kg' },
      { key: 'SCOPE3_METHOD', label: 'How did you derive the figures you are reporting?', type: 'CHOICE', required: true, options: ['Activity based measurement', 'Supplier specific spend factor', 'Not yet assessed'] },
      { key: 'LOGISTICS_KM', label: 'Average delivery distance to campus', type: 'NUMBER', required: true, unit: 'km' },
      { key: 'NOTES', label: 'Anything the reviewer should know?', type: 'TEXT', required: false },
    ],
  } });
  if (req1.status === 'DRAFT') {
    const invite = await req('POST', '/api/v2/university/supplier-requests/' + req1.id + '/invite', { token: T.admin, body: { version: req1.version, expiresInDays: 14 } });
    const form = await req('GET', '/api/v2/university/portal', { capability: invite.token });
    let submitted = await req('POST', '/api/v2/university/portal/submit', { capability: invite.token, body: { version: form.target ? form.target.version : (form.version ?? 1), answers: { FOOD_PURCHASED_KG: '412500', SCOPE3_METHOD: 'Activity based measurement', LOGISTICS_KM: '186', NOTES: 'SYNTHETIC DEMO reply: weighed at our kitchen delivery gate.' }, attestation: true } });
    log('supplier portal response received:', submitted.received);
    let current = await req('GET', '/api/v2/university/supplier-requests/' + req1.id, { token: T.admin });
    current = await req('PATCH', '/api/v2/university/supplier-requests/' + current.id + '/evidence', { token: T.admin, body: { version: current.version, evidenceIds: [T.docWaste] } });
    const approved = await req('POST', '/api/v2/university/supplier-requests/' + current.id + '/approve', { token: T.reviewer, body: { version: current.version, reason: 'SYNTHETIC DEMO: supplier answers checked against the attached weighbridge note.' } });    log('supplier request approved:', approved.status);
  }
  let req2 = requests.find(r => r.title.startsWith('SYNTHETIC DEMO: Laboratory supplier data request'));
  if (!req2) req2 = await req('POST', '/api/v2/university/supplier-requests', { token: T.admin, body: {
    supplierId: lab.id, periodId, title: 'SYNTHETIC DEMO: Laboratory supplier data request FY2026-27', dueDate: '2026-12-10',
    questions: [
      { key: 'ITEMS_DELIVERED', label: 'Number of equipment items delivered in the year', type: 'NUMBER', required: true, unit: 'item' },
      { key: 'REFRIGERANT_CHARGE', label: 'Refrigerant charge shipped with the equipment', type: 'NUMBER', required: true, unit: 'kg' },
    ],
  } });
  if (req2.status === 'DRAFT') {
    const invite2 = await req('POST', '/api/v2/university/supplier-requests/' + req2.id + '/invite', { token: T.admin, body: { version: req2.version, expiresInDays: 14 } });
    state.portalToken2 = invite2.token;
    log('second supplier request invited and intentionally left open');
  }

  const assessments = await list(T.admin, '/api/v2/university/materiality');
  let assessment = assessments.find(a => a.title.startsWith('SYNTHETIC DEMO: FY2026-27 materiality'));
  if (!assessment) assessment = await req('POST', '/api/v2/university/materiality', { token: T.admin, body: { periodId, title: 'SYNTHETIC DEMO: FY2026-27 materiality consultation', topics: MATERIALITY_TOPICS.map(([code, label]) => ({ code, label })), impactThreshold: '3.5', financialThreshold: '3', minResponses: 5 } });
  if (assessment.status === 'OPEN') {
    const summaries = [];
    for (let g = 0; g < STAKEHOLDER_GROUPS.length; g++) {
      const group = STAKEHOLDER_GROUPS[g];
      const invite = await req('POST', '/api/v2/university/materiality/' + assessment.id + '/invite', { token: T.admin, body: { version: (await req('GET', '/api/v2/university/materiality/' + assessment.id, { token: T.admin })).version, expiresInDays: 14, stakeholderGroup: group } });
      const form = await req('GET', '/api/v2/university/portal', { capability: invite.token });
      const target = form.target || {};
      const scores = (target.topics || MATERIALITY_TOPICS.map(([code]) => ({ code }))).map((t, i) => ({
        topic: t.code,
        impact: [4, 3, 3, 2, 4, 3][(i + g) % 6],
        financial: [2, 3, 2, 2, 4, 3][(i + g) % 6],
        rationale: 'SYNTHETIC DEMO: illustrative stakeholder rating.',
      }));
      await req('POST', '/api/v2/university/portal/submit', { capability: invite.token, body: { version: target.version ?? assessment.version, consent: true, scores } });
      summaries.push(group);
    }
    log('materiality responses collected:', summaries.length);
    let cur = await req('GET', '/api/v2/university/materiality/' + assessment.id, { token: T.admin });
    if (cur.status === 'OPEN') cur = await req('POST', '/api/v2/university/materiality/' + cur.id + '/close', { token: T.admin, body: { version: cur.version, reason: 'SYNTHETIC DEMO: response window closed after the minimum number of responses.' } });
    if (cur.status === 'CLOSED') await req('POST', '/api/v2/university/materiality/' + cur.id + '/approve', { token: T.reviewer, body: { version: cur.version, reason: 'SYNTHETIC DEMO: aggregate materiality snapshot reviewed for publication.' } });
    log('materiality assessment approved');
  }
});

phase('14-planning', async () => {
  const factors = await list(T.admin, '/api/v2/university/factors');
  const pcfEnergy = (factors.find(f => f.category === 'PCF_ENERGY' && f.status === 'APPROVED') || {}).id;
  const pcfMaterial = (factors.find(f => f.category === 'PCF_MATERIAL' && f.status === 'APPROVED') || {}).id;
  if (!pcfEnergy || !pcfMaterial) throw new Error('PCF factors missing');
  const studies = await list(T.admin, '/api/v2/university/pcf-studies');
  let study = studies.find(s => s.name.startsWith('SYNTHETIC DEMO: Net-zero'));
  const body = {
    name: 'SYNTHETIC DEMO: Net-zero retrofit PCF screening', functionalUnit: 'kWh of delivered occupancy energy per year', outputQuantity: '1250000',
    boundary: 'SYNTHETIC DEMO: screening study from delivered materials through use and end of life; user defined boundary, not an ISO 14067 verified LCA.',
    studyDate: '2026-08-31',
    bom: [
      { name: 'Structure and envelope materials', stage: 'MATERIALS', quantity: '18000', unit: 'kg', factorId: pcfMaterial, allocationPercent: '100' },
      { name: 'Construction logistics', stage: 'TRANSPORT', quantity: '6500', unit: 'kg', factorId: pcfMaterial, allocationPercent: '100' },
      { name: 'Grid electricity during operation', stage: 'USE', quantity: '125000', unit: 'kWh', factorId: pcfEnergy, allocationPercent: '100' },
      { name: 'End of life processing', stage: 'END_OF_LIFE', quantity: '18000', unit: 'kg', factorId: pcfMaterial, allocationPercent: '100' },
    ],
  };
  if (!study) {
    const preview = await req('POST', '/api/v2/university/pcf-studies/preview', { token: T.admin, body });
    log('pcf preview total kg CO2e:', preview.totalKgCo2e);
    study = await req('POST', '/api/v2/university/pcf-studies', { token: T.admin, body });
    let cur = await req('POST', '/api/v2/university/pcf-studies/' + study.id + '/submit', { token: T.admin, body: { version: study.version } });
    cur = await req('POST', '/api/v2/university/pcf-studies/' + cur.id + '/approve', { token: T.reviewer, body: { version: cur.version, reason: 'SYNTHETIC DEMO: screening factors and allocation reviewed.' } });
    log('pcf study approved:', cur.status);
  }
  const csv = 'periodId,campusId,category,unit,quantity,activityDate,externalKey,description,factorId,dataQuality,evidenceIds\n'
    + [T['FY2026-27'], T.south, 'UPSTREAM_FREIGHT', 'tonne_km', '1200', '2027-03-31', 'DEMO-CSV-PREVIEW-FREIGHT', 'SYNTHETIC DEMO csv preview row never committed.', T['factor_UPSTREAM_FREIGHT'], 'MEASURED', T.docDiesel].join(',');
  const previewImport = await req('POST', '/api/v2/university/imports/emissions/preview', { token: T.admin, body: { csv } });
  log('csv import preview valid:', previewImport.valid, '| rows:', previewImport.totalRows, '| imported:', previewImport.imported);
});

phase('15-reporting', async () => {
  const periods = await list(T.admin, '/api/v2/periods');
  for (const key of ['FY2024-25', 'FY2025-26', 'FY2026-27']) {
    const ov = await req('GET', '/api/v2/university/overview?periodId=' + T[key], { token: T.admin });
    log(key, 'tCO2e', ov.inventory.totalTonnesCo2e, '| scopes', JSON.stringify(ov.inventory.scopes), '| tasks', JSON.stringify(ov.collection));
  }
  const dash = await req('GET', '/api/v2/university/carbon/dashboard?periodId=' + T['FY2026-27'], { token: T.admin });
  log('carbon scope 1 kg', dash.summary.scope1.kgCo2e, '| scope 2 location kg', dash.summary.scope2.locationKgCo2e, '| scope 2 market kg', dash.summary.scope2.marketKgCo2e, '| ready', dash.readiness.ready);
  const progress = await req('GET', '/api/v2/university/targets/' + state.target + '/progress?currentReportId=' + state['report_FY2025-26'], { token: T.admin });
  log('target comparable:', progress.comparable, '| observed reduction %:', progress.observedReductionPercent, '| threshold met:', progress.recordedThresholdMet);
  for (const q of ['EMISSIONS_SUMMARY', 'MISSING_SUBMISSIONS', 'TOP_HOTSPOTS', 'EVIDENCE_GAPS', 'SCOPE3_COVERAGE']) {
    const i = await req('POST', '/api/v2/university/insights/query', { token: T.admin, body: { periodId: T['FY2026-27'], questionId: q } });
    log('insight', q, 'citations', (i.citations || []).length);
  }
  const search = await req('GET', '/api/v2/university/knowledge/search?q=electricity&periodId=' + T['FY2026-27'], { token: T.admin });
  log('knowledge search hits:', (search.items || []).length, '| truncated:', search.truncated);
  const commute = await req('POST', '/api/v2/university/commuting/estimate', { token: T.admin, body: { oneWayKm: '18.5', days: 240, participants: 420, mode: 'CAR', basis: 'passenger_km', sampleSize: 420, population: 3200, extrapolate: true } });
  log('commuting estimate pkm:', commute.quantity, commute.unit);
  const csv = await download(T.admin, '/api/v2/university/reports/' + state['report_FY2025-26'] + '/export?format=csv');
  log('approved report csv export bytes:', csv.bytes.length, '| type:', csv.contentType);
  const report = await req('GET', '/api/v2/university/reports/' + state['report_FY2025-26'], { token: T.admin });
  log('report integrity verified:', report.integrityVerified, '| period locked:', report.currentPeriodLocked);
  save();
  log('\nDONE. tenant ' + TENANT_ID + ' fully seeded.');
});

const requested = only.has('all') ? phases.map(([n]) => n) : phases.map(([n]) => n).filter(n => only.has(n));
if (requested.length && !requested.includes('1-identity')) requested.unshift('1-identity');
for (const [name, fn] of phases) if (requested.includes(name)) { log('\n=== PHASE ' + name + ' ==='); await fn(); }
