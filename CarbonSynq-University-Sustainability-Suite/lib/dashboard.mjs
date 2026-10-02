import { allFiltered, tenantCheck } from './activities.mjs';
import { CATALOG,FACTOR_NOTICE,round,fail } from './shared.mjs';
export function metadata(db,user) {
  return { university:db.prepare('SELECT * FROM universities WHERE id=?').get(user.university_id),
    campuses:db.prepare('SELECT id,name,code FROM campuses WHERE university_id=? ORDER BY name').all(user.university_id),
    buildings:db.prepare('SELECT id,name,campus_id AS campusId FROM buildings WHERE university_id=? ORDER BY name').all(user.university_id),
    reportingPeriods:db.prepare('SELECT id,name,start_date AS startDate,end_date AS endDate,status FROM reporting_periods WHERE university_id=? ORDER BY start_date DESC').all(user.university_id),
    categories:CATALOG.map(({factor,...rest})=>rest),factors:db.prepare('SELECT * FROM emission_factors ORDER BY category').all(),
    factorNotice:FACTOR_NOTICE,demoOnly:true,invoiceSupport:{maxMB:10,types:['PDF','PNG','JPEG','TXT'],ocr:false,humanReviewRequired:true},
    workflow:['DRAFT','SUBMITTED','UNDER_REVIEW','VERIFIED','CALCULATED'] };
}
export function dashboard(db,user,query={}) {
  tenantCheck(user,query.universityId);
  const activities=allFiltered(db,user,query);const calculated=activities.filter(a=>a.status==='CALCULATED'&&a.calculation);
  const sum=calculated.reduce((n,a)=>n+a.calculation.kgCO2e,0);
  const group=(key)=>{
    const grouped=new Map();
    for(const a of calculated){const label=a[key]??'Unassigned';const prev=grouped.get(label)??{name:label,kgCO2e:0,count:0};prev.kgCO2e+=a.calculation.kgCO2e;prev.count++;grouped.set(label,prev);}
    return [...grouped.values()].map(x=>({...x,kgCO2e:round(x.kgCO2e),tCO2e:round(x.kgCO2e/1000),share:sum?round(x.kgCO2e/sum*100,2):0})).sort((a,b)=>b.kgCO2e-a.kgCO2e);
  };
  const months=new Map();
  for(const a of calculated){const m=a.activityDate.slice(0,7);const prev=months.get(m)??{month:m,SCOPE_1:0,SCOPE_2:0,total:0};prev[a.scope]+=a.calculation.kgCO2e;prev.total+=a.calculation.kgCO2e;months.set(m,prev);}
  const statusCounts={};for(const a of activities)statusCounts[a.status]=(statusCounts[a.status]??0)+1;
  const evidenceCount=calculated.filter(a=>a.documentId).length;
  const consumption=new Map();for(const a of calculated){const key=a.category;const p=consumption.get(key)??{category:key,unit:a.unit,quantity:0};p.quantity+=a.quantity;consumption.set(key,p);}
  return {demoOnly:true,factorNotice:FACTOR_NOTICE,totalKgCO2e:round(sum),totalTCO2e:round(sum/1000),totalActivities:activities.length,calculatedActivities:calculated.length,
    pendingReview:(statusCounts.SUBMITTED??0)+(statusCounts.UNDER_REVIEW??0),drafts:statusCounts.DRAFT??0,
    verifiedAwaitingCalculation:statusCounts.VERIFIED??0,evidenceCoverage:calculated.length?round(evidenceCount/calculated.length*100,1):0,evidenceCount,
    totalInvoices:db.prepare('SELECT COUNT(*) AS n FROM documents WHERE university_id=?').get(user.university_id).n,
    statusCounts,byScope:group('scope'),byCampus:group('campusName'),byCategory:group('category'),byBuilding:group('buildingName'),
    consumption:[...consumption.values()].map(x=>({...x,quantity:round(x.quantity,4)})),
    monthly:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({month:x.month,scope1TCO2e:round(x.SCOPE_1/1000),scope2TCO2e:round(x.SCOPE_2/1000),totalTCO2e:round(x.total/1000)})),
    recentActivities:activities.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,6),
    insight:calculated.length?`${group('category')[0]?.name.replaceAll('_',' ').toLowerCase()} is the largest calculated category in this selection.`:'No approved and calculated activities in this selection.'};
}
export function auditList(db,user,query={}) {
  const page=Number(query.page??1);const limit=Number(query.limit??25);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)fail(422,'INVALID_PAGINATION','Use page >= 1 and limit between 1 and 100.');
  const total=db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE university_id=?').get(user.university_id).n;
  const rows=db.prepare(`SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.university_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT ? OFFSET ?`).all(user.university_id,limit,(page-1)*limit);
  return {items:rows.map(r=>({id:r.id,action:r.action,entityType:r.entity_type,entityId:r.entity_id,user:r.user_name,createdAt:r.created_at,requestId:r.request_id,before:r.before_json?JSON.parse(r.before_json):null,after:r.after_json?JSON.parse(r.after_json):null})),pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
}
export function report(db,user,query={}) {
  return {title:'CarbonSynq University Carbon Summary',university:metadata(db,user).university.name,generatedAt:new Date().toISOString(),demoOnly:true,factorNotice:FACTOR_NOTICE,filters:query,summary:dashboard(db,user,query),activities:allFiltered(db,user,query)};
}
function csvCell(value) {
  let v=String(value??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';
}
export function reportCsv(data) {
  const rows=[['DEMO ONLY - NOT AN AUDITED INVENTORY',data.factorNotice],['Activity ID','Date','Campus','Building','Category','Scope','Quantity','Unit','Source','Status','kgCO2e (calculated only)','Factor','Factor version','Factor source','Invoice amount INR (not consumption)','Vendor','Invoice number','Description']];
  for(const a of data.activities)rows.push([a.id,a.activityDate,a.campusName,a.buildingName,a.category,a.scope,a.quantity,a.unit,a.inputSource,a.status,a.calculation?.kgCO2e??'',a.calculation?.factor??'',a.calculation?.version??'',a.calculation?.source??'',a.amountInr,a.vendor,a.invoiceNumber,a.description]);
  return '\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
