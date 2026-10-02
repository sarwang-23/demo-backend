/** University domain rules. All emissions arithmetic uses decimal strings + BigInt. */
import { fail, object, text, uuid, day, decimal, canonical, hash } from '../core.mjs';
export { fail, object, text, uuid, day, decimal, canonical, hash };
export const CATEGORIES = Object.freeze({
  PCF_ENERGY: {scope:'PCF_ONLY', number:null, units:['kWh','litre'], label:'PCF process energy; excluded from inventory', inventory:false},
  PCF_MATERIAL: {scope:'PCF_ONLY', number:null, units:['kg','item'], label:'PCF material screening factor; excluded from inventory', inventory:false},
  REFRIGERANT_LEAKAGE: {scope:'SCOPE_1', number:null, units:['kg'], label:'Refrigerant leakage; gas-specific GWP factor required'},
  PURCHASED_HEAT: {scope:'SCOPE_2', number:null, units:['kWh'], label:'Purchased heat; location-based inventory'},
  PURCHASED_COOLING: {scope:'SCOPE_2', number:null, units:['kWh'], label:'Purchased cooling; location-based inventory'},
  PURCHASED_GOODS: {scope:'SCOPE_3', number:1, units:['kg','item','INR'], label:'Purchased goods and services'},
  FOOD_PURCHASES: {scope:'SCOPE_3', number:1, units:['kg','meal','INR'], label:'Dining and canteen purchases'},
  WATER_SUPPLY: {scope:'SCOPE_3', number:1, units:['m3'], label:'Purchased water supply'},
  CAPITAL_GOODS: {scope:'SCOPE_3', number:2, units:['kg','item','INR'], label:'Capital goods and construction purchases'},
  UPSTREAM_ENERGY: {scope:'SCOPE_3', number:3, units:['kWh','litre'], label:'Upstream energy only; exclude Scope 1/2 combustion/generation'},
  UPSTREAM_FREIGHT: {scope:'SCOPE_3', number:4, units:['tonne_km'], label:'Purchased freight'},
  WASTE_TREATMENT: {scope:'SCOPE_3', number:5, units:['kg'], label:'Waste treatment by material and disposal route'},
  WASTEWATER: {scope:'SCOPE_3', number:5, units:['m3'], label:'Wastewater treatment'},
  BUSINESS_TRAVEL: {scope:'SCOPE_3', number:6, units:['passenger_km'], label:'Employee business travel; mode-specific factor'},
  HOTEL_STAYS: {scope:'SCOPE_3', number:6, units:['room_night'], label:'Business accommodation; optional boundary component'},
  EMPLOYEE_COMMUTING: {scope:'SCOPE_3', number:7, units:['passenger_km','vehicle_km'], label:'Employee commuting'},
  UPSTREAM_LEASED_ASSETS: {scope:'SCOPE_3', number:8, units:['kWh','litre'], label:'Leased assets not included in Scope 1/2'},
  STUDENT_COMMUTING: {scope:'SUPPLEMENTAL', number:null, units:['passenger_km','vehicle_km'], label:'Student commuting; supplemental university boundary'},
  STUDENT_TRAVEL: {scope:'SUPPLEMENTAL', number:null, units:['passenger_km'], label:'Student travel; supplemental university boundary'}
});
export const SCOPE3_CATEGORIES = [
  'Purchased goods and services','Capital goods','Fuel- and energy-related activities','Upstream transportation and distribution',
  'Waste generated in operations','Business travel','Employee commuting','Upstream leased assets','Downstream transportation and distribution',
  'Processing of sold products','Use of sold products','End-of-life treatment of sold products','Downstream leased assets','Franchises','Investments'
];
export const KPI_TEMPLATES = [
  ['ELECTRICITY_KWH','Purchased electricity','ENERGY','kWh','SUM'],['SOLAR_GENERATION_KWH','On-site solar generation','ENERGY','kWh','SUM'],
  ['WATER_WITHDRAWAL_M3','Water withdrawal','WATER','m3','SUM'],['WATER_REUSED_M3','Water reused','WATER','m3','SUM'],
  ['WASTEWATER_TREATED_M3','Wastewater treated','WATER','m3','SUM'],['WASTE_GENERATED_KG','Non-hazardous waste generated','WASTE','kg','SUM'],
  ['WASTE_RECOVERED_KG','Non-hazardous waste recovered','WASTE','kg','SUM'],['FOOD_WASTE_KG','Food waste','WASTE','kg','SUM'],
  ['E_WASTE_KG','E-waste transferred to authorized handler','WASTE','kg','SUM'],['LAB_HAZARDOUS_WASTE_KG','Laboratory hazardous waste','WASTE','kg','SUM'],
  ['FLEET_FUEL_LITRE','University fleet fuel','TRANSPORT','litre','SUM'],['STAFF_COMMUTE_PKM','Aggregate employee commuting','TRANSPORT','passenger_km','SUM'],
  ['STUDENT_COMMUTE_PKM','Aggregate student commuting','TRANSPORT','passenger_km','SUM'],
  ['STUDENT_FTE','Student full-time equivalents','NORMALIZATION','FTE','LATEST'],['STAFF_FTE','Staff full-time equivalents','NORMALIZATION','FTE','LATEST'],
  ['FLOOR_AREA_M2','Operational floor area','NORMALIZATION','m2','LATEST'],
  ['TRAINING_HOURS','Sustainability training hours','SOCIAL','hour','SUM'],['SAFETY_INCIDENTS','Aggregate safety incidents','SOCIAL','count','SUM'],
  ['SUSTAINABILITY_COURSES','Sustainability course offerings','ACADEMIC','count','LATEST'],
  ['SUSTAINABILITY_RESEARCH','Sustainability research projects','ACADEMIC','count','LATEST'],
  ['COMMUNITY_SERVICE_HOURS','Community service hours','ACADEMIC','hour','SUM'],['POLICY_REVIEWS','Completed sustainability policy reviews','GOVERNANCE','count','SUM']
].map(([code,name,domain,unit,aggregation])=>({code,name,domain,unit,aggregation,evidenceRequired:true,guidance:domain==='NORMALIZATION'?'One campus-wide annual value. Use consistent boundaries; do not sum monthly headcounts.':'Use non-overlapping measurement intervals and source buckets. Evidence required. No automatic emissions conversion.'}));
export const STAKEHOLDERS = ['STUDENTS','FACULTY','STAFF','SUPPLIERS','COMMUNITY','LEADERSHIP'];
export const PCF_STAGES = ['MATERIALS','TRANSPORT','MANUFACTURING','USE','END_OF_LIFE'];
export function fields(body, allowed) {
  object(body);
  const extra=Object.keys(body).filter(k=>!allowed.includes(k));
  if(extra.length) fail(422,'UNKNOWN_FIELD','Unexpected fields; tenant, workflow state and calculated values are server-owned.',{fields:extra});
  return body;
}
export function choice(value, options, name) { if(!options.includes(value)) fail(422,'INVALID_CHOICE',`Unsupported ${name}.`,{allowed:options}); return value; }
export function integer(value,min,max,name) { if(!Number.isInteger(value)||value<min||value>max) fail(422,'INVALID_INTEGER',`${name} must be an integer from ${min} to ${max}.`); return value; }
export function bool(value,name) { if(typeof value!=='boolean') fail(422,'INVALID_BOOLEAN',`${name} must be a boolean.`); return value; }
export function reason(value) {const r=text(value,'reason',2000);if(r.length<10) fail(422,'REASON_REQUIRED','Provide at least 10 characters of explanation.');return r;}
export function code(value) {const c=text(value,'code',80);if(!/^[A-Z][A-Z0-9_:-]*$/.test(c)) fail(422,'INVALID_CODE','Use uppercase letters, digits, underscores, colon or hyphen.');return c;}
export function https(value) {let u;try{u=new URL(value);}catch{}if(!u||u.protocol!=='https:'||u.username||u.password||u.href.length>1000) fail(422,'SOURCE_URL','Supply an HTTPS source URL without credentials.');return u.href;}
export function evidenceIds(value=[]) {if(!Array.isArray(value)||value.length>20) fail(422,'EVIDENCE_LIMIT','Supply at most 20 document IDs.');const ids=value.map(x=>uuid(x));if(new Set(ids).size!==ids.length)fail(422,'DUPLICATE_EVIDENCE','Evidence IDs must be unique.');return ids;}
export function dateRange(from,to) {from=day(from);to=day(to);if(from>to) fail(422,'DATE_RANGE','Start must not be later than end.');return [from,to];}
export function overlaps(a,b) {return a.interval_start<=b.interval_end&&b.interval_start<=a.interval_end;}
export function scaled(value,precision=6) {if(typeof value!=='string'||! /^-?\d+(\.\d+)?$/.test(value)) throw Error('Internal decimal invariant');let sign=1n;if(value.startsWith('-')){sign=-1n;value=value.slice(1);}const [a,b='']=value.split('.');if(b.length>precision)throw Error('Internal decimal precision');return sign*BigInt(a+b.padEnd(precision,'0'));}
export function format(n,precision=6) {const sign=n<0n?'-':'';n=n<0n?-n:n;const str=n.toString().padStart(precision+1,'0');return sign+(precision?str.slice(0,-precision)+'.'+str.slice(-precision):str);}
export function divideRounded(n,d) {if(d<=0n)throw Error('Positive divisor required');const sign=n<0n?-1n:1n;n=n<0n?-n:n;return sign*((n+d/2n)/d);}
export function sum(values) {return format(values.reduce((n,x)=>n+scaled(x),0n));}
export function product(q,f) {return format(divideRounded(scaled(decimal(q,'quantity',6,true),6)*scaled(decimal(f,'factor',9,true),9),1000000000n));}
export function ratio(n,d,precision=6) {const denom=scaled(d);return denom===0n?null:format(divideRounded(scaled(n)*10n**BigInt(precision),denom),precision);}
export function percentOf(n,d) {return ratio(format(scaled(n)*100n),d,2);}
export function factorInput(body) {
  fields(body,['category','unit','value','method','source','sourceUrl','region','boundary','versionLabel','validFrom','validTo','currency','priceYear']);
  const spec=CATEGORIES[body.category];if(!spec) fail(422,'INVALID_CATEGORY','Select a university category.');
  choice(body.unit,spec.units,'unit');choice(body.method,['ACTIVITY_BASED','SPEND_BASED'],'method');
  if((body.unit==='INR')!==(body.method==='SPEND_BASED'))fail(422,'METHOD_UNIT','INR requires spend-based accounting; physical units require activity-based accounting.');
  const [from,to]=dateRange(body.validFrom,body.validTo);
  let currency=null,priceYear=null;
  if(body.method==='SPEND_BASED'){currency=choice(body.currency,['INR'],'currency');priceYear=integer(body.priceYear,1990,2100,'priceYear');}
  else if(body.currency!=null||body.priceYear!=null) fail(422,'PRICE_BASIS','Do not attach currency or price year to a physical factor.');
  return {category:body.category,unit:body.unit,value:decimal(body.value,'factor',9),method:body.method,source:text(body.source,'source',1000),source_url:https(body.sourceUrl),
    region:text(body.region,'region',120),boundary:reason(body.boundary),version_label:text(body.versionLabel,'versionLabel',80),valid_from:from,valid_to:to,currency,price_year:priceYear};
}
export function emissionInput(body) {
  fields(body,['periodId','campusId','departmentId','category','unit','quantity','activityDate','externalKey','description','factorId','dataQuality','assumptions','currency','priceYear','evidenceIds','replacesId']);
  const spec=CATEGORIES[body.category];if(!spec) fail(422,'INVALID_CATEGORY','Select a university category.');
  if(spec.inventory===false)fail(422,'FACTOR_ONLY_CATEGORY','PCF-only categories cannot be posted to the emissions inventory.');
  const quality=choice(body.dataQuality,['MEASURED','ESTIMATED','SPEND_PROXY'],'dataQuality');
  choice(body.unit,spec.units,'unit');
  if((body.unit==='INR')!==(quality==='SPEND_PROXY'))fail(422,'QUALITY_METHOD','Spend values must be labelled SPEND_PROXY.');
  const assumptions=quality==='MEASURED'?(text(body.assumptions,'assumptions',2000,true)||''):reason(body.assumptions);
  const external=text(body.externalKey,'externalKey',180);if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(external))fail(422,'INVALID_EXTERNAL_KEY','Use a stable source record identifier without spaces.');
  if(body.unit!=='INR'&&(body.currency!=null||body.priceYear!=null))fail(422,'PRICE_BASIS','Physical quantities must not have a currency basis.');
  return {period_id:uuid(body.periodId),campus_id:uuid(body.campusId),department_id:body.departmentId?uuid(body.departmentId):null,
    category:body.category,scope:spec.scope,scope3_category:spec.number,unit:body.unit,quantity:decimal(body.quantity),activity_date:day(body.activityDate),external_key:external,
    description:text(body.description,'description',2000),factor_id:uuid(body.factorId),data_quality:quality,assumptions,
    currency:body.unit==='INR'?choice(body.currency,['INR'],'currency'):null,price_year:body.unit==='INR'?integer(body.priceYear,1990,2100,'priceYear'):null,
    evidence_ids:evidenceIds(body.evidenceIds),replaces_id:body.replacesId?uuid(body.replacesId):null};
}
export function checkFactor(record,factor) {
  if(factor.status!=='APPROVED'||record.category!==factor.category||record.unit!==factor.unit||record.activity_date<factor.valid_from||record.activity_date>factor.valid_to)
    fail(422,'FACTOR_MISMATCH','An approved factor must match category, unit and date.');
  if(record.currency!==factor.currency||record.price_year!==factor.price_year)fail(422,'PRICE_BASIS_MISMATCH','Currency and price year must match. No automatic FX or inflation adjustment is performed.');
}
export function commutingEstimate(body) {
  fields(body,['oneWayKm','days','participants','mode','basis','occupancy','sampleSize','population','extrapolate']);
  const distance=decimal(body.oneWayKm,'oneWayKm'),days=integer(body.days,1,366,'days'),people=integer(body.participants,1,1000000,'participants');
  const basis=choice(body.basis,['passenger_km','vehicle_km'],'basis');const mode=text(body.mode,'mode',80);
  const sample=integer(body.sampleSize,1,1000000,'sampleSize'),pop=integer(body.population,sample,10000000,'population');
  if(people!==sample)fail(422,'SAMPLE_SIZE','participants must equal sampleSize; split different commuting patterns into separate estimates.');
  const extrapolate=bool(body.extrapolate,'extrapolate');
  let n=scaled(distance)*2n*BigInt(days)*BigInt(people);
  if(extrapolate)n=divideRounded(n*BigInt(pop),BigInt(sample));
  if(basis==='vehicle_km'){const occ=decimal(body.occupancy,'occupancy');if(scaled(occ)<1000000n)fail(422,'OCCUPANCY','Occupancy must be at least one.');n=divideRounded(n*1000000n,scaled(occ));}
  else if(body.occupancy!=null)fail(422,'OCCUPANCY','Occupancy applies only to vehicle-km.');
  return {quantity:format(n),unit:basis,mode,estimated:true,extrapolated:extrapolate,coveragePercent:percentOf(String(sample),String(pop)),
    formula:'2 x one-way km x days x sampled participants; optional population/sample expansion; vehicle-km divided by occupancy',
    warning:'Aggregate planning estimate, not a measured inventory entry. Sampling bias and mode factors require review. Student commuting stays supplemental.'};
}
export function questionnaire(items) {
  if(!Array.isArray(items)||items.length<1||items.length>30)fail(422,'QUESTION_LIMIT','Supply 1 to 30 questions.');const seen=new Set();
  return items.map(q=>{fields(q,['key','label','type','required','unit','options']);const key=code(q.key);if(seen.has(key))fail(422,'DUPLICATE_KEY','Question keys must be unique.');seen.add(key);
    const type=choice(q.type,['TEXT','NUMBER','CHOICE'],'question type');const o={key,label:text(q.label,'label',200),type,required:bool(q.required,'required')};
    if(type==='NUMBER')o.unit=text(q.unit,'unit',40);else if(q.unit!=null)fail(422,'INVALID_UNIT','Only number questions have units.');
    if(type==='CHOICE'){if(!Array.isArray(q.options)||q.options.length<2||q.options.length>20)fail(422,'OPTIONS','Supply 2 to 20 choices.');o.options=q.options.map(x=>text(x,'option',120));if(new Set(o.options).size!==o.options.length)fail(422,'OPTIONS','Options must be unique.');}
    else if(q.options!=null)fail(422,'OPTIONS','Only choice questions have options.');return o;});
}
export function validateAnswers(questions,answers) {
  object(answers);fields(answers,questions.map(q=>q.key));const out={};
  for(const q of questions){const v=answers[q.key];if(v===undefined||v===null||v===''){if(q.required)fail(422,'MISSING_ANSWER',`Answer ${q.key}.`);continue;}
    out[q.key]=q.type==='NUMBER'?decimal(v,q.key,6,true):q.type==='CHOICE'?choice(v,q.options,q.key):text(v,q.key,3000);}
  return out;
}
export function materialityTopics(items) {if(!Array.isArray(items)||!items.length||items.length>30)fail(422,'TOPIC_LIMIT','Supply 1 to 30 topics.');const seen=new Set();return items.map(t=>{fields(t,['code','label']);const c=code(t.code);if(seen.has(c))fail(422,'DUPLICATE_TOPIC','Topics must be unique.');seen.add(c);return {code:c,label:text(t.label,'label',200)};});}
export function validateScores(topics,scores) {if(!Array.isArray(scores)||scores.length!==topics.length)fail(422,'INCOMPLETE_SURVEY','Score every topic once.');const allowed=new Set(topics.map(t=>t.code)),seen=new Set();return scores.map(s=>{fields(s,['topic','impact','financial','rationale']);if(!allowed.has(s.topic)||seen.has(s.topic))fail(422,'INVALID_TOPIC','Unknown or repeated topic.');seen.add(s.topic);return {topic:s.topic,impact:integer(s.impact,1,5,'impact'),financial:integer(s.financial,1,5,'financial'),rationale:text(s.rationale,'rationale',1000,true)||''};});}
export function materialitySummary(assessment,responses) {
  const min=assessment.min_responses;if(responses.length<min)return {suppressed:true,responseCount:responses.length,minimumResponses:min,topics:[],method:'Exploratory unweighted mean of 1-5 stakeholder ratings; not a compliance determination.'};
  const topics=assessment.topics.map(t=>{let impact=0,financial=0;for(const r of responses){const s=r.scores.find(s=>s.topic===t.code);if(!s)throw Error('Incomplete stored materiality response');impact+=s.impact;financial+=s.financial;}
    const i=ratio(String(impact),String(responses.length),2),f=ratio(String(financial),String(responses.length),2);
    return {...t,impact:i,financial:f,impactFlag:impact/responses.length>=Number(assessment.impact_threshold),financialFlag:financial/responses.length>=Number(assessment.financial_threshold)};});
  const groups=STAKEHOLDERS.map(group=>{const n=responses.filter(r=>r.stakeholder_group===group).length;return n<min?{group,suppressed:true}:{group,responseCount:n,suppressed:false};});
  return {suppressed:false,responseCount:responses.length,topics,groups,method:'Unweighted arithmetic mean. Either threshold flags a topic for human review; this is not a statutory double-materiality assessment.',privacy:'No respondent IDs, free-text rationales or small-group counts are exposed.'};
}
export function csvParse(input,{maxRows=100,maxBytes=50000}={}) {
  if(typeof input!=='string'||Buffer.byteLength(input)>maxBytes||input.includes('\0'))fail(422,'CSV_LIMIT','CSV must be UTF-8 text, at most 50KB without NUL bytes.');
  if(input.charCodeAt(0)===0xfeff)input=input.slice(1);const rows=[];let row=[],field='',quoted=false,closed=false;
  const cell=()=>{row.push(field);field='';closed=false;};const end=()=>{cell();if(row.some(x=>x!==''))rows.push(row);row=[];if(rows.length>maxRows+1)fail(422,'CSV_ROWS','CSV contains too many records.');};
  for(let i=0;i<input.length;i++){const ch=input[i];if(quoted){if(ch==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=ch;continue;}
    if(closed&&!['\r','\n',','].includes(ch))fail(422,'CSV_SYNTAX','Unexpected character after a quoted CSV field.');
    if(ch==='"'){if(field||closed)fail(422,'CSV_SYNTAX','Quote inside an unquoted field.');quoted=true;}
    else if(ch===',')cell();else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&input[i+1]==='\n')i++;end();}else field+=ch;
  }
  if(quoted)fail(422,'CSV_SYNTAX','Unclosed quoted CSV field.');if(field||row.length||closed)end();if(rows.length<2)fail(422,'CSV_EMPTY','CSV requires a header and at least one data row.');
  const header=rows.shift();if(header.some(h=>!h.trim())||new Set(header).size!==header.length)fail(422,'CSV_HEADER','CSV headers must be nonempty and unique.');
  return rows.map((r,i)=>{if(r.length!==header.length)fail(422,'CSV_COLUMNS',`Row ${i+2} has an inconsistent number of columns.`);return Object.fromEntries(header.map((h,n)=>[h,r[n]]));});
}
export function csvCell(v) {let s=v==null?'':String(v);if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function csvWrite(header,rows){return '\ufeff'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export function htmlEscape(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function pcfInput(body){fields(body,['name','functionalUnit','outputQuantity','boundary','studyDate','bom']);if(!Array.isArray(body.bom)||body.bom.length<1||body.bom.length>100)fail(422,'BOM_LIMIT','Use 1 to 100 explicitly supplied BOM/process lines.');return {name:text(body.name,'name',200),functional_unit:text(body.functionalUnit,'functionalUnit',120),output_quantity:decimal(body.outputQuantity),boundary:reason(body.boundary),study_date:day(body.studyDate),bom:body.bom.map(b=>{fields(b,['name','stage','quantity','unit','factorId','allocationPercent']);const allocation=decimal(b.allocationPercent,'allocationPercent',4);if(scaled(allocation,4)>1000000n)fail(422,'ALLOCATION','Allocation percentage must be greater than zero and at most 100.');return {name:text(b.name,'name',200),stage:choice(b.stage,PCF_STAGES,'stage'),quantity:decimal(b.quantity),unit:text(b.unit,'unit',40),factorId:uuid(b.factorId),allocationPercent:allocation};})};}
export function calculatePcf(study,factors){const lines=study.bom.map(b=>{const f=factors.find(f=>f.id===b.factorId);if(!f||f.status!=='APPROVED'||f.method!=='ACTIVITY_BASED'||f.unit!==b.unit||study.study_date<f.valid_from||study.study_date>f.valid_to)fail(422,'PCF_FACTOR','PCF lines require approved physical-unit factors valid on the study date.');const kg=format(divideRounded(scaled(product(b.quantity,f.value))*scaled(b.allocationPercent,4),1000000n));return {...b,kgCo2e:kg,factor:{id:f.id,value:f.value,unit:f.unit,source:f.source,sourceUrl:f.source_url,version:f.version_label,boundary:f.boundary}};});const total=sum(lines.map(l=>l.kgCo2e));return {classification:'SCREENING_ONLY',inventoryIncluded:false,functionalUnit:study.functional_unit,totalKgCo2e:total,perFunctionalUnitKgCo2e:ratio(total,study.output_quantity),missingStages:PCF_STAGES.filter(s=>!lines.some(l=>l.stage===s)),lines,warning:'User-defined system boundary and allocation. No ISO 14067, LCA completeness, EPD or third-party assurance claim.'};}
