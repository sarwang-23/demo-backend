import { registerIngestionRoutes } from '../ingestion/routes.mjs';
import { registerCarbonRoutes } from './carbon/routes.mjs';
/** Authenticated university API mounted in the existing /api/v2 server.
 * Route metadata is also used to build the bundled OpenAPI reference.
 */
import { role, text, uuid, fail } from '../core.mjs';
import { idempotent } from '../db.mjs';
import { rateLimit } from '../auth.mjs';
import { universityTx, TABLES } from './store.mjs';
import { fields,CATEGORIES,KPI_TEMPLATES,SCOPE3_CATEGORIES,STAKEHOLDERS,PCF_STAGES,commutingEstimate,hash } from './core.mjs';
import * as collection from './collection.mjs';
import * as emissions from './emissions.mjs';
import * as collaboration from './collaboration.mjs';
import * as reporting from './reporting.mjs';
import * as planning from './planning.mjs';
const ALL=['ADMIN','ENTRY','REVIEWER','LEADERSHIP'],READ=['ADMIN','REVIEWER','LEADERSHIP'],WRITE=['ADMIN','ENTRY'],REVIEW=['ADMIN','REVIEWER'],ADMIN=['ADMIN'];
const P='/api/v2/university';
export const ROUTES=[];
function route(method,path,roles,summary,fn,opts={}){const names=[],pattern='^'+(P+path).replace(/:([A-Za-z]+)/g,(_,n)=>{names.push(n);return '([^/]+)';})+'$';ROUTES.push({method,path:P+path,roles,summary,fn,regex:new RegExp(pattern),names,write:method!=='GET',cache:method!=='GET',query:[],...opts});}
export const CATALOG={version:'university-1',emissionCategories:CATEGORIES,kpiTemplates:KPI_TEMPLATES,scope3Categories:SCOPE3_CATEGORIES,stakeholders:STAKEHOLDERS,pcfStages:PCF_STAGES,insightQuestions:reporting.INSIGHTS,
  capabilities:{manualEntry:true,csvImport:true,unstructuredExcelImport:true,multiPdfInvoiceBatches:true,normalizedXlsxExport:true,privateEvidence:true,supplierQuestionnaires:true,materialitySurveys:true,reportSnapshots:true,planningTargets:true,pcfScreening:true,enhancedScope12:true,scope2DualReporting:true,aiAvailable:false,ocrAvailable:process.env.OCR_ENABLED==='true',erpConnectorConfigured:false,automaticEmail:process.env.MAIL_MODE==='webhook',localMailCapture:process.env.MAIL_MODE==='capture'},
  limits:{csvRows:100,csvBytes:50000,reportRows:5000,materialityResponses:5000,pcfLines:100,evidencePerRecord:20},
  note:'University modules share the existing PostgreSQL, sessions, audit log and evidence worker. No automatic compliance certification.'};
route('GET','/catalog',ALL,'Read supported university categories, KPI templates and capabilities',async()=>CATALOG);
route('POST','/catalog/install',ADMIN,'Install KPI definitions without seeding measurements',collection.installCatalog,{status:201});
route('GET','/meta',ALL,'Load the first reference-data pages for the university console',async(s)=>{const out={catalog:CATALOG,user:{id:s.user.id,name:s.user.name,role:s.user.role}};for(const t of ['campuses','periods','u_departments','u_kpis','u_factors'])out[t]=await s.listPage(t,{}, {limit:100});if(s.user.role==='ADMIN')out.users=await s.listPage('users',{}, {limit:100});return out;});
route('GET','/overview',READ,'Read combined inventory and approved university indicators', (s,b,p,q)=>reporting.overview(s,uuid(q.periodId)),{query:['periodId'],snapshot:true});
route('GET','/inventory',READ,'Page the combined primary and supplemental inventory', (s,b,p,q)=>s.inventoryPage(uuid(q.periodId),q),{query:['periodId','limit','afterId']});
route('GET','/knowledge/search',READ,'Search approved university records without an AI model', (s,b,p,q)=>{const term=text(q.q,'q',200);if(term.length<2)fail(422,'QUERY_LENGTH','Use at least two characters.');return s.searchApproved(term,q.periodId?uuid(q.periodId):null);},{query:['q','periodId']});
route('POST','/insights/query',READ,'Return traceable facts for a supported insight question',reporting.insights,{write:false,cache:false,snapshot:true});
route('POST','/commuting/estimate',ALL,'Estimate aggregate commuting distance with explicit assumptions',async(s,b)=>commutingEstimate(b),{write:false,cache:false});
const resources={
  departments:{table:'u_departments',create:collection.createDepartment,write:ADMIN,read:ALL},
  kpis:{table:'u_kpis',create:collection.createKpi,write:ADMIN,read:ALL},
  tasks:{table:'u_tasks',create:collection.createTask,write:ADMIN,read:ALL},
  factors:{table:'u_factors',create:emissions.createFactor,write:ADMIN,read:ALL},
  emissions:{table:'u_emissions',create:emissions.createEmission,write:WRITE,read:ALL},
  'scope3-screenings':{table:'u_scope3_screenings',create:emissions.setScreening,write:ADMIN,read:ALL},
  suppliers:{table:'u_suppliers',create:collaboration.createSupplier,write:WRITE,read:ALL},
  'supplier-requests':{table:'u_supplier_requests',create:collaboration.createSupplierRequest,write:WRITE,read:ALL},
  materiality:{table:'u_materiality',create:collaboration.createMateriality,write:WRITE,read:ALL},
  reports:{table:'u_reports',create:reporting.createReport,write:ADMIN,read:READ,snapshot:true},
  targets:{table:'u_targets',create:planning.createTarget,write:ADMIN,read:READ},
  initiatives:{table:'u_initiatives',create:planning.createInitiative,write:ADMIN,read:ALL},
  'pcf-studies':{table:'u_pcf_studies',create:planning.createPcf,write:WRITE,read:ALL},
  voids:{table:'u_voids',read:READ}
};
const filterMap={periodId:'period_id',campusId:'campus_id',departmentId:'department_id',status:'status',category:'category',kpiId:'kpi_id',supplierId:'supplier_id',targetId:'target_id'};
function readAccess(user,kind,row){if(kind==='tasks')collection.taskAccess(user,row);if(kind==='emissions')emissions.emissionAccess(user,row);
  if(['supplier-requests','materiality','pcf-studies'].includes(kind))collaboration.requestAccess(user,row);if(kind==='initiatives'&&user.role==='ENTRY'&&row.owner_id!==user.id)fail(404,'NOT_FOUND','Record not found.');}
