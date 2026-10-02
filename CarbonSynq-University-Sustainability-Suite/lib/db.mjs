import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { id, now, CATALOG, round } from './shared.mjs';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function audit(db, user, action, entityType, entityId, before = null, after = null, requestId = null) {
  db.prepare('INSERT INTO audit_logs (id, university_id, user_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id(), user.university_id, user.id, action, entityType, entityId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), requestId, now());
}
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
export function seed(db) {
  if (db.prepare('SELECT id FROM universities LIMIT 1').get()) return;
  transaction(db, () => {
    const timestamp = now();
    const uni = '11111111-1111-4111-8111-111111111111';
    const other = '99999999-9999-4999-8999-999999999999';
    db.prepare('INSERT INTO universities VALUES (?,?,?,?,?)').run(uni, 'Greenfield University', 'GFU-DEMO', 'Pune, India', timestamp);
    db.prepare('INSERT INTO universities VALUES (?,?,?,?,?)').run(other, 'Isolation Test University', 'ISOLATION', 'Test tenant', timestamp);
    const accounts = [
      ['admin@carbonsynq.demo', 'University Admin', 'ORGANISATION_ADMIN'],
      ['entry@carbonsynq.demo', 'Facilities Team', 'DATA_ENTRY'],
      ['reviewer@carbonsynq.demo', 'Sustainability Reviewer', 'REVIEWER'],
      ['ceo@carbonsynq.demo', 'University Leadership', 'MANAGEMENT'],
    ];
    const users = {};
    const passHash = passwordHash('Demo@12345');
    for (const [email, name, role] of accounts) {
      const uid = id(); users[role] = uid;
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(uid, uni, name, email, role, passHash, 1, timestamp);
    }
    // A second tenant exists only as a fixture to prove access isolation in tests.
    const otherPass = passwordHash(randomBytes(32).toString('hex'));
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(id(), other, 'Isolation Test', 'isolation@carbonsynq.demo', 'ORGANISATION_ADMIN', otherPass, 1, timestamp);
    const campuses = [
      ['22222222-2222-4222-8222-222222222222', 'North Campus', 'NC'],
      ['33333333-3333-4333-8333-333333333333', 'South Campus', 'SC'],
    ];
    const buildings = [];
    for (const [cid, name, code] of campuses) {
      db.prepare('INSERT INTO campuses VALUES (?,?,?,?)').run(cid, uni, name, code);
      const names = code === 'NC' ? ['Academic Block', 'Library', 'Administration'] : ['Engineering Block', 'Student Hostel', 'Central Kitchen'];
      for (const name of names) {
        const bid = id(); buildings.push({ id: bid, campus: cid, name });
        db.prepare('INSERT INTO buildings VALUES (?,?,?,?)').run(bid, uni, cid, name);
      }
    }
    const period = '44444444-4444-4444-8444-444444444444';
    db.prepare('INSERT INTO reporting_periods VALUES (?,?,?,?,?,?)').run(period, uni, 'FY 2026-27', '2026-04-01', '2027-03-31', 'OPEN');
    db.prepare('INSERT INTO reporting_periods VALUES (?,?,?,?,?,?)').run(id(), other, 'FY 2026-27', '2026-04-01', '2027-03-31', 'OPEN');
    for (const c of CATALOG) {
      db.prepare('INSERT INTO emission_factors VALUES (?,?,?,?,?,?,?,?,?)').run(`DEMO-${c.category}-v1`, c.category, c.scope, c.unit, c.factor, 'DEMO-v1', 'Illustrative demo assumption - NOT an approved source', '2026-04-01', '2027-03-31');
    }
    const seedActor = { id: users.DATA_ENTRY, university_id: uni };
    // Six months of internally consistent synthetic data; no random claims.
    for (let month = 4; month <= 9; month++) {
      for (let bi = 0; bi < buildings.length; bi++) {
        const b = buildings[bi];
        const c = bi === 5 ? CATALOG[3] : bi === 2 ? CATALOG[1] : CATALOG[0];
        const quantity = c.unit === 'kWh' ? 10000 + bi * 2500 + (month - 4) * 340 : c.unit === 'litre' ? 300 + month * 12 : 620 + month * 18;
        const aid = id(); const day = `2026-${String(month).padStart(2, '0')}-15`;
        db.prepare(`INSERT INTO activities (id,university_id,period_id,campus_id,building_id,category,scope,quantity,unit,activity_date,description,input_source,status,entered_by,verified_by,version,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(aid, uni, period, b.campus, b.id, c.category, c.scope, quantity, c.unit, day, 'SYNTHETIC DEMO DATA - monthly campus consumption', 'MANUAL', 'CALCULATED', users.DATA_ENTRY, users.REVIEWER, 4, timestamp, timestamp);
        db.prepare('INSERT INTO calculations VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(), uni, aid, `DEMO-${c.category}-v1`, quantity, c.factor, round(quantity * c.factor), 'DEMO-v1', 'Illustrative demo assumption - NOT an approved source', timestamp);
      }
    }
    // A draft and submitted activity make the review queue useful on first run.
    for (const [status, category, quantity, day] of [['DRAFT','DIESEL',180,'2026-09-27'],['SUBMITTED','PURCHASED_ELECTRICITY',4300,'2026-09-28']]) {
      const c = CATALOG.find(x => x.category === category); const b = buildings[0]; const aid = id();
      db.prepare(`INSERT INTO activities (id,university_id,period_id,campus_id,building_id,category,scope,quantity,unit,activity_date,description,input_source,status,entered_by,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(aid,uni,period,b.campus,b.id,c.category,c.scope,quantity,c.unit,day,'SYNTHETIC DEMO DATA - awaiting workflow','MANUAL',status,users.DATA_ENTRY,1,timestamp,timestamp);
    }
    audit(db, seedActor, 'DEMO_SEEDED', 'University', uni, null, { synthetic: true, months: 6 });
  });
}
