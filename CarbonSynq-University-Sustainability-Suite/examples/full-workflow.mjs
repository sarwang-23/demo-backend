/**
 * Complete API example for the supplied synthetic dataset.
 * Run: npm run demo:flow
 * Starts its own loopback HTTP server with an in-memory SQLite database.
 * It does not modify the normal demo database or contact the original Neon app.
 * Human review is simulated ONLY for the known synthetic sample below.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoServer } from '../server.mjs';

/**
 * @param {string} baseURL
 * @param {string} route
 * @param {{method?: string, token?: string, json?: object, form?: FormData, headers?: Record<string,string>}} options
 * @returns {Promise<any>} Unwrapped API data, or an error with its request ID.
 */
async function api(baseURL, route, options = {}) {
  const { method = 'GET', token, json, form, headers = {} } = options;
  if (json !== undefined && form !== undefined) {
    throw new TypeError('Use either a JSON body or a multipart form, not both.');
  }
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (json !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(baseURL + route, {
    method,
    headers: requestHeaders,
    body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) {
    throw new Error(`${method} ${route}: HTTP ${response.status}, ${body.error?.code ?? 'BAD_RESPONSE'}: ${body.error?.message ?? 'Unexpected response'} (request ${body.requestId ?? 'unknown'})`);
  }
  return body.data;
}

async function main() {
  const { server } = createDemoServer({ dbPath: ':memory:', quiet: true });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback port assigned.');
    const base = `http://127.0.0.1:${address.port}`;
    const login = async (email) => (await api(base, '/api/v1/auth/login', {
      method: 'POST', json: { email, password: 'Demo@12345' },
    })).token;

    const entryToken = await login('entry@carbonsynq.demo');
    const reviewerToken = await login('reviewer@carbonsynq.demo');
    const leadershipToken = await login('ceo@carbonsynq.demo');
    const meta = await api(base, '/api/v1/meta', { token: entryToken });
    const campus = meta.campuses.find((item) => item.code === 'NC');
    const period = meta.reportingPeriods.find((item) => item.status === 'OPEN');
    assert.ok(campus && period, 'The synthetic campus and reporting period must exist.');
    const building = meta.buildings.find((item) => item.campusId === campus.id && item.name === 'Academic Block');
    assert.ok(building, 'The synthetic Academic Block must exist.');
    const before = await api(base, '/api/v1/dashboard', { token: leadershipToken });
    const common = {
      reportingPeriodId: period.id,
      campusId: campus.id,
      buildingId: building.id,
      category: 'PURCHASED_ELECTRICITY',
      unit: 'kWh',
    };

    // 1. Manual entry: preview is read-only, then save a draft.
    const manualInput = {
      ...common,
      quantity: 1250,
      activityDate: '2026-10-02',
      description: 'Synthetic API example - manual electricity consumption',
    };
    const preview = await api(base, '/api/v1/activity-data/preview', {
      method: 'POST', token: entryToken, json: manualInput,
    });
    assert.equal(preview.kgCO2e, 887.5);
    let manual = await api(base, '/api/v1/activity-data', {
      method: 'POST', token: entryToken, json: manualInput,
      headers: { 'Idempotency-Key': 'example-manual-001' },
    });
    assert.equal(manual.status, 'DRAFT');
    const draftDashboard = await api(base, '/api/v1/dashboard', { token: leadershipToken });
    assert.equal(draftDashboard.totalKgCO2e, before.totalKgCO2e);

    // Always use the response's current version, not a guessed version counter.
    const act = async (activity, action, token) => api(base,
      `/api/v1/activity-data/${activity.id}/${action}`, {
        method: 'POST', token, json: { version: activity.version },
      });
    const approve = async (activity) => {
      let current = await act(activity, 'submit', entryToken);
      current = await act(current, 'start-review', reviewerToken);
      current = await act(current, 'verify', reviewerToken);
      return act(current, 'calculate', reviewerToken);
    };
    manual = await approve(manual);
    assert.equal(manual.status, 'CALCULATED');
    assert.equal(manual.calculation.kgCO2e, 887.5);

    // 2. Upload original synthetic PDF bytes using the multipart file field.
    const original = await readFile(new URL('../samples/sample-electricity.pdf', import.meta.url));
    const form = new FormData();
    form.append('file', new Blob([original], { type: 'application/pdf' }), 'sample-electricity.pdf');
    const document = await api(base, '/api/v1/documents/upload', {
      method: 'POST', token: entryToken, form,
    });
    assert.equal(document.status, 'REVIEW_REQUIRED');
    assert.equal(document.extraction.ocrAvailable, false);
    assert.equal(document.extraction.fields.quantity, 12500);
    assert.equal(document.extraction.fields.amountInr, 112500);

    // This fixture confirms predetermined sample data. For REAL invoices, a
    // person must inspect the evidence before setting reviewConfirmed=true.
    let invoiceActivity = await api(base, `/api/v1/documents/${document.id}/create-activity`, {
      method: 'POST', token: entryToken,
      json: {
        ...common,
        version: document.version,
        reviewConfirmed: true,
        quantity: 12500,
        activityDate: '2026-09-30',
        description: 'Synthetic sample invoice - known fixture values',
        vendor: 'Greenfield Utilities (Demo)',
        invoiceNumber: 'DEMO-ELEC-2026-0930',
        amountInr: 112500,
      },
    });
    assert.equal(invoiceActivity.documentId, document.id);
    assert.equal(invoiceActivity.quantity, 12500);
    assert.equal(invoiceActivity.amountInr, 112500);
    invoiceActivity = await approve(invoiceActivity);
    assert.equal(invoiceActivity.calculation.kgCO2e, 8875);

    // 3. Leadership sees only the approved/calculated changes.
    const after = await api(base, '/api/v1/dashboard', { token: leadershipToken });
    const report = await api(base, '/api/v1/reports/summary', { token: leadershipToken });
    const delta = after.totalKgCO2e - before.totalKgCO2e;
    assert.ok(Math.abs(delta - 9762.5) < 0.000001);
    assert.equal(after.calculatedActivities, before.calculatedActivities + 2);
    assert.equal(after.evidenceCount, before.evidenceCount + 1);
    assert.equal(report.summary.totalKgCO2e, after.totalKgCO2e);

    // Download and compare evidence bytes, rather than trusting only metadata.
    const download = await fetch(`${base}/api/v1/documents/${document.id}/download`, {
      headers: { Authorization: `Bearer ${leadershipToken}` },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);

    for (const token of [entryToken, reviewerToken, leadershipToken]) {
      await api(base, '/api/v1/auth/logout', { method: 'POST', token });
    }
    console.log(JSON.stringify({
      result: 'PASS',
      mode: 'Isolated in-memory database and real loopback HTTP requests',
      manualActivity: { quantityKWh: 1250, kgCO2e: manual.calculation.kgCO2e, status: manual.status },
      invoiceActivity: { quantityKWh: 12500, amountInr: 112500, kgCO2e: invoiceActivity.calculation.kgCO2e, status: invoiceActivity.status },
      dashboardDeltaKgCO2e: Number(delta.toFixed(6)),
      calculatedActivitiesAdded: 2,
      originalInvoiceBytesPreserved: true,
      reportReconciles: true,
      illustrativeFactorsOnly: true,
      ocrConnected: false,
      persistentDemoDatabaseChanged: false,
    }, null, 2));
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

main().catch((error) => {
  console.error(`Workflow example failed: ${error.message}`);
  process.exitCode = 1;
});