function publicRow(user,kind,row){if(kind==='suppliers'&&!REVIEW.includes(user.role)){const {contact_email,...rest}=row;return rest;}return row;}
for(const [kind,spec] of Object.entries(resources)){
  const filterKeys=Object.keys(filterMap).filter(k=>TABLES[spec.table].split(' ').includes(filterMap[k]));
  route('GET','/'+kind,spec.read,'List '+kind+' with tenant-scoped keyset pagination',async(s,b,p,q)=>{const filters={};for(const k of filterKeys)if(q[k])filters[filterMap[k]]=k.endsWith('Id')?uuid(q[k]):text(q[k],k,80);
    if(s.user.role==='ENTRY'){if(kind==='tasks')filters.assignee_id=s.user.id;if(['emissions','supplier-requests','materiality','pcf-studies'].includes(kind))filters.created_by=s.user.id;if(kind==='initiatives')filters.owner_id=s.user.id;}
    const result=await s.listPage(spec.table,filters,q);result.items=result.items.map(r=>publicRow(s.user,kind,r));return result;},{query:['limit','cursor',...filterKeys]});
  route('GET','/'+kind+'/:id',spec.read,'Read '+kind+' record',async(s,b,p)=>{if(kind==='tasks')return collection.getTask(s,p.id);if(kind==='emissions')return emissions.getEmission(s,p.id);if(kind==='reports')return reporting.getReport(s,p.id);const r=await s.get(spec.table,uuid(p.id));readAccess(s.user,kind,r);return publicRow(s.user,kind,r);});
  if(spec.create)route('POST','/'+kind,spec.write,'Create '+kind+' record',spec.create,{status:201,snapshot:!!spec.snapshot});
}
route('POST','/tasks/:id/submissions',WRITE,'Save an assigned KPI draft or corrected revision',(s,b,p)=>collection.createSubmission(s,p.id,b),{status:201});
route('POST','/tasks/:id/waive',ADMIN,'Waive a collection task with a recorded reason',(s,b,p)=>collection.waiveTask(s,p.id,b));
route('GET','/submissions/:id',ALL,'Read an authorized collection submission',async(s,b,p)=>{const r=await s.get('u_submissions',uuid(p.id));collection.taskAccess(s.user,await s.get('u_tasks',r.task_id));return r;});
route('PATCH','/submissions/:id',WRITE,'Edit your draft or rejected collection submission',(s,b,p)=>collection.editSubmission(s,p.id,b));
for(const action of ['submit','approve','reject'])route('POST','/submissions/:id/'+action,action==='submit'?WRITE:REVIEW,action+' KPI submission',(s,b,p)=>collection.submissionAction(s,p.id,action,b));
route('POST','/factors/:id/approve',REVIEW,'Independently approve and freeze a university factor',(s,b,p)=>emissions.approveFactor(s,p.id,b));
route('PATCH','/emissions/:id',WRITE,'Edit your draft or rejected university emission record',(s,b,p)=>emissions.editEmission(s,p.id,b));
for(const action of ['submit','approve','reject'])route('POST','/emissions/:id/'+action,action==='submit'?WRITE:REVIEW,action+' university emission record',(s,b,p)=>emissions.emissionAction(s,p.id,action,b));
route('POST','/emissions/:id/request-void',WRITE,'Request a traceable correction without deleting a calculation',(s,b,p)=>emissions.requestVoid(s,p.id,b),{status:201});
for(const action of ['approve','reject'])route('POST','/voids/:id/'+action,REVIEW,action+' inventory void',(s,b,p)=>emissions.reviewVoid(s,p.id,action,b));
route('POST','/imports/emissions/preview',WRITE,'Validate CSV without inserting any rows',(s,b)=>emissions.importEmissions(s,b),{write:false,cache:false});
route('POST','/imports/emissions/commit',WRITE,'Atomically import validated CSV as reviewable drafts',(s,b)=>emissions.importEmissions(s,b,{commit:true}),{status:201});
route('POST','/supplier-requests/:id/invite',WRITE,'Issue a revocable single-use supplier capability',(s,b,p)=>collaboration.issueInvite(s,'SUPPLIER',p.id,b),{cache:false,secret:true,status:201});
route('PATCH','/supplier-requests/:id/evidence',WRITE,'Attach staff-uploaded clean evidence to supplier answers',(s,b,p)=>collaboration.supplierEvidence(s,p.id,b));
for(const action of ['approve','reject'])route('POST','/supplier-requests/:id/'+action,REVIEW,action+' supplier response',(s,b,p)=>collaboration.reviewSupplier(s,p.id,action,b));
route('POST','/materiality/:id/invite',WRITE,'Issue one stakeholder survey capability',(s,b,p)=>collaboration.issueInvite(s,'MATERIALITY',p.id,b),{cache:false,secret:true,status:201});
route('POST','/invites/:id/revoke',WRITE,'Revoke an invitation without exposing its token',(s,b,p)=>collaboration.revokeInvite(s,p.id,b));
route('GET','/materiality/:id/summary',ALL,'Read privacy-thresholded stakeholder materiality results',(s,b,p)=>collaboration.materialityStats(s,p.id));
for(const action of ['close','reopen','approve'])route('POST','/materiality/:id/'+action,action==='approve'?REVIEW:WRITE,action+' materiality assessment',(s,b,p)=>collaboration.materialityAction(s,p.id,action,b));
for(const action of ['approve','reject'])route('POST','/reports/:id/'+action,REVIEW,action+' frozen report snapshot',(s,b,p)=>reporting.reviewReport(s,p.id,action,b));
route('GET','/reports/:id/export',READ,'Export an approved report as JSON, CSV or print-ready HTML',(s,b,p,q)=>reporting.exportReport(s,p.id,q.format||'json'),{query:['format'],file:true});
route('GET','/targets/:id/progress',READ,'Compare a target with another approved inventory report',(s,b,p,q)=>planning.targetProgress(s,p.id,q.currentReportId),{query:['currentReportId']});
route('PATCH','/initiatives/:id', ['ADMIN','ENTRY','REVIEWER'],'Update owned initiative progress without deducting projected savings',(s,b,p)=>planning.initiativeAction(s,p.id,b));
route('POST','/pcf-studies/preview',ALL,'Preview a physical-factor PCF screening scenario',planning.pcfPreview,{write:false,cache:false});
for(const action of ['submit','approve','reject'])route('POST','/pcf-studies/:id/'+action,action==='submit'?WRITE:REVIEW,action+' PCF screening study',(s,b,p)=>planning.pcfAction(s,p.id,action,b));
registerCarbonRoutes(route);
registerIngestionRoutes(route);
export function matchRoute(method,path){for(const r of ROUTES){if(r.method!==method)continue;const m=r.regex.exec(path);if(m)return {route:r,params:Object.fromEntries(r.names.map((n,i)=>[n,m[i+1]]))};}fail(404,'NOT_FOUND','University API route not found.');}
export async function dispatch(pool,{user,method,path,query={},body={},key}){const {route:r,params}=matchRoute(method,path);role(user,r.roles);fields(query,r.query);const run=async(s)=>r.fn(s,body,params,query);
  const data=await universityTx(pool,user,s=>r.cache?idempotent(s.client,user,'university:'+method+':'+path,key,{body,query},()=>run(s)):run(s),{snapshot:!!r.snapshot});
  return r.file?{file:data}:{data,status:r.status||200};}
export async function portalDispatch(pool,{header,body=null,ip,requestId}){await rateLimit(pool,'university-portal-ip:'+ip,60,60);const parsed=collaboration.parseCapability(header);await rateLimit(pool,'university-capability:'+hash(parsed.token),30,60);
  return universityTx(pool,{tenant_id:parsed.tenantId,id:null,role:'CAPABILITY',requestId},s=>collaboration.portal(s,parsed,body));}
