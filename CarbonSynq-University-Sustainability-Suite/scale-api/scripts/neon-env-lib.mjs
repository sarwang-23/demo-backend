/** Offline environment preparation. Never connects to services or prints credentials. */
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { config } from '../src/config.mjs';
import { operationsConfig } from '../src/operations/crypto.mjs';

const GENERATED = 'GENERATE_ON_YOUR_MACHINE';
const legacyKeys = /^(JWT_SECRET|FRONTEND_ORIGIN|CLIMATIQ_|GEMINI_|AFFINDA_|MISTRAL_|GENERIC_PURCHASED_GOODS_|DEFAULT_INVOICE_REGION|OCR_MAX_PAGES|OCR_SCALE|OCR_PAGE_TIMEOUT_MS|OCR_RENDER_TIMEOUT_MS|OCR_PDF_LOAD_TIMEOUT_MS|DISABLE_HEAVY_PDF_OCR)/;
const setupError = message => Object.assign(new Error(message), { code: 'ENV_SETUP' });
const placeholder = value => !value || value === GENERATED || /^(REPLACE|PASTE|YOUR_NEW)(?:_|$)/.test(value);

export function readEnvText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw setupError('The environment file must be text under 64 KiB.');
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=/);
    if (!m) continue;
    if (seen.has(m[1])) throw setupError('Duplicate variable names are not allowed in this environment file.');
    seen.add(m[1]);
  }
  let env;
  try { env = parseEnv(text); } catch { throw setupError('Cannot parse the environment file. Check its KEY=value syntax.'); }
  for (const key of Object.keys(env)) {
    if (legacyKeys.test(key)) throw setupError('Legacy provider/JWT/origin settings were found. Use the new .env.neon.example; do not copy the old .env.');
    if (/[\r\n\0]/.test(env[key])) throw setupError('Environment values must be single-line and must not contain NUL characters.');
  }
  return env;
}

function parseDb(value, label, { prepare = false } = {}) {
  let u;
  try { u = new URL(value); } catch { throw setupError(`${label} must be a valid PostgreSQL URL. No URL value is printed for security.`); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname.endsWith('.neon.tech') || u.hash)
    throw setupError(`${label} must use a Neon hostname and no fragment. Percent-encode special password characters.`);
  let username, password, database;
  try { username = decodeURIComponent(u.username); password = decodeURIComponent(u.password); database = decodeURIComponent(u.pathname.slice(1)); }
  catch { throw setupError(`${label} contains invalid URL encoding.`); }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(username) || !database || /[\/\0\r\n]/.test(database) || placeholder(password))
    throw setupError(`${label}: replace the placeholder with a freshly rotated, correctly encoded Neon connection string.`);
  if (prepare) {
    for (const [k, v] of u.searchParams) {
      if (k === 'sslmode' && ['require', 'verify-ca', 'verify-full'].includes(v)) continue;
      if (k === 'channel_binding' && ['require', 'prefer'].includes(v)) continue;
      throw setupError(`${label} has an unsupported URL option. This setup accepts only secure sslmode and channel_binding parameters before normalization.`);
    }
    u.search = '';
    u.hostname = u.hostname.replace(/-pooler(?=\.)/, '');
  } else if (u.search || u.hostname.split('.')[0].endsWith('-pooler')) {
    throw setupError(`${label}: this profile requires a direct URL without query options. Run npm run env:prepare.`);
  }
  if (u.port && u.port !== '5432') throw setupError(`${label}: use Neon's PostgreSQL port 5432.`);
  u.port = '5432';
  u.username = encodeURIComponent(username);
  u.password = encodeURIComponent(password);
  return { url: u, username, password, database };
}

function secret(env, key, bytes = 32) {
  if (placeholder(env[key])) env[key] = randomBytes(bytes).toString('hex');
  const v = env[key];
  if (!v || v.length < (key.startsWith('DB_') ? 24 : 32)) throw setupError(`${key} must contain a sufficiently long secret.`);
  if (key === 'MAIL_ENCRYPTION_KEY' && !/^[a-fA-F0-9]{64}$/.test(v)) throw setupError('MAIL_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.');
}

