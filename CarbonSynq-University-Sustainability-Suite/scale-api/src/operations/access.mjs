import { fail } from '../core.mjs';
export const UNIVERSITY_EVIDENCE_ROLES = Object.freeze(['ADMIN', 'REVIEWER', 'LEADERSHIP']);
/** Explicit policy: leadership/reviewers are university-wide; ENTRY is private/granted/scoped. */
export function canReadEvidence(user, document, { scope = null, memberships = [], grants = [] } = {}) {
  if (!user?.id || document?.tenant_id !== user.tenant_id || user.active === false) return false;
  if (UNIVERSITY_EVIDENCE_ROLES.includes(user.role) || document.uploaded_by === user.id) return true;
  if (user.role !== 'ENTRY') return false;
  if (grants.some(g => g.tenant_id === user.tenant_id && g.document_id === document.id && g.user_id === user.id && g.active)) return true;
  if (!scope || scope.tenant_id !== user.tenant_id || scope.document_id !== document.id || scope.visibility === 'PRIVATE') return false;
  return memberships.some(m => m.tenant_id === user.tenant_id && m.user_id === user.id && m.active && m.campus_id === scope.campus_id &&
    (m.department_id === null || (scope.visibility === 'DEPARTMENT' && m.department_id === scope.department_id)));
}
/** Shared SQL predicate for list/count/direct-read policy. Only the alias is compile-time. */
export function evidencePredicate(user, params, alias = 'd') {
  if (!['d', 'documents'].includes(alias)) throw Error('Invalid internal evidence alias.');
  if (UNIVERSITY_EVIDENCE_ROLES.includes(user.role)) return 'TRUE';
  params.push(user.id); const p = '$' + params.length;
  return `(${alias}.uploaded_by=${p} OR EXISTS(SELECT 1 FROM cs.u_o_document_grants g WHERE g.tenant_id=${alias}.tenant_id AND g.document_id=${alias}.id AND g.user_id=${p} AND g.active)
    OR EXISTS(SELECT 1 FROM cs.u_o_document_scopes sc JOIN cs.u_o_memberships m ON m.tenant_id=sc.tenant_id AND m.campus_id=sc.campus_id AND m.user_id=${p} AND m.active
      WHERE sc.tenant_id=${alias}.tenant_id AND sc.document_id=${alias}.id AND sc.visibility IN ('CAMPUS','DEPARTMENT')
      AND (m.department_id IS NULL OR (sc.visibility='DEPARTMENT' AND m.department_id=sc.department_id))))`;
}
export async function assertEvidenceAccess(c, user, d) {
  if (!d || d.tenant_id !== user.tenant_id) fail(404, 'NOT_FOUND', 'Document not found.');
  if (UNIVERSITY_EVIDENCE_ROLES.includes(user.role) || d.uploaded_by === user.id) return;
  const params = [user.tenant_id, d.id], predicate = evidencePredicate(user, params);
  const r = await c.query(`SELECT d.id FROM cs.documents d WHERE d.tenant_id=$1 AND d.id=$2 AND ${predicate}`, params);
  if (!r.rows.length) fail(404, 'NOT_FOUND', 'Document not found.');
}
