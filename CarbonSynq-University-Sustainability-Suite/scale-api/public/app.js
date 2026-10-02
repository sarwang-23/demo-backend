'use strict';
const $ = s => document.querySelector(s), esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = null, user = null, meta = null, view = 'overview', records = [], documents = [], jobs = [], entryContext = null, formKey = null, uploadKey = null, epoch = 0, nextCursor = null, navigation = 0;
const writable = () => ['ADMIN', 'ENTRY'].includes(user?.role), reviewer = () => ['ADMIN', 'REVIEWER'].includes(user?.role);
function notify(message, bad = false) { $('#notice').hidden = false; $('#notice').classList.toggle('bad', bad); $('#notice').textContent = message; }
async function api(path, { method = 'GET', body, raw, headers = {}, key } = {}) {
    const generation = epoch;
    const opts = { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } };
    if (body !== undefined) {
        opts.body = JSON.stringify(body);
        opts.headers['Content-Type'] = 'application/json';
    }
    if (raw !== undefined)
        opts.body = raw;
    if (key)
        opts.headers['Idempotency-Key'] = key;
    const r = await fetch('/api/v2' + path, opts);
    const result = await r.json();
    if (generation !== epoch)
        throw Error('Session changed.');
    if (!r.ok)
        throw Error(`${result.error?.message || 'Request failed'}${result.requestId ? ' [request ' + result.requestId.slice(0, 8) + ']' : ''}`);
    return result.data;
}
const number = x => Number(x || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }), pretty = x => String(x || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const badge = x => `<span class="badge ${esc(x)}">${esc(pretty(x))}</span>`;
const table = (head, rows) => `<div class="card table-wrap"><table><thead><tr>${head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}"><div class="empty">Nothing here yet.<br>Your workspace starts with real data, not invented totals.</div></td></tr>`}</tbody></table></div>`;
function names() { return Object.fromEntries((meta?.campuses || []).map(x => [x.id, x.name])); }
function more() { return nextCursor ? '<div class="section-gap"><button class="outline dark" data-action="more">Load more records</button></div>' : ''; }
$('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    $('#loginError').textContent = '';
    try {
        const data = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        token = data.token;
        user = data.user;
        epoch++;
        meta = await api('/meta');
        $('#loginView').hidden = true;
        $('#workspace').hidden = false;
        $('#tenantName').textContent = meta.tenant.name;
        $('#userName').textContent = user.name;
        $('#userRole').textContent = pretty(user.role);
        await loadView('overview');
        e.target.password.value = '';
    }
    catch (err) {
        token = null;
        user = null;
        meta = null;
        $('#workspace').hidden = true;
        $('#loginView').hidden = false;
        $('#loginError').textContent = err.message;
    }
    finally {
        button.disabled = false;
    }
});
$('#logout').addEventListener('click', async () => { try {
    await api('/auth/logout', { method: 'POST' });
}
catch { } token = null; user = null; meta = null; records = []; documents = []; jobs = []; epoch++; $('#workspace').hidden = true; $('#view').replaceChildren(); $('#loginView').hidden = false; $('#entryDialog').close(); });
$('nav').addEventListener('click', e => { if (e.target.dataset.view)
    loadView(e.target.dataset.view).catch(err => notify(err.message, true)); });
$('#refresh').addEventListener('click', () => loadView(view).catch(err => notify(err.message, true)));
async function loadView(selected, append = false) {
    const navigationId = ++navigation;
    view = selected;
    document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === view));
    const titles = { overview: ['LEADERSHIP OVERVIEW', 'University carbon operations', 'A clear view of your reviewed inventory and the work behind it.'], entries: ['ACTIVITY LEDGER', 'Every activity. Accounted for.', 'Capture consumption, track review and preserve the calculation trail.'], invoices: ['EVIDENCE WORKSPACE', 'Invoices with accountability', 'Original files are scanned, reviewed and linked to actual consumption.'], jobs: ['PROCESSING OPERATIONS', 'Work moving in the background', 'Durable jobs with visible retries and a recoverable failure queue.'], setup: ['WORKSPACE ADMINISTRATION', 'Build your university workspace', 'Configure your people, campus structure and approved accounting factors.'] };
    const t = titles[view];
    $('#pageEyebrow').textContent = t[0];
    $('#pageTitle').textContent = t[1];
    $('#pageDescription').textContent = t[2];
    if (!append)
        nextCursor = null;
    if (view === 'overview') {
        const d = await api('/dashboard');
        if (navigationId !== navigation)
            return;
        const pending = d.pipeline.filter(x => !['CALCULATED', 'REJECTED'].includes(x.status)).reduce((a, x) => a + Number(x.count), 0), total = Number(d.totals.calculated_records), coverage = total ? 100 * Number(d.totals.invoice_backed_records) / total : 0, max = Math.max(...d.campuses.map(x => Number(x.kg_co2e)), 1);
        $('#view').innerHTML = `<div class="kpi-grid"><div class="card kpi"><div class="kpi-label">REVIEWED EMISSIONS</div><div class="kpi-number">${number(d.totals.tonnes_co2e)}<small>tCO2e</small></div><div class="kpi-note">Calculated ledger only</div></div><div class="card kpi"><div class="kpi-label">CALCULATED ACTIVITIES</div><div class="kpi-number">${number(total)}</div><div class="kpi-note">Independently verified inputs</div></div><div class="card kpi"><div class="kpi-label">AWAITING COMPLETION</div><div class="kpi-number">${number(pending)}</div><div class="kpi-note">Not included in emissions totals</div></div><div class="card kpi"><div class="kpi-label">INVOICE-BACKED RECORDS</div><div class="kpi-number">${number(coverage)}<small>%</small></div><div class="kpi-note">${number(d.totals.invoice_backed_records)} of ${number(total)} calculated records</div></div></div><div class="dashboard-grid"><section class="card"><div class="card-head"><h3>Campus contribution</h3><span class="sub-label">TONNES CO2e</span></div><div class="card-body">${d.campuses.length ? d.campuses.map(c => `<div class="bar-row"><div class="bar-title"><span>${esc(c.name)}</span><strong>${number(Number(c.kg_co2e) / 1000)}</strong></div><meter min="0" max="${max}" value="${Number(c.kg_co2e)}" aria-label="${esc(c.name)} contribution"></meter></div>`).join('') : '<div class="empty">No calculated inventory yet.<br>Complete your first independently reviewed activity.</div>'}<div class="data-note">Campus totals use the same calculation ledger as your reports. Invoice amounts never substitute for energy or fuel quantities.</div></div></section><section class="card"><div class="card-head"><h3>Review pipeline</h3><span class="sub-label">ACTIVITIES</span></div><div class="card-body">${['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'CALCULATED'].map(s => `<div class="pipeline-item">${badge(s)}<strong>${number(d.pipeline.find(x => x.status === s)?.count || 0)}</strong></div>`).join('')}<div class="data-note">Maker-checker separation: the person entering an activity cannot approve their own record.</div></div></section></div><section class="card section-gap"><div class="card-head"><h3>Operating principles</h3><span class="sub-label">NO SILENT ASSUMPTIONS</span></div><div class="card-body"><p class="muted">Approved factor versions. Preserved invoice evidence. Clear review states. No synthetic emissions are seeded into this workspace.</p>${writable() ? '<button class="primary" data-action="new">Create first / next activity &rarr;</button>' : ''}</div></section>`;
    }
    else if (['entries', 'invoices', 'jobs'].includes(view)) {
        const resource = { entries: 'activities', invoices: 'documents', jobs: 'jobs' }[view], result = await api('/' + resource + '?limit=50' + (append && nextCursor ? '&cursor=' + encodeURIComponent(nextCursor) : ''));
        if (navigationId !== navigation)
            return;
        if (view === 'entries') {
            records = append ? [...records, ...result.items] : result.items;
            nextCursor = result.nextCursor;
            renderEntries();
        }
        if (view === 'invoices') {
            documents = append ? [...documents, ...result.items] : result.items;
            nextCursor = result.nextCursor;
            renderDocuments();
        }
        if (view === 'jobs') {
            jobs = append ? [...jobs, ...result.items] : result.items;
            nextCursor = result.nextCursor;
            $('#view').innerHTML = table(['Job', 'Status', 'Attempts', 'Details', 'Action'], jobs.map(j => `<tr><td><strong>${esc(pretty(j.kind))}</strong><small>${esc(j.id.slice(0, 8))}</small></td><td>${badge(j.status)}</td><td>${j.attempts} / ${j.max_attempts}</td><td>${esc(j.last_error || 'No reported error')}</td><td>${j.status === 'DEAD' && user.role === 'ADMIN' ? `<button class="small-button" data-action="retry-job" data-id="${esc(j.id)}">Retry</button>` : ''}</td></tr>`)) + more();
        }
    }
    else {
        meta = await api('/meta');
        if (navigationId !== navigation)
            return;
        renderSetup();
    }
}
function renderEntries() { const lookup = names(); $('#view').innerHTML = `<div class="action-strip">${writable() ? '<button class="primary" data-action="new">+ New manual entry</button>' : ''}<span class="sub-label">${records.length} loaded records. API uses cursor pagination.</span></div>` + table(['Activity', 'Campus', 'Consumption', 'Status', 'Actions'], records.map(a => `<tr><td><strong>${esc(pretty(a.category))}</strong><small>${esc(a.activity_date)} &middot; ${esc(a.input_source)}</small></td><td>${esc(lookup[a.campus_id] || 'Campus')}</td><td>${esc(a.quantity)} ${esc(a.unit)}</td><td>${badge(a.status)}</td><td>${writable() && ['DRAFT', 'REJECTED'].includes(a.status) ? `<button class="small-button" data-action="edit" data-id="${a.id}">Edit</button>` : ''}${writable() && a.status === 'DRAFT' ? `<button class="small-button" data-action="submit" data-id="${a.id}">Submit</button>` : ''}${reviewer() && a.status === 'SUBMITTED' ? `<button class="small-button" data-action="start-review" data-id="${a.id}">Start review</button>` : ''}${reviewer() && a.status === 'UNDER_REVIEW' ? `<button class="small-button" data-action="verify" data-id="${a.id}">Verify</button><button class="small-button" data-action="reject" data-id="${a.id}">Reject</button>` : ''}</td></tr>`)) + more(); }
function renderDocuments() { $('#view').innerHTML = (writable() ? '<div class="upload-box"><h3>Upload an invoice</h3><p>PDF, PNG, JPEG or text. Maximum 10 MB. Scans and unsupported layouts require manual fields after the security scan.</p><input id="invoiceFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt"><button class="primary" data-action="upload">Upload evidence</button></div>' : '') + table(['Evidence', 'Size', 'Status', 'Scan result', 'Actions'], documents.map(d => `<tr><td><strong>${esc(d.original_name)}</strong><small>${esc(d.sha256.slice(0, 16))}&hellip;</small></td><td>${number(Number(d.file_size) / 1024)} KB</td><td>${badge(d.status)}</td><td>${esc(d.scan_result || 'Pending')}</td><td>${['REVIEW_REQUIRED', 'LINKED'].includes(d.status) ? `<button class="small-button" data-action="download" data-id="${d.id}">Original file</button>` : ''}${writable() && d.status === 'REVIEW_REQUIRED' ? `<button class="small-button" data-action="review-invoice" data-id="${d.id}">Review fields</button>` : ''}</td></tr>`)) + more(); }
function fillSelect(select, items, empty) { select.innerHTML = (empty ? `<option value="">${esc(empty)}</option>` : '') + items.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(''); }
function buildingOptions(selected) { const form = $('#entryForm'); fillSelect(form.buildingId, meta.buildings.filter(b => b.campus_id === form.campusId.value), 'No building / campus level'); if (selected)
    form.buildingId.value = selected; }
