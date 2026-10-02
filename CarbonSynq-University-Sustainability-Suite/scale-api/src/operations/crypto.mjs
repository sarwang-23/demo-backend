import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { uuid, fail } from '../core.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function credentialToken(tenantId, tokenId) { return `${uuid(tenantId)}.${uuid(tokenId)}.${randomBytes(32).toString('base64url')}`; }
export function parseCredential(token) {
  if (typeof token !== 'string' || token.length > 180) fail(400, 'INVALID_LINK', 'This link is invalid or expired.');
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) fail(400, 'INVALID_LINK', 'This link is invalid or expired.');
  try { return { tenantId: uuid(parts[0]), id: uuid(parts[1]), tokenHash: digest(token) }; }
  catch { fail(400, 'INVALID_LINK', 'This link is invalid or expired.'); }
}
function key(secret) { if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw Error('MAIL_ENCRYPTION_KEY must contain 64 hexadecimal characters.'); return Buffer.from(secret, 'hex'); }
/** AES-GCM binds each encrypted message to its tenant + outbox ID. Never persist plaintext tokens. */
export function seal(value, secret, context) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function unseal(value, secret, context) {
  if (typeof value !== 'string' || value.length > 65536) throw Error('Invalid mail envelope.');
  const [v, nonce, tag, body, extra] = value.split('.');
  if (v !== 'v1' || extra || !nonce || !tag || !body) throw Error('Invalid mail envelope.');
  const iv = Buffer.from(nonce, 'base64url'), auth = Buffer.from(tag, 'base64url');
  if (iv.length !== 12 || auth.length !== 16) throw Error('Invalid mail envelope.');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), iv); decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(auth);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
}
export function operationsConfig(env = process.env) {
  const production = env.NODE_ENV === 'production', mailMode = env.MAIL_MODE || 'disabled';
  if (!['disabled', 'capture', 'webhook'].includes(mailMode)) throw Error('MAIL_MODE must be disabled, capture or webhook.');
  if (production && mailMode === 'capture') throw Error('Local mail capture is forbidden in production.');
  const origin = env.PUBLIC_BASE_URL || 'http://localhost:8080';
  const u = new URL(origin);
  if (u.origin !== origin || !['http:', 'https:'].includes(u.protocol) || (production && u.protocol !== 'https:')) throw Error('PUBLIC_BASE_URL must be an exact trusted HTTPS origin in production.');
  if (mailMode !== 'disabled') key(env.MAIL_ENCRYPTION_KEY);
  if (mailMode === 'webhook') {
    const webhook = new URL(env.MAIL_WEBHOOK_URL || '');
    if (webhook.protocol !== 'https:' || webhook.username || webhook.password || webhook.hash) throw Error('MAIL_WEBHOOK_URL must be a server-controlled HTTPS endpoint.');
    if ((env.MAIL_WEBHOOK_SECRET || '').length < 32) throw Error('MAIL_WEBHOOK_SECRET must contain at least 32 characters.');
  }
  return { production, mailMode, origin, encryptionKey: env.MAIL_ENCRYPTION_KEY, webhookUrl: env.MAIL_WEBHOOK_URL,
    webhookSecret: env.MAIL_WEBHOOK_SECRET, captureDir: env.MAIL_CAPTURE_DIR || '.private-mail', ocrEnabled: env.OCR_ENABLED === 'true',
    exportMaxRows: 100000, exportMaxBytes: 32 * 1024 * 1024 };
}
