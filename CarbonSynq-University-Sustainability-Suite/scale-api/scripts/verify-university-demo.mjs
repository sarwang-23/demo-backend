// Read-only verification of a synthetic demo tenant seeded by scripts/seed-university-demo.mjs.
// It prints one line per check and exits non-zero when a seeded expectation is missing.
// Usage: node --env-file-if-exists=.env scripts/verify-university-demo.mjs
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const BASE = process.env.DEMO_BASE || 'http://localhost:5000';
const EVIDENCE_DIR = process.env.DEMO_EVIDENCE_DIR || tmpdir() + '/carbonsynq-demo-evidence';
const STATE_FILE = EVIDENCE_DIR + '/seed-state.json';
if (!existsSync(STATE_FILE)) throw Error('Seed state not found at ' + STATE_FILE + '. Run scripts/seed-university-demo.mjs first.');
const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
if (!state.tokenAdmin) throw Error('No cached admin session in the seed state. Delete the state file and re-run the seed script.');

const headers = { Authorization: 'Bearer ' + state.tokenAdmin };
async function get(path) {
    const res = await fetch(BASE + path, { headers });
    const text = await res.text();
    if (!res.ok) { let parsed = null; try { parsed = JSON.parse(text); } catch { } throw Error(path + ' -> ' + res.status + ' ' + (parsed?.error?.message || text.slice(0, 200))); }
    const json = JSON.parse(text);
    return json.data ?? json;
}
async function list(path) {
    const out = [];
    let cursor = null;
    const separator = path.includes('?') ? '&' : '?';
    do {
        const page = await get(path + separator + 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        out.push(...(page.items || []));
        cursor = page.nextCursor;
    } while (cursor);
    return out;
}
const count = (rows, value, key = 'status') => rows.filter(r => r[key] === value).length;

const periods = await list('/api/v2/periods');
const documents = await list('/api/v2/documents');
const reports = await list('/api/v2/university/reports');
const sources = await list('/api/v2/university/carbon/sources');
const carbonFactors = await list('/api/v2/university/carbon/factors');
const instruments = await list('/api/v2/university/carbon/instruments');
const boundaries = await list('/api/v2/university/carbon/boundaries');
const carbonRecords = await list('/api/v2/university/carbon/records');
const factors = await list('/api/v2/university/factors');
const emissions = await list('/api/v2/university/emissions');
const screenings = await list('/api/v2/university/scope3-screenings');
const actions = await list('/api/v2/university/carbon/actions');
const tasks = await list('/api/v2/university/tasks');
const supplierRequests = await list('/api/v2/university/supplier-requests');
const materiality = await list('/api/v2/university/materiality');
const studies = await list('/api/v2/university/pcf-studies');
const dashboard = await get('/api/v2/university/carbon/dashboard?periodId=' + state['period_FY2026-27']);
const progress = await get('/api/v2/university/targets/' + state.target + '/progress?currentReportId=' + state['report_FY2025-26']);

const failures = [];
const expect = (label, actual, expected) => {
    const ok = String(actual) === String(expected);
    console.log((ok ? 'PASS ' : 'FAIL ') + label + ': ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
    if (!ok) failures.push(label);
};
const atLeast = (label, actual, minimum) => {
    const ok = Number(actual) >= minimum;
    console.log((ok ? 'PASS ' : 'FAIL ') + label + ': ' + actual + (ok ? '' : ' (expected at least ' + minimum + ')'));
    if (!ok) failures.push(label);
};

expect('locked periods', periods.filter(p => p.status === 'LOCKED').length, 2);
expect('open current period', periods.filter(p => p.status === 'OPEN' && p.name === 'FY2026-27').length, 1);
atLeast('documents scanned clean', count(documents, 'CLEAN', 'scan_result'), 6);
atLeast('evidence links confirmed', documents.filter(d => d.status === 'LINKED').length, 2);
expect('approved reports', count(reports, 'APPROVED'), 2);
expect('carbon sources', sources.length, 7);
atLeast('approved carbon factors', count(carbonFactors, 'APPROVED'), 8);
atLeast('approved instruments', count(instruments, 'APPROVED'), 1);
expect('approved boundary', count(boundaries, 'APPROVED'), 1);
expect('boundary scope 2 mode', boundaries[0]?.scope2_mode, 'DUAL');
expect('carbon records calculated', carbonRecords.filter(r => r.status === 'CALCULATED').length, carbonRecords.length);
atLeast('calculated university emissions', count(emissions, 'CALCULATED'), 53);
atLeast('scope 3 screenings', screenings.length, 45);
atLeast('open corrective actions', actions.filter(a => a.status === 'OPEN').length, 1);
atLeast('closed corrective actions', actions.filter(a => a.status === 'CLOSED').length, 1);
atLeast('complete collection tasks', count(tasks, 'COMPLETE'), 35);
atLeast('open collection tasks', count(tasks, 'OPEN'), 8);
atLeast('approved supplier request', count(supplierRequests, 'APPROVED'), 1);
atLeast('open supplier request', count(supplierRequests, 'OPEN'), 1);
expect('approved materiality', count(materiality, 'APPROVED'), 1);
expect('approved pcf study', count(studies, 'APPROVED'), 1);
expect('carbon dashboard ready', dashboard.readiness?.ready, true);
expect('scope 2 market result complete', dashboard.summary?.scope2?.marketResultComplete, true);
expect('target comparable', progress.comparable, true);
expect('target threshold met', progress.recordedThresholdMet, false);
console.log('scope 2 location kg CO2e: ' + dashboard.summary.scope2.locationKgCo2e + ' | market kg CO2e: ' + dashboard.summary.scope2.marketKgCo2e);
console.log(failures.length ? 'FAILED: ' + failures.join(', ') : 'All synthetic demo tenant checks passed.');
if (failures.length) process.exitCode = 1;
