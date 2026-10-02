import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sha256, text, fail, now, cleanUser } from './shared.mjs';
import { audit, transaction } from './db.mjs';
const scryptAsync = promisify(scrypt);
const dummySalt = '93db824d09cb317ac2f2788ea3851843';
const dummyHash = Buffer.alloc(64);

export async function login(db, body) {
  const email = text(body.email, 'email', { max: 254 }).toLowerCase();
  const password = text(body.password, 'password', { min: 1, max: 256 });
  const user = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE AND active=1').get(email);
  const parts = user?.password_hash.split('$');
  const salt = parts?.[1] ?? dummySalt;
  const expected = parts ? Buffer.from(parts[2], 'hex') : dummyHash;
  const actual = await scryptAsync(password, salt, 64);
  if (!timingSafeEqual(actual, expected) || !user) fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  const token = randomBytes(32).toString('base64url');
  transaction(db, () => {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sha256(token), user.id, Date.now() + 8 * 60 * 60 * 1000, now());
    audit(db, user, 'LOGIN', 'User', user.id);
  });
  return { token, expiresIn: 28800, user: cleanUser(user) };
}
export function authenticate(db, header) {
  if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) fail(401, 'UNAUTHORIZED', 'Sign in to continue.');
  const hash = sha256(header.slice(7));
  const user = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(hash, Date.now());
  if (!user) fail(401, 'UNAUTHORIZED', 'Your session has expired. Sign in again.');
  return user;
}
export function logout(db, user, header) {
  transaction(db, () => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(header.slice(7))); audit(db,user,'LOGOUT','User',user.id); });
  return { loggedOut: true };
}
