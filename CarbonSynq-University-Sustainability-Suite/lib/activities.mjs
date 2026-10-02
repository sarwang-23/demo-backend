import { audit, transaction } from './db.mjs';
import { id, now, fail, text, number, date, object, requireRole, WRITERS, REVIEWERS, CATALOG, round, sha256 } from './shared.mjs';

export function tenantCheck(user, value) {
  if (value !== undefined && value !== null && value !== '' && value !== user.university_id)
    fail(403, 'TENANT_MISMATCH', 'Access is restricted to your university.');
}
export function getActivityRow(db, user, activityId) {
  const row = db.prepare('SELECT * FROM activities WHERE id=? AND university_id=?').get(activityId,user.university_id);
  if (!row) fail(404,'NOT_FOUND','Activity not found.');
  return row;
}
export function requireVersion(row, value) {
  if (!Number.isInteger(value) || value !== row.version)
    fail(409,'STALE_VERSION','This record changed or its version is missing. Refresh and try again.',{ currentVersion:row.version });
}
export function requireOpenPeriod(db, user, periodId) {
  const row = db.prepare('SELECT * FROM reporting_periods WHERE id=? AND university_id=?').get(periodId,user.university_id);
  if (!row) fail(422,'INVALID_PERIOD','Reporting period does not belong to this university.');
  if (row.status !== 'OPEN') fail(409,'PERIOD_LOCKED','This reporting period is locked.');
  return row;
}
export function validateActivity(db, user, input) {
  object(input); tenantCheck(user,input.universityId);
  const reportingPeriodId = text(input.reportingPeriodId,'reportingPeriodId',{ max:60 });
  const period = requireOpenPeriod(db,user,reportingPeriodId);
  const campusId = text(input.campusId,'campusId',{ max:60 });
  if (!db.prepare('SELECT id FROM campuses WHERE id=? AND university_id=?').get(campusId,user.university_id))
    fail(422,'INVALID_CAMPUS','Choose a campus belonging to this university.');
  const buildingId = text(input.buildingId,'buildingId',{ max:60,optional:true });
  if (buildingId && !db.prepare('SELECT id FROM buildings WHERE id=? AND campus_id=? AND university_id=?').get(buildingId,campusId,user.university_id))
    fail(422,'INVALID_BUILDING','Building does not belong to the selected campus.');
  const category = text(input.category,'category',{ max:60 });
  const catalog = CATALOG.find(c=>c.category===category);
  if (!catalog) fail(422,'INVALID_CATEGORY','Choose a supported demo activity category.');
  if (input.scope && input.scope!==catalog.scope) fail(422,'INVALID_SCOPE','Scope does not match this activity category.');
  const quantity = number(input.quantity,'quantity',{ min:0.0001,max:1e9 });
  if (Math.abs(quantity*1e4-Math.round(quantity*1e4))>0.01) fail(422,'QUANTITY_PRECISION','Quantity supports up to 4 decimal places.');
  const unit = text(input.unit,'unit',{ max:20 });
  if (unit!==catalog.unit) fail(422,'UNIT_MISMATCH',`Use ${catalog.unit} for ${catalog.label}. Convert the consumption before submitting.`);
  const activityDate = date(input.activityDate,'activityDate');
  if (activityDate<period.start_date || activityDate>period.end_date) fail(422,'DATE_OUTSIDE_PERIOD',`Date must be between ${period.start_date} and ${period.end_date}.`);
  const description = text(input.description,'description',{ max:2000,optional:true })??'';
  const duplicateReason = text(input.duplicateReason,'duplicateReason',{ max:500,optional:true });
  return { reportingPeriodId,campusId,buildingId,category,scope:catalog.scope,quantity:round(quantity,4),unit,activityDate,description,duplicateReason,allowDuplicate:input.allowDuplicate===true };
}
export function findFactor(db, activity) {
  const category = activity.category; const day = activity.activityDate??activity.activity_date;
  const factors = db.prepare('SELECT * FROM emission_factors WHERE category=? AND unit=? AND valid_from<=? AND valid_to>=? ORDER BY valid_from DESC').all(category,activity.unit,day,day);
  if (factors.length!==1) fail(422,'FACTOR_UNAVAILABLE','No unambiguous factor exists for this category, unit and date.');
  return factors[0];
}
export function preview(db,user,input) {
  const a=validateActivity(db,user,input); const f=findFactor(db,a);
  return { quantity:a.quantity,unit:a.unit,scope:a.scope, factorId:f.id,factor:f.value,factorUnit:`kgCO2e/${f.unit}`,kgCO2e:round(a.quantity*f.value),tCO2e:round(a.quantity*f.value/1000),factorVersion:f.version,factorSource:f.source,demoOnly:true };
}
function checkDuplicate(db,user,a,excludeId='') {
  const duplicate=db.prepare(`SELECT id FROM activities WHERE university_id=? AND period_id=? AND campus_id=? AND building_id IS ? AND category=? AND quantity=? AND unit=? AND activity_date=? AND id<>? LIMIT 1`)
    .get(user.university_id,a.reportingPeriodId,a.campusId,a.buildingId,a.category,a.quantity,a.unit,a.activityDate,excludeId);
  if (duplicate && (!a.allowDuplicate || !a.duplicateReason))
    fail(409,'POSSIBLE_DUPLICATE','A matching activity already exists. Add an explicit duplicate reason only when this is a separate, genuine consumption record.',{existingActivityId:duplicate.id});
}
export function insertActivity(db,user,a,{documentId=null,amountInr=null,vendor=null,invoiceNumber=null,requestId=null}={}) {
  checkDuplicate(db,user,a);
  const aid=id(); const timestamp=now();
  db.prepare(`INSERT INTO activities (id,university_id,period_id,campus_id,building_id,category,scope,quantity,unit,activity_date,description,input_source,document_id,amount_inr,vendor,invoice_number,status,entered_by,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(aid,user.university_id,a.reportingPeriodId,a.campusId,a.buildingId,a.category,a.scope,a.quantity,a.unit,a.activityDate,a.description,documentId?'INVOICE':'MANUAL',documentId,amountInr,vendor,invoiceNumber,'DRAFT',user.id,1,timestamp,timestamp);
  audit(db,user,'ACTIVITY_CREATED','Activity',aid,null,{...a,documentId,amountInr,vendor,invoiceNumber},requestId);
  return aid;
}
const baseSelect=`SELECT a.*, c.name AS campus_name, b.name AS building_name, p.name AS period_name, u.name AS entered_by_name,
  v.name AS verified_by_name, cal.kg_co2e,cal.factor_value,cal.factor_version,cal.factor_source,cal.factor_id,cal.calculated_at
  FROM activities a JOIN campuses c ON c.id=a.campus_id LEFT JOIN buildings b ON b.id=a.building_id
  JOIN reporting_periods p ON p.id=a.period_id JOIN users u ON u.id=a.entered_by
  LEFT JOIN users v ON v.id=a.verified_by LEFT JOIN calculations cal ON cal.activity_id=a.id`;
export function serializeActivity(r) {
  return {id:r.id,universityId:r.university_id,reportingPeriodId:r.period_id,periodName:r.period_name,campusId:r.campus_id,campusName:r.campus_name,buildingId:r.building_id,buildingName:r.building_name,category:r.category,scope:r.scope,quantity:r.quantity,unit:r.unit,activityDate:r.activity_date,description:r.description,inputSource:r.input_source,documentId:r.document_id,amountInr:r.amount_inr,vendor:r.vendor,invoiceNumber:r.invoice_number,status:r.status,enteredById:r.entered_by,enteredBy:r.entered_by_name,verifiedById:r.verified_by,verifiedBy:r.verified_by_name,rejectionReason:r.rejection_reason,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at,calculation:r.kg_co2e===null||r.kg_co2e===undefined?null:{kgCO2e:r.kg_co2e,tCO2e:round(r.kg_co2e/1000),factor:r.factor_value,factorId:r.factor_id,version:r.factor_version,source:r.factor_source,calculatedAt:r.calculated_at,demoOnly:true}};
}
export function getActivity(db,user,activityId) {
  const row=db.prepare(`${baseSelect} WHERE a.id=? AND a.university_id=?`).get(activityId,user.university_id);
  if(!row)fail(404,'NOT_FOUND','Activity not found.');return serializeActivity(row);
}
export function filterActivities(user,query={}) {
  tenantCheck(user,query.universityId); const conditions=['a.university_id=?']; const params=[user.university_id];
  for (const [key,column] of [['reportingPeriodId','a.period_id'],['campusId','a.campus_id'],['status','a.status'],['category','a.category'],['inputSource','a.input_source']]) {
    if(key==='status' && query[key]==='REVIEW_QUEUE') { conditions.push("a.status IN ('SUBMITTED','UNDER_REVIEW','VERIFIED')"); }
    else if(query[key]) { conditions.push(`${column}=?`);params.push(text(query[key],key,{max:80})); }
  }
  if(query.search) { const search=text(query.search,'search',{max:100}).replace(/[\\%_]/g,'\\$&');conditions.push("(a.description LIKE ? ESCAPE '\\' OR a.category LIKE ? ESCAPE '\\' OR COALESCE(a.vendor,'') LIKE ? ESCAPE '\\')");params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  return {where:conditions.join(' AND '),params};
}
export function listActivities(db,user,query={}) {
  const {where,params}=filterActivities(user,query);
  const page=Number(query.page??1);const limit=Number(query.limit??25);
  if(!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(limit)||limit<1||limit>100)fail(422,'INVALID_PAGINATION','Use page >= 1 and limit between 1 and 100.');
  const total=db.prepare(`SELECT COUNT(*) AS n FROM activities a WHERE ${where}`).get(...params).n;
  const rows=db.prepare(`${baseSelect} WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);
  return {items:rows.map(serializeActivity),pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
}
export function createActivity(db,user,input,key=null,requestId=null) {
  requireRole(user,WRITERS); const a=validateActivity(db,user,input);
  const requestHash=sha256(JSON.stringify(input));
  if(key)text(key,'Idempotency-Key',{max:128});
  const aid=transaction(db,()=>{
    if(key) {
      const previous=db.prepare('SELECT * FROM idempotency_keys WHERE user_id=? AND route=? AND request_key=?').get(user.id,'activities.create',key);
      if(previous) {
        if(previous.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','The idempotency key was already used with a different request.');
        return previous.result_id;
      }
    }
    const aid=insertActivity(db,user,a,{requestId});
    if(key)db.prepare('INSERT INTO idempotency_keys VALUES (?,?,?,?,?,?)').run(user.id,'activities.create',key,requestHash,aid,now());
    return aid;
  });
  return getActivity(db,user,aid);
}
export function updateActivity(db,user,activityId,input,requestId=null) {
  requireRole(user,WRITERS); object(input);
  transaction(db,()=>{
    const old=getActivityRow(db,user,activityId);requireVersion(old,input.version);requireOpenPeriod(db,user,old.period_id);
    if(!['DRAFT','REJECTED'].includes(old.status))fail(409,'IMMUTABLE_ACTIVITY','Only draft or rejected activities can be edited.');
    if(user.role==='DATA_ENTRY'&&old.entered_by!==user.id)fail(403,'NOT_OWNER','Only the original author or an administrator can edit this record.');
    const combined={reportingPeriodId:old.period_id,campusId:old.campus_id,buildingId:old.building_id,category:old.category,scope:old.scope,quantity:old.quantity,unit:old.unit,activityDate:old.activity_date,description:old.description,...input};
    // Scope follows the category; validateActivity still rejects an explicitly wrong scope.
    if(input.category && !Object.hasOwn(input,'scope'))delete combined.scope;
    if(input.reportingPeriodId && input.reportingPeriodId!==old.period_id)fail(422,'PERIOD_IMMUTABLE','Create a new draft to change reporting periods.');
    const a=validateActivity(db,user,combined);
    checkDuplicate(db,user,a,activityId);
    db.prepare(`UPDATE activities SET campus_id=?,building_id=?,category=?,scope=?,quantity=?,unit=?,activity_date=?,description=?,status='DRAFT',rejection_reason=NULL,version=version+1,updated_at=? WHERE id=? AND university_id=?`)
      .run(a.campusId,a.buildingId,a.category,a.scope,a.quantity,a.unit,a.activityDate,a.description,now(),activityId,user.university_id);
    audit(db,user,'ACTIVITY_UPDATED','Activity',activityId,old,a,requestId);
  });
  return getActivity(db,user,activityId);
}
export function deleteActivity(db,user,activityId,input,requestId=null) {
  requireRole(user,WRITERS);
  transaction(db,()=>{
    const old=getActivityRow(db,user,activityId);requireVersion(old,input.version);requireOpenPeriod(db,user,old.period_id);
    if(!['DRAFT','REJECTED'].includes(old.status))fail(409,'IMMUTABLE_ACTIVITY','Only draft or rejected activities can be deleted.');
    if(user.role==='DATA_ENTRY'&&old.entered_by!==user.id)fail(403,'NOT_OWNER','Only the original author or an administrator can delete this record.');
    db.prepare('DELETE FROM activities WHERE id=? AND university_id=?').run(activityId,user.university_id);
    if(old.document_id)db.prepare("UPDATE documents SET status='REVIEW_REQUIRED',invoice_key=NULL,version=version+1,updated_at=? WHERE id=? AND university_id=?").run(now(),old.document_id,user.university_id);
    db.prepare('DELETE FROM idempotency_keys WHERE result_id=? AND user_id IN (SELECT id FROM users WHERE university_id=?)').run(activityId,user.university_id);
    audit(db,user,'ACTIVITY_DELETED','Activity',activityId,old,null,requestId);
  });return {deleted:true};
}
export function transition(db,user,activityId,action,input,requestId=null) {
  object(input); requireRole(user,action==='submit'?WRITERS:REVIEWERS);
  transaction(db,()=>{
    const old=getActivityRow(db,user,activityId);requireOpenPeriod(db,user,old.period_id);
    if(action==='calculate'&&old.status==='CALCULATED')return; // Safe replay: one calculation per activity.
    requireVersion(old,input.version);
    let next;let reason=null;
    if(action==='submit') {
      if(old.status!=='DRAFT')fail(409,'INVALID_TRANSITION','Only drafts can be submitted.');
      if(user.role==='DATA_ENTRY'&&old.entered_by!==user.id)fail(403,'NOT_OWNER','Only the author or administrator can submit this record.');next='SUBMITTED';
    } else if(action==='start-review') {
      if(old.status!=='SUBMITTED')fail(409,'INVALID_TRANSITION','Only submitted activities can enter review.');next='UNDER_REVIEW';
    } else if(action==='verify') {
      if(old.status!=='UNDER_REVIEW')fail(409,'INVALID_TRANSITION','Start review before verification.');
      if(old.entered_by===user.id)fail(403,'SELF_APPROVAL_BLOCKED','A different user must verify your activity.');
      findFactor(db,old);next='VERIFIED';
    } else if(action==='reject') {
      if(!['SUBMITTED','UNDER_REVIEW'].includes(old.status))fail(409,'INVALID_TRANSITION','Only submitted or under-review activities can be rejected.');
      reason=text(input.reason,'reason',{min:5,max:1000});next='REJECTED';
    } else if(action==='calculate') {
      if(old.status!=='VERIFIED')fail(409,'INVALID_TRANSITION','Only verified activities can be calculated.');
      const f=findFactor(db,old);const kg=round(old.quantity*f.value);
      db.prepare('INSERT INTO calculations VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),user.university_id,activityId,f.id,old.quantity,f.value,kg,f.version,f.source,now());next='CALCULATED';
    } else fail(404,'NOT_FOUND','Unknown workflow action.');
    db.prepare('UPDATE activities SET status=?,verified_by=?,rejection_reason=?,version=version+1,updated_at=? WHERE id=? AND university_id=?')
      .run(next,action==='verify'?user.id:old.verified_by,reason,now(),activityId,user.university_id);
    audit(db,user,`ACTIVITY_${next}`,'Activity',activityId,{status:old.status,version:old.version},{status:next,version:old.version+1,reason},requestId);
  });
  return getActivity(db,user,activityId);
}
export function allFiltered(db,user,query={}) {
  const {where,params}=filterActivities(user,query);
  return db.prepare(`${baseSelect} WHERE ${where} ORDER BY a.activity_date,a.id`).all(...params).map(serializeActivity);
}