function unitHint() { $('#unitHint').textContent = 'Canonical unit: ' + (meta.categories[$('#entryForm').category.value]?.[1] || ''); }
async function openEntry(context = null) {
    meta = await api('/meta');
    entryContext = context;
    formKey = crypto.randomUUID();
    const f = $('#entryForm');
    f.reset();
    $('#entryError').textContent = '';
    fillSelect(f.periodId, meta.periods.filter(p => p.status === 'OPEN'));
    fillSelect(f.campusId, meta.campuses);
    fillSelect(f.category, Object.keys(meta.categories).map(k => ({ id: k, name: pretty(k) })));
    buildingOptions();
    f.activityDate.value = new Date().toISOString().slice(0, 10);
    $('#invoiceFields').hidden = !context?.invoice;
    $('#entryTitle').textContent = context?.invoice ? 'Review invoice fields' : context?.activity ? 'Edit activity' : 'New manual activity';
    if (context?.activity) {
        const a = context.activity;
        for (const [input, key] of [['periodId', 'period_id'], ['campusId', 'campus_id'], ['category', 'category'], ['quantity', 'quantity'], ['activityDate', 'activity_date'], ['description', 'description'], ['duplicateReason', 'duplicate_reason']])
            f[input].value = a[key] || '';
        buildingOptions(a.building_id);
    }
    if (context?.invoice) {
        $('#invoiceReviewNotes').textContent = (context.invoice.extraction?.warnings || ['Review actual consumption against the original file.']).join(' ');
        const fields = context.invoice.extraction?.fields || {};
        for (const name of ['vendor', 'invoiceNumber', 'amountInr', 'quantity', 'activityDate', 'category'])
            if (fields[name] !== undefined)
                f[name].value = String(fields[name]);
    }
    unitHint();
    $('#entryDialog').showModal();
}
$('#entryForm').campusId.addEventListener('change', () => buildingOptions());
$('#entryForm').category.addEventListener('change', unitHint);
$('#closeDialog').addEventListener('click', () => $('#entryDialog').close());
$('#entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    $('#entryError').textContent = '';
    try {
        const f = e.target, b = Object.fromEntries(new FormData(f));
        b.unit = meta.categories[b.category][1];
        if (!b.buildingId)
            delete b.buildingId;
        if (!b.duplicateReason)
            delete b.duplicateReason;
        if (entryContext?.invoice) {
            b.version = entryContext.invoice.version;
            b.reviewConfirmed = f.reviewConfirmed.checked;
            await api('/documents/' + entryContext.invoice.id + '/confirm', { method: 'POST', body: b, key: formKey });
        }
        else {
            delete b.vendor;
            delete b.invoiceNumber;
            delete b.amountInr;
            delete b.reviewConfirmed;
            if (entryContext?.activity) {
                b.version = entryContext.activity.version;
                await api('/activities/' + entryContext.activity.id, { method: 'PATCH', body: b });
            }
            else
                await api('/activities', { method: 'POST', body: b, key: formKey });
        }
        $('#entryDialog').close();
        notify('Draft saved. Submit it and ask a different person to review.');
        await loadView('entries');
    }
    catch (err) {
        $('#entryError').textContent = err.message;
    }
    finally {
        button.disabled = false;
    }
});
$('#view').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b)
        return;
    const action = b.dataset.action, rid = b.dataset.id;
    b.disabled = true;
    try {
        if (action === 'new')
            await openEntry();
        else if (action === 'edit')
            await openEntry({ activity: records.find(a => a.id === rid) });
        else if (action === 'review-invoice')
            await openEntry({ invoice: await api('/documents/' + rid) });
        else if (action === 'more')
            await loadView(view, true);
        else if (action === 'upload') {
            const file = $('#invoiceFile').files[0];
            if (!file)
                throw Error('Choose an invoice first.');
            uploadKey ||= crypto.randomUUID();
            await api('/documents/upload', { method: 'POST', raw: file, headers: { 'Content-Type': file.type || 'text/plain', 'X-Filename': encodeURIComponent(file.name) }, key: uploadKey });
            uploadKey = null;
            notify('Evidence received. The processing queue will show its scan status.');
            await loadView('invoices');
        }
        else if (action === 'download') {
            const r = await fetch('/api/v2/documents/' + rid + '/download', { headers: { Authorization: 'Bearer ' + token } });
            if (!r.ok)
                throw Error((await r.json()).error.message);
            const blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
            a.href = url;
            a.download = documents.find(d => d.id === rid)?.original_name || 'invoice';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        else if (['submit', 'start-review', 'verify', 'reject'].includes(action)) {
            const a = records.find(x => x.id === rid), body = { version: a.version };
            if (action === 'verify') {
                meta = await api('/meta');
                const factors = meta.factors.filter(f => f.status === 'APPROVED' && f.category === a.category && f.unit === a.unit && a.activity_date >= f.valid_from && a.activity_date <= f.valid_to);
                if (!factors.length)
                    throw Error('No matching approved factor. Create and independently approve a factor in Workspace setup.');
                const choice = prompt('Select the factor number after checking source, region and methodology:\n' + factors.map((f, i) => `${i + 1}. ${f.version_label} | ${f.region} | ${f.value} | ${f.source}`).join('\n'));
                if (choice === null)
                    return;
                const factor = factors[Number(choice) - 1];
                if (!factor)
                    throw Error('Select a valid factor number.');
                body.factorId = factor.id;
            }
            if (action === 'reject') {
                body.reason = prompt('Reason for rejection:');
                if (body.reason === null)
                    return;
            }
            await api('/activities/' + rid + '/' + action, { method: 'POST', body });
            notify(action === 'verify' ? 'Verified. A durable calculation job was queued.' : 'Workflow updated.');
            await loadView('entries');
        }
        else if (action === 'approve-factor') {
            await api('/factors/' + rid + '/approve', { method: 'POST' });
            notify('Factor approved. Its value and provenance are now immutable.');
            await loadView('setup');
        }
        else if (action === 'retry-job') {
            const reason = prompt('Why should this failed job be retried?');
            if (reason === null)
                return;
            await api('/jobs/' + rid + '/retry', { method: 'POST', body: { reason } });
            notify('Job requeued.');
            await loadView('jobs');
        }
    }
    catch (err) {
        notify(err.message, true);
    }
    finally {
        b.disabled = false;
    }
});
$('#view').addEventListener('change', e => { if (e.target.id === 'invoiceFile')
    uploadKey = null; });