/** Return a new map; preserve all valid pre-existing runtime secrets. */
export function prepareNeonEnv(input) {
  const env = { ...input };
  if (env.CARBONSYNQ_ENV_PROFILE !== 'neon-local' || env.NODE_ENV !== 'development')
    throw setupError('This helper only prepares the neon-local development profile. Existing production/local-Postgres configurations are not overwritten.');
  if (env.DB_SSL !== 'true' || env.DB_CHANNEL_BINDING !== 'true') throw setupError('Neon setup requires DB_SSL=true and DB_CHANNEL_BINDING=true.');
  const owner = parseDb(env.DATABASE_OWNER_URL, 'DATABASE_OWNER_URL', { prepare: true });
  if (['cs_api', 'cs_worker'].includes(owner.username)) throw setupError('DATABASE_OWNER_URL must be the operator/migration owner, not a runtime role.');
  env.DATABASE_OWNER_URL = owner.url.href;
  for (const [passwordKey, urlKey, role] of [
    ['DB_API_PASSWORD', 'DATABASE_URL', 'cs_api'],
    ['DB_WORKER_PASSWORD', 'WORKER_DATABASE_URL', 'cs_worker']
  ]) {
    // A real existing URL is authoritative. Do not accidentally rotate its password.
    if (!placeholder(env[urlKey])) {
      const existing = parseDb(env[urlKey], urlKey, { prepare: true });
      if (existing.username !== role || existing.url.host !== owner.url.host || existing.database !== owner.database)
        throw setupError(`${urlKey} must use its dedicated role on the same Neon endpoint/database as the owner.`);
      if (placeholder(env[passwordKey])) env[passwordKey] = existing.password;
      if (env[passwordKey] !== existing.password) throw setupError(`${passwordKey} does not match its runtime URL. Existing credentials were not overwritten.`);
      env[urlKey] = existing.url.href;
    } else {
      secret(env, passwordKey);
      const u = new URL(owner.url);
      u.username = role;
      u.password = encodeURIComponent(env[passwordKey]);
      env[urlKey] = u.href;
    }
    secret(env, passwordKey);
  }
  for (const key of ['AWS_SECRET_ACCESS_KEY', 'METRICS_TOKEN', 'REQUEST_HASH_SECRET', 'MAIL_ENCRYPTION_KEY']) secret(env, key);
  if (new Set([owner.password, env.DB_API_PASSWORD, env.DB_WORKER_PASSWORD]).size !== 3)
    throw setupError('Owner, API and worker must use three distinct passwords.');
  checkNeonEnv(env);
  return env;
}

