import { uuid,text,fail } from '../core.mjs';
import { CARBON_CATALOG } from './catalog.mjs';
import { quantityPreview } from './core.mjs';
import * as svc from './service.mjs';
import * as report from './reporting.mjs';
const ALL=['ADMIN','ENTRY','REVIEWER','LEADERSHIP'],READ=['ADMIN','REVIEWER','LEADERSHIP'],WRITE=['ADMIN','ENTRY'],REVIEW=['ADMIN','REVIEWER'],ADMIN=['ADMIN'];
export function registerCarbonRoutes(register){const route=(m,p,r,d,fn,o={})=>register(m,'/carbon'+p,r,d,fn,o);
 route('GET','/catalog',ALL,'Scope 1/2 methods, source checklist and controls',async()=>CARBON_CATALOG);
 route('POST','/kpis/install',ADMIN,'Install 10 supplementary university KPI definitions',svc.installExtraKpis,{status:201});
 route('POST','/quantity/preview',ALL,'Reconcile fuel, meters, refrigerants or delivered-energy units',async(s,b)=>({...quantityPreview(b),persisted:false}),{write:false,cache:false});
 route('GET','/dashboard',READ,'Read separate Scope 1 and Scope 2 location/market totals',(s,b,p,q)=>report.dashboard(s,uuid(q.periodId)),{query:['periodId'],snapshot:true});
 route('GET','/readiness',READ,'Check source gaps, pending records and corrective actions',(s,b,p,q)=>report.readiness(s,uuid(q.periodId)),{query:['periodId'],snapshot:true});
 route('GET','/export',READ,'Export current Scope 1/2 alternative-method columns; not a frozen report',(s,b,p,q)=>report.liveExport(s,uuid(q.periodId)),{query:['periodId'],snapshot:true,file:true});
 const resources={sources:{table:'u_c_sources',create:svc.createSource,write:ADMIN},boundaries:{table:'u_c_boundaries',create:svc.createBoundary,write:ADMIN,edit:svc.editBoundary},factors:{table:'u_c_factors',create:svc.createFactor,write:REVIEW,edit:svc.editFactor},instruments:{table:'u_c_instruments',create:svc.createInstrument,write:REVIEW,edit:svc.editInstrument},records:{table:'u_c_records',create:svc.createRecord,write:WRITE,edit:svc.editRecord},actions:{table:'u_c_actions',create:svc.createAction,write:['ADMIN','ENTRY','REVIEWER']},voids:{table:'u_c_voids'}};
 const filterCols={sources:['campusId','kind'],boundaries:['periodId','status'],factors:['kind','status'],instruments:['periodId','status'],records:['periodId','sourceId','status'],actions:['periodId','campusId','status'],voids:['status']};
 for(const [kind,x] of Object.entries(resources)){
  route('GET','/'+kind,kind==='voids'?READ:ALL,'List tenant-scoped carbon '+kind,async(s,b,p,q)=>{const filters={};for(const k of filterCols[kind])if(q[k])filters[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())]=k.endsWith('Id')?uuid(q[k]):text(q[k],k,80);if(s.user.role==='ENTRY'){if(kind==='sources')filters.owner_id=s.user.id;if(kind==='records')filters.created_by=s.user.id;if(kind==='actions')filters.owner_id=s.user.id;}return s.listPage(x.table,filters,q);},{query:['limit','cursor',...filterCols[kind]]});
  route('GET','/'+kind+'/:id',kind==='voids'?READ:ALL,'Read carbon '+kind+' with tenant and ownership checks',async(s,b,p)=>{if(kind==='records')return svc.getRecord(s,p.id);const row=await s.get(x.table,uuid(p.id));if(kind==='sources')await svc.sourceAccess(s,row);if(kind==='actions'&&s.user.role==='ENTRY'&&row.owner_id!==s.user.id)fail(404,'NOT_FOUND','Action not found.');return row;});
  if(x.create)route('POST','/'+kind,x.write,'Create carbon '+kind,x.create,{status:201});
  if(x.edit)route('PATCH','/'+kind+'/:id',x.write,'Edit a draft carbon '+kind,(s,b,p)=>x.edit(s,p.id,b));
 }
 for(const [kind,fn] of Object.entries({boundaries:svc.reviewBoundary,factors:svc.reviewFactor,instruments:svc.reviewInstrument,voids:svc.reviewVoid}))for(const action of ['approve','reject'])route('POST','/'+kind+'/:id/'+action,REVIEW,'Independently '+action+' carbon '+kind,(s,b,p)=>fn(s,p.id,action,b));
 route('POST','/records/preview',WRITE,'Preview a complete reviewed-source calculation without persistence',svc.previewRecord,{write:false,cache:false});
 for(const action of ['submit','cancel','approve','reject'])route('POST','/records/:id/'+action,['submit','cancel'].includes(action)?WRITE:REVIEW,action+' source consumption or release record',(s,b,p)=>svc.recordAction(s,p.id,action,b));
 route('POST','/records/:id/request-void',WRITE,'Request a non-destructive correction of a calculation',(s,b,p)=>svc.requestVoid(s,p.id,b),{status:201});
 for(const action of ['resolve','close','reopen'])route('POST','/actions/:id/'+action,action==='resolve'?['ADMIN','ENTRY','REVIEWER']:REVIEW,action+' university corrective action',(s,b,p)=>svc.actionTransition(s,p.id,action,b));
 for(const action of ['preview','commit'])route('POST','/imports/'+action,WRITE,action+' source consumption CSV',(s,b)=>svc.importRecords(s,b,{commit:action==='commit'}),{write:action==='commit',cache:action==='commit',status:action==='commit'?201:200});
}
