import { createHash, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
export const fail = (status, code, message, details) => { throw new AppError(status, code, message, details); };
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const round = (value, places = 6) => Number(value.toFixed(places));
export function text(value, field, { min = 1, max = 300, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    fail(422, 'VALIDATION_ERROR', `${field} must be text between ${min} and ${max} characters.`, { field });
  return value.trim();
}
export function number(value, field, { min = 0, max = 1e9, optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(422, 'VALIDATION_ERROR', `${field} must be a number between ${min} and ${max}.`, { field });
  return value;
}
export function date(value, field) {
  const v = text(value, field, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)
    fail(422, 'VALIDATION_ERROR', `${field} must be a real date in YYYY-MM-DD format.`, { field });
  return v;
}
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, 'VALIDATION_ERROR', 'A JSON object is required.');
  return value;
}
export function requireRole(user, roles) {
  if (!roles.includes(user.role)) fail(403, 'FORBIDDEN', 'Your role does not permit this action.');
}
export function cleanUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, universityId: user.university_id };
}
export const WRITERS = ['ORGANISATION_ADMIN', 'DATA_ENTRY'];
export const REVIEWERS = ['ORGANISATION_ADMIN', 'REVIEWER'];
export const CATALOG = [
  { category: 'PURCHASED_ELECTRICITY', label: 'Purchased electricity', scope: 'SCOPE_2', unit: 'kWh', factor: 0.71 },
  { category: 'DIESEL', label: 'Diesel / generator fuel', scope: 'SCOPE_1', unit: 'litre', factor: 2.68 },
  { category: 'PETROL', label: 'Petrol / university vehicles', scope: 'SCOPE_1', unit: 'litre', factor: 2.31 },
  { category: 'LPG', label: 'LPG / campus kitchens', scope: 'SCOPE_1', unit: 'kg', factor: 2.98 },
  { category: 'NATURAL_GAS', label: 'Natural gas', scope: 'SCOPE_1', unit: 'm3', factor: 2.02 },
];
// Every value above is a DEMONSTRATION assumption, not an approved accounting factor.
export const FACTOR_NOTICE = 'DEMO ESTIMATES ONLY. Factors are illustrative, not validated for regulatory reporting, credits, offsets or an audited inventory.';