/** Offline consistency checks only: success does not mean any provider was contacted. */
export function checkNeonEnv(env) {
  if (env.CARBONSYNQ_ENV_PROFILE !== 'neon-local' || env.NODE_ENV !== 'development') throw setupError('Expected the neon-local development profile.');
  if (env.DB_SSL !== 'true' || env.DB_CHANNEL_BINDING !== 'true') throw setupError('Use verified DB_SSL=true and DB_CHANNEL_BINDING=true for this Neon profile.');
  const owner = parseDb(env.DATABASE_OWNER_URL, 'DATABASE_OWNER_URL');
  if (['cs_api', 'cs_worker'].includes(owner.username)) throw setupError('Owner and runtime identities must be separate.');
  for (const [urlKey, key, role] of [['DATABASE_URL', 'DB_API_PASSWORD', 'cs_api'], ['WORKER_DATABASE_URL', 'DB_WORKER_PASSWORD', 'cs_worker']]) {
    if (placeholder(env[urlKey]) || placeholder(env[key])) throw setupError('Run npm run env:prepare after entering the rotated owner URL.');
    const u = parseDb(env[urlKey], urlKey);
    if (u.username !== role || u.url.host !== owner.url.host || u.database !== owner.database || u.password !== env[key])
      throw setupError(`${urlKey} role/database/password does not match its configuration.`);
    if (env[key].length < 24) throw setupError(`${key} must have at least 24 characters.`);
  }
  if (new Set([owner.password, env.DB_API_PASSWORD, env.DB_WORKER_PASSWORD]).size !== 3) throw setupError('Owner, API and worker passwords must be distinct.');
  for (const key of ['AWS_SECRET_ACCESS_KEY', 'METRICS_TOKEN', 'REQUEST_HASH_SECRET', 'MAIL_ENCRYPTION_KEY']) {
    if (placeholder(env[key])) throw setupError('Uninitialized secrets remain; run npm run env:prepare.');
  }
  let api, worker, ops;
  try { api = config(env); worker = config(env, true); ops = operationsConfig(env); }
  catch { throw setupError('Runtime configuration is invalid. Check origins, numeric limits, mail settings, and secret lengths against .env.neon.example.'); }
  if (env.HOST !== '127.0.0.1' || env.TRUST_PROXY !== 'false' || env.S3_ENDPOINT !== 'http://127.0.0.1:9000' || env.CLAMAV_HOST !== '127.0.0.1')
    throw setupError('This template is local-only: keep HOST and CLAMAV_HOST loopback, TRUST_PROXY=false and the local storage endpoint.');
  if (env.DB_CA_FILE) throw setupError('The Neon-local Docker profile uses system trusted CAs; custom DB_CA_FILE requires an explicitly reviewed container mount.');
  if (env.S3_FORCE_PATH_STYLE !== 'true' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET || '')) throw setupError('Use path-style local storage and a valid lowercase bucket name.');
  if (ops.mailMode !== 'capture' || env.OCR_ENABLED !== 'true') throw setupError('This local demo profile expects MAIL_MODE=capture and OCR_ENABLED=true. Do not infer live email delivery.');
  if (ops.origin !== `http://localhost:${api.port}` || !api.origins.includes(ops.origin)) throw setupError('PUBLIC_BASE_URL and ALLOWED_ORIGINS must include the actual localhost PORT.');
  if (!api.origins.includes(`http://127.0.0.1:${api.port}`)) throw setupError('Include the loopback backend origin in ALLOWED_ORIGINS.');
  return { valid: true, mode: 'neon-local', port: api.port, tlsCertificateVerification: api.ssl?.rejectUnauthorized === true,
    channelBindingWhenOffered: api.enableChannelBinding && worker.enableChannelBinding,
    databaseCredentialsPrinted: false, databaseContacted: false, externalProvidersTested: false,
    mailMode: ops.mailMode, emailSent: false, ocrEnabled: ops.ocrEnabled, migrationsRun: false };
}

function quote(value) {
  if (/[\r\n\0]/.test(value)) throw setupError('Cannot write a multiline environment value.');
  if (!value.includes("'")) return "'" + value + "'";
  if (!value.includes('"') && !value.includes('\\')) return '"' + value + '"';
  throw setupError('A value has unsupported quoting. Use URL-encoded database credentials and hex local secrets.');
}

/** Preserve the template comments; use literal single quotes to avoid Compose $ expansion. */
export function renderEnv(text, env) {
  const used = new Set();
  let output = text.split(/\r?\n/).map(line => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=/);
    if (!m || !(m[1] in env)) return line;
    used.add(m[1]);
    return `${m[1]}=${quote(env[m[1]])}`;
  }).join('\n');
  for (const key of Object.keys(env)) if (!used.has(key)) output += `\n${key}=${quote(env[key])}`;
  return output.replace(/\n*$/, '\n');
}

export function safeFailure(error) {
  return error?.code === 'ENV_SETUP' ? error.message : 'Environment setup failed. Check file permissions and the template syntax. No credential values were printed.';
}