function renderSetup() {
    const input = (name, label, type = 'text', full = false) => `<label class="${full ? 'full' : ''}">${label}<input name="${name}" type="${type}" required></label>`;
    $('#view').innerHTML = (user.role === 'ADMIN' ? `<div class="setup-grid"><section class="card"><form data-resource="users"><h3>Add a team member</h3><div class="field-stack">${input('name', 'Full name')}${input('email', 'Work email', 'email')}${input('password', 'Initial password (12+ characters)', 'password')}<label>Role<select name="role"><option>ENTRY</option><option>REVIEWER</option><option>LEADERSHIP</option><option>ADMIN</option></select></label></div><button class="primary section-gap">Create user</button></form></section><section class="card"><form data-resource="campuses"><h3>Add a campus</h3><div class="field-stack">${input('name', 'Campus name')}${input('code', 'Campus code')}</div><button class="primary section-gap">Create campus</button></form><form data-resource="periods"><h3>Add a reporting period</h3><div class="field-stack">${input('name', 'Period name', 'text', true)}${input('startDate', 'Start date', 'date')}${input('endDate', 'End date', 'date')}</div><button class="primary section-gap">Create period</button></form></section><section class="card full"><form data-resource="factors"><h3>Register a factor for independent approval</h3><div class="field-stack"><label>Category<select name="category">${Object.keys(meta.categories).map(k => `<option value="${esc(k)}">${esc(pretty(k))}</option>`).join('')}</select></label>${input('value', 'Factor: kgCO2e / canonical unit')}${input('versionLabel', 'Version label')}${input('region', 'Applicable geography')}${input('source', 'Published source')}${input('sourceUrl', 'HTTPS source URL', 'url')}${input('validFrom', 'Valid from', 'date')}${input('validTo', 'Valid to', 'date')}${input('methodology', 'Methodology and boundary', 'text', true)}</div><p class="fine">No official factor values are assumed. A different authorized reviewer must approve this version.</p><button class="primary">Register draft factor</button></form></section></div>` : '<div class="data-note">Only an administrator can create users, campuses and factor versions. Reviewers can independently approve factor drafts below.</div>') + '<h3 class="section-gap">Factor register</h3>' + table(['Category', 'Value / unit', 'Version / source', 'Status', 'Approval'], meta.factors.map(f => `<tr><td>${esc(pretty(f.category))}</td><td>${esc(f.value)} / ${esc(f.unit)}</td><td><strong>${esc(f.version_label)}</strong><small>${esc(f.region)} &middot; ${esc(f.source)}</small></td><td>${badge(f.status)}</td><td>${reviewer() && f.status === 'DRAFT' ? `<button class="small-button" data-action="approve-factor" data-id="${f.id}">Approve</button>` : ''}</td></tr>`));
}
$('#view').addEventListener('submit', async (e) => { const f = e.target.closest('form[data-resource]'); if (!f)
    return; e.preventDefault(); e.submitter.disabled = true; try {
    const body = Object.fromEntries(new FormData(f));
    if (f.dataset.resource === 'factors')
        body.unit = meta.categories[body.category][1];
    f.dataset.key ||= crypto.randomUUID();
    await api('/' + f.dataset.resource, { method: 'POST', body, key: f.dataset.key });
    notify('Workspace record created.');
    await loadView('setup');
}
catch (err) {
    notify(err.message, true);
    e.submitter.disabled = false;
} });
