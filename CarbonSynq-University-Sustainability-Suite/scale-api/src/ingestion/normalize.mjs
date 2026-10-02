/** Deterministic normalization. Ambiguity is an error, never an invented measurement. */
import { fail, decimal, hash } from '../core.mjs';
import { fields, day } from '../university/core.mjs';
export const FIELDS=Object.freeze(['quantity','unit','intervalStart','intervalEnd','activityDate','campusCode','sourceCode','sourceId','taskId','kpiCode','category','factorId','fallbackFactorId','fallbackReason','dataQuality','assumptions','zeroReason','description','invoiceNumber','vendor','accountNumber','amountInr','lineRef','externalKey']);
export const LIMITS=Object.freeze({files:20,batchBytes:100*1024*1024,fileBytes:10*1024*1024,rowsPerFile:500,rowsPerBatch:1000,commitRows:100,sheets:10,pdfPages:30});
export const key=s=>String(s??'').normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const aliases={
 quantity:['quantity','qty','consumption','units consumed','energy consumed','consumption kwh','electricity kwh','fuel consumed','water consumption','value','actual consumption','consumed units','meter units'],
 unit:['unit','uom','units','unit of measure','measurement unit'],
 intervalStart:['period start','billing from','from date','start date','interval start','from','billing period start'],
 intervalEnd:['period end','billing to','to date','end date','interval end','to','billing period end'],
 activityDate:['date','activity date','reading date','consumption date'],
 campusCode:['campus','campus code','campus name','site','site code'],
 sourceCode:['source','source code','meter','meter code','asset code','meter id'],
 sourceId:['source id'],taskId:['task id'],kpiCode:['kpi','kpi code','indicator code'],
 category:['category','activity category','fuel type'],factorId:['factor id'],
 description:['description','particulars','notes'],invoiceNumber:['invoice','invoice no','invoice number','bill no','bill number'],
 vendor:['vendor','supplier','vendor name','supplier name'],accountNumber:['account number','account no','consumer number','consumer no'],
 amountInr:['amount','bill amount','total amount','amount inr','amount payable','total inr'],lineRef:['line ref','line id'],externalKey:['external key','source key']
};
const reverse=new Map(Object.entries(aliases).flatMap(([field,names])=>names.map(n=>[key(n),field])));
function issue(code,message,severity='ERROR',field=null){return {code,message,severity,...(field?{field}:{})};}
const unitSpecs=[
 ['kWh',['kwh','kw h','kilowatt hour','kilowatt hours'],'1'],['kWh',['mwh','megawatt hour','megawatt hours'],'1000'],
 ['litre',['l','ltr','ltrs','liter','liters','litre','litres'],'1'],['litre',['kl','kilolitre','kilolitres'],'1000'],
 ['kg',['kg','kgs','kilogram','kilograms'],'1'],['kg',['t','tonne','tonnes','metric ton'],'1000'],
 ['m3',['m3','m\u00b3','cubic meter','cubic metres'],'1'],
 ['passenger_km',['passenger km','passenger_km','pkm'],'1'],['vehicle_km',['vehicle km','vehicle_km','vkm'],'1'],
 ['item',['item','items'],'1'],['meal',['meal','meals'],'1'],['tonne_km',['tonne_km','tonne km','tkm'],'1'],['room_night',['room_night','room night','room nights'],'1'],['FTE',['fte'],'1'],['m2',['m2','m\u00b2','square metres'],'1'],['hour',['hour','hours','hr'],'1'],['count',['count','number','nos'],'1'],['percent',['percent','%'],'1'],['INR',['inr','rs'],'1']
];
export function normalizeUnit(raw){if(raw==null||String(raw).trim()==='')fail(422,'MISSING_UNIT','Select an explicit measurement unit.');const uk=v=>String(v).normalize('NFKC').trim().toLowerCase().replace(/[\s_]/g,'');const k=uk(raw);const found=unitSpecs.find(([,names])=>names.some(n=>uk(n)===k));if(!found)fail(422,'UNKNOWN_UNIT','Select a supported explicit unit; no unit is guessed from the currency amount.');return {unit:found[0],multiplier:found[2],original:String(raw)};}
export function normalizeNumber(raw,locale='IN_EN',places=6){
 if(raw===null||raw===undefined||String(raw).trim()==='')fail(422,'MISSING_QUANTITY','Blank values are missing, not zero.');
 let s=String(raw).normalize('NFKC').trim().replace(/[\u00a0\u202f]/g,' ');
 if(/[\s]/.test(s)||/[eE]/.test(s)||/[+%\u20b9$=]/.test(s))fail(422,'NUMBER_FORMAT','Use a plain decimal with an explicit grouping convention, not currency, formulas, scientific notation or percentages.');
 if(locale==='DECIMAL_COMMA'){
  if(!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(s))fail(422,'NUMBER_FORMAT','Expected decimal comma and optional dot grouping.');
  s=s.replaceAll('.','').replace(',','.');
 }else{
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(s))fail(422,'NUMBER_FORMAT','Expected English/Indian grouping, such as 12,500.5 or 1,25,000.');
  s=s.replaceAll(',','');
 }
 if(s.startsWith('-'))fail(422,'NEGATIVE_QUANTITY','Negative values require a separate reviewed correction, not a negative upload.');
 // Leading zeroes are normalized, decimal precision is never silently rounded.
 s=s.replace(/^0+(?=\d)/,'');return decimal(s,'quantity',places,true);
}
export function normalizeDate(raw,order='AUTO'){
 const s=String(raw??'').trim();if(!s)fail(422,'MISSING_DATE','Enter the measurement date or billing interval.');
 if(/^\d{4}-\d{2}-\d{2}$/.test(s))return day(s);
 const m=/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
 if(!m)fail(422,'DATE_FORMAT','Use ISO YYYY-MM-DD or a declared DMY/MDY date. Unformatted Excel serial dates are not guessed.');
 let a=Number(m[1]),b=Number(m[2]),y=m[3];
 if(order==='AUTO'){
  if(a<=12&&b<=12&&a!==b)fail(422,'AMBIGUOUS_DATE','Choose DMY or MDY for this file; both date interpretations are possible.');
  order=a>12?'DMY':'MDY';
 }
 const month=order==='DMY'?b:a,dayPart=order==='DMY'?a:b;
 return day(`${y}-${String(month).padStart(2,'0')}-${String(dayPart).padStart(2,'0')}`);
}
function multiply(q,factor){if(factor==='1')return q;const [a,b='']=q.split('.');const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));const v=n*BigInt(factor);return `${v/1000000n}.${String(v%1000000n).padStart(6,'0')}`;}
export function normalizeValues(values,options={}){
 const normalized={},issues=[];const run=(field,fn)=>{try{normalized[field]=fn();}catch(e){issues.push(issue(e.code||'INVALID_VALUE',e.message,'ERROR',field));}};
 for(const [field,v] of Object.entries(values))if(FIELDS.includes(field)&&v!=null)normalized[field]=String(v).normalize('NFKC').trim();
 let rawQty=values.quantity,rawUnit=values.unit;
 if(typeof rawQty==='string'){
  const combined=/^\s*([\d.,]+)\s+([A-Za-z_\u00b2\u00b3]+(?:\s+[A-Za-z]+)?)\s*$/.exec(rawQty);
  if(combined){rawQty=combined[1];if(rawUnit&&key(rawUnit)!==key(combined[2]))issues.push(issue('UNIT_CONFLICT','Quantity suffix and unit column disagree.','ERROR','unit'));else {rawUnit=combined[2];issues.push(issue('UNIT_FROM_SUFFIX','Explicit unit suffix separated from quantity.','WARNING','unit'));}}
 }
 run('quantity',()=>normalizeNumber(rawQty,options.numberFormat||'IN_EN'));
 let unit;
 try{unit=normalizeUnit(rawUnit);normalized.unit=unit.unit;}catch(e){issues.push(issue(e.code,e.message,'ERROR','unit'));}
 if(unit&&normalized.quantity!==undefined&&!issues.some(i=>i.field==='quantity'&&i.severity==='ERROR')){
  normalized.quantity=multiply(normalized.quantity,unit.multiplier);
  if(unit.multiplier!=='1')issues.push(issue('UNIT_CONVERTED',`${String(rawUnit)} converted to ${unit.unit} using multiplier ${unit.multiplier}.`,'WARNING','unit'));
 }
 if(values.activityDate)run('activityDate',()=>normalizeDate(values.activityDate,options.dateOrder));
 const from=values.intervalStart||values.activityDate,to=values.intervalEnd||values.activityDate;
 run('intervalStart',()=>normalizeDate(from,options.dateOrder));run('intervalEnd',()=>normalizeDate(to,options.dateOrder));
 if(normalized.intervalStart&&normalized.intervalEnd&&normalized.intervalStart>normalized.intervalEnd)issues.push(issue('DATE_RANGE','Start date must not follow end date.'));
 if(values.amountInr!==undefined&&String(values.amountInr).trim()!=='')run('amountInr',()=>normalizeNumber(String(values.amountInr).replace(/^(?:INR|Rs\.?|\u20b9)\s*/i,''),options.numberFormat||'IN_EN',2));
 normalized.dataQuality=normalized.dataQuality||'MEASURED';
 if(!['MEASURED','ESTIMATED'].includes(normalized.dataQuality))issues.push(issue('DATA_QUALITY','Choose MEASURED or ESTIMATED.'));
 return {normalized,issues};
}
const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
export function monthRange(value){let y,m;const s=String(value??'').trim();let match=/^(\d{4})[-/](\d{2})$/.exec(s);if(match){y=+match[1];m=+match[2];}else{match=/^([A-Za-z]{3})[\s\-/]+(\d{4})$/.exec(s);if(!match)return null;m=months[match[1].toLowerCase()];y=+match[2];}
 if(!m||m>12||y<1900||y>2200)return null;return {intervalStart:`${y}-${String(m).padStart(2,'0')}-01`,intervalEnd:`${y}-${String(m).padStart(2,'0')}-${new Date(Date.UTC(y,m,0)).getUTCDate()}`};}
function headerInfo(row){const mapping={},ambiguous=[],monthColumns=[];for(const c of row.cells){const field=reverse.get(key(c.value));if(field){if(mapping[field])ambiguous.push(field);else mapping[field]=c.column;}if(monthRange(c.value))monthColumns.push({column:c.column,label:c.value,...monthRange(c.value)});}for(const f of ambiguous)delete mapping[f];return {mapping,ambiguous,monthColumns,score:Object.keys(mapping).length+Math.min(monthColumns.length,4)};}
export function suggestSheet(sheet){const ranked=sheet.rows.filter(r=>r.index<=50&&!r.hidden).map(row=>({row,...headerInfo(row)})).sort((a,b)=>b.score-a.score||a.row.index-b.row.index);const pick=ranked[0];if(!pick||pick.score<2)return {sheet:sheet.name,headerRow:null,mapping:{},monthColumns:[],warnings:['No reliable header row found. Select the actual header row and map columns.']};return {sheet:sheet.name,headerRow:pick.row.index,mapping:pick.mapping,monthColumns:pick.monthColumns,warnings:pick.ambiguous.length?['Ambiguous header aliases: '+pick.ambiguous.join(', ')]:[]};}
export function validatePlan(plan,kind='SPREADSHEET'){
 fields(plan,['sheet','headerRow','mapping','defaults','dateOrder','numberFormat','includeHidden','forwardFill','monthColumns','groups','quantityMeaningConfirmed']);
 for(const name of ['forwardFill','monthColumns','groups'])if(plan[name]!==undefined&&!Array.isArray(plan[name]))fail(422,'PLAN_TYPE',name+' must be an array.');
 if(plan.includeHidden!==undefined&&typeof plan.includeHidden!=='boolean')fail(422,'PLAN_TYPE','includeHidden must be boolean.');
 for(const value of Object.values(plan.defaults||{}))if(value!==null&&typeof value!=='string'&&typeof value!=='number')fail(422,'PLAN_TYPE','Defaults must be scalar text or numbers.');
 if(!['AUTO','DMY','MDY'].includes(plan.dateOrder||'AUTO'))fail(422,'DATE_ORDER','Choose AUTO, DMY or MDY.');
 if(!['IN_EN','DECIMAL_COMMA'].includes(plan.numberFormat||'IN_EN'))fail(422,'NUMBER_LOCALE','Choose IN_EN or DECIMAL_COMMA.');
 fields(plan.defaults||{},FIELDS);for(const v of Object.values(plan.defaults||{}))if(v!=null&&String(v).length>2000)fail(422,'FIELD_LIMIT','A default is too long.');
 if(kind==='SPREADSHEET'){
  if(typeof plan.sheet!=='string'||plan.sheet.length>200)fail(422,'SHEET_REQUIRED','Select a sheet.');
  if(!Number.isInteger(plan.headerRow)||plan.headerRow<1||plan.headerRow>2000)fail(422,'HEADER_REQUIRED','Choose a valid 1-based header row.');
  fields(plan.mapping||{},FIELDS);
  if(Object.values(plan.mapping||{}).some(v=>!(/^[A-Z]{1,2}$/.test(v))))fail(422,'COLUMN','Map fields to Excel column letters, such as A or G.');
  if(new Set(Object.values(plan.mapping||{})).size!==Object.values(plan.mapping||{}).length)fail(422,'REUSED_COLUMN','Do not map one column to multiple meanings.');
  if((plan.forwardFill||[]).some(f=>!['campusCode','sourceCode','sourceId','unit','kpiCode','category','description'].includes(f)))fail(422,'UNSAFE_FILL','Forward-fill only explicit identifier/context fields, never amounts, consumption or dates.');
  if((plan.monthColumns||[]).length>24)fail(422,'MONTH_LIMIT','At most 24 monthly columns per sheet.');
  if((plan.monthColumns||[]).length&&(plan.mapping?.quantity||plan.mapping?.intervalStart||plan.mapping?.intervalEnd||plan.mapping?.activityDate))fail(422,'WIDE_MAPPING','Wide monthly data uses month columns for quantity and interval; remove the long-form quantity/date mapping.');
  for(const col of plan.monthColumns||[]){fields(col,['column','intervalStart','intervalEnd']);if(!/^[A-Z]{1,2}$/.test(col.column))fail(422,'COLUMN','Invalid month column.');day(col.intervalStart);day(col.intervalEnd);if(col.intervalStart>col.intervalEnd)fail(422,'DATE_RANGE','Invalid month range.');}
 }
 if(plan.groups){if(!Array.isArray(plan.groups)||plan.groups.length>100)fail(422,'GROUP_LIMIT','At most 100 reviewed invoice groups.');for(const g of plan.groups){fields(g,['pageStart','pageEnd','defaults']);if(!Number.isInteger(g.pageStart)||!Number.isInteger(g.pageEnd)||g.pageStart<1||g.pageEnd<g.pageStart||g.pageEnd>30)fail(422,'PAGE_RANGE','Use 1-based page ranges within 30 pages.');fields(g.defaults||{},FIELDS);}}
 return structuredClone(plan);
}
export function workbookRows(extraction,plan){validatePlan(plan);const sheet=extraction.sheets?.find(s=>s.name===plan.sheet);if(!sheet)fail(422,'SHEET_NOT_FOUND','The selected sheet is not present.');if(sheet.hidden&&!plan.includeHidden)fail(422,'HIDDEN_SHEET','Explicitly include hidden content or choose a visible sheet.');
 const header=sheet.rows.find(r=>r.index===plan.headerRow);if(!header)fail(422,'HEADER_REQUIRED','The selected header row is empty.');
 const headerValues=new Map(header.cells.map(c=>[c.column,key(c.value)])),all=new Map(sheet.rows.flatMap(r=>r.cells.map(c=>[c.address,c]))),carry={},output=[];
 const mapping=plan.mapping||{};
 for(const row of sheet.rows.filter(r=>r.index>plan.headerRow)){
  const cells=new Map(row.cells.map(c=>[c.column,c])),issues=[],raw={...plan.defaults},loc={sheet:sheet.name,row:row.index,columns:{}};
  let skip=row.hidden&&!plan.includeHidden?'HIDDEN_ROW':null;
  const first=row.cells.find(c=>c.value!=null&&String(c.value).trim()!=='');
  if(first&&/^(grand\s*total|sub\s*total|total|opening\s*balance|closing\s*balance)\s*:?\s*$/i.test(String(first.value).trim()))skip='SUMMARY_ROW';
  const matches=row.cells.filter(c=>headerValues.get(c.column)&&key(c.value)===headerValues.get(c.column));
  if(matches.length>=2)skip='REPEATED_HEADER';
  for(const [field,col] of Object.entries(mapping)){
   let cell=cells.get(col),v=cell?.value;loc.columns[field]=col+row.index;
   if(cell?.type==='formula')issues.push(issue('FORMULA_NOT_EVALUATED','Formula preserved; enter a reviewed numeric value instead of relying on a cached result.','ERROR',field));
   if(cell?.type==='error')issues.push(issue('EXCEL_ERROR','The source cell contains an Excel error.','ERROR',field));
   if(cell?.mergedFrom){if(['campusCode','sourceCode','sourceId','unit','category','kpiCode','description'].includes(field)){v=all.get(cell.mergedFrom)?.value;issues.push(issue('MERGED_CONTEXT','Identifier/context taken from merged anchor '+cell.mergedFrom+'.','WARNING',field));}else issues.push(issue('MERGED_VALUE','Merged measurement/date cells require explicit review.','ERROR',field));}
   if((v==null||String(v).trim()==='')&&(plan.forwardFill||[]).includes(field)&&carry[field]!=null){v=carry[field];issues.push(issue('FORWARD_FILLED','Context explicitly forward-filled from a previous row.','WARNING',field));}
   if(v!=null&&String(v).trim()!==''){carry[field]=v;raw[field]=v;}else if(!(field in raw))raw[field]='';
  }
  const rows=(plan.monthColumns||[]).length?plan.monthColumns.map(m=>{const c=cells.get(m.column);return {raw:{...raw,quantity:c?.value??'',intervalStart:m.intervalStart,intervalEnd:m.intervalEnd},loc:{...loc,valueColumn:m.column},extra:c?.type==='formula'?[issue('FORMULA_NOT_EVALUATED','Monthly formula must be replaced with a reviewed value.','ERROR','quantity')]:[]};}):[{raw,loc,extra:[]}];
  for(const candidate of rows){const n=normalizeValues(candidate.raw,plan);output.push({source_ref:candidate.loc,raw_values:candidate.raw,normalized:n.normalized,issues:[...issues,...candidate.extra,...n.issues],skipReason:skip});if(output.length>LIMITS.rowsPerFile)fail(422,'NORMALIZED_ROW_LIMIT','More than 500 normalized rows. Split the selected data table.');}
 }
 return output;
}
function invoiceFields(text){
 const fields={};
 // Preserve original decimal text; no floating-point coercion or invoice-date inference.
 const quantities=[...text.matchAll(/(?:units consumed|energy consumed|consumption|fuel quantity|quantity)\s*[:=\-]?\s*([\d.,]+)\s*(kwh|mwh|litres?|liters?|ltr|kg|m3|m\u00b3)\b/gi)];
 if(quantities.length===1){fields.quantity=quantities[0][1];fields.unit=quantities[0][2];}
 const amounts=[...text.matchAll(/(?:total amount|amount payable|grand total|bill amount)\s*[:=]?\s*(?:INR|Rs\.?|\u20b9)?\s*([\d.,]+)/gi)];
 if(amounts.length===1)fields.amountInr=amounts[0][1];
 const find=re=>re.exec(text)?.[1]?.trim();
 fields.invoiceNumber=find(/(?:invoice\s*(?:number|no\.?|#)|bill\s*(?:number|no\.?|#))\s*[:=]?\s*([A-Za-z0-9][A-Za-z0-9_./-]{0,100})/i)||fields.invoiceNumber;
 fields.vendor=find(/(?:vendor|supplier)(?:\s+name)?\s*[:=]\s*([^\r\n]+)/i)||fields.vendor;
 fields.accountNumber=find(/(?:account|consumer|meter)\s*(?:number|no\.?|id)\s*[:=]?\s*([^\r\n]+)/i);
 fields.intervalStart=find(/(?:period\s*start|billing\s*from|from\s*date)\s*[:=]\s*([0-9./-]+)/i);
 fields.intervalEnd=find(/(?:period\s*end|billing\s*to|to\s*date)\s*[:=]\s*([0-9./-]+)/i);
 // Invoice issuance date is never silently used as the consumption interval.
 return Object.fromEntries(Object.entries(fields).filter(([k,v])=>FIELDS.includes(k)&&v!=null));
}
export function suggestGroups(extraction){const pages=extraction.pages||[];if(!pages.length)return [{pageStart:1,pageEnd:1,defaults:{}}];const groups=[];for(const p of pages){const fields=invoiceFields(p.text),prior=groups.at(-1);if(prior&&(!fields.invoiceNumber||fields.invoiceNumber===prior.invoiceNumber))prior.pageEnd=p.page;else groups.push({pageStart:p.page,pageEnd:p.page,invoiceNumber:fields.invoiceNumber||null});}return groups.map(({invoiceNumber,...g})=>({...g,defaults:{}}));}
export function invoiceRows(extraction,plan){validatePlan(plan,'INVOICE');const groups=plan.groups||suggestGroups(extraction),pages=extraction.pages||[],output=[];
 for(const [i,g] of groups.entries()){
  if(extraction.pageCount&&g.pageEnd>extraction.pageCount)fail(422,'PAGE_RANGE','A group exceeds the original PDF page count.');
  const selected=pages.filter(p=>p.page>=g.pageStart&&p.page<=g.pageEnd),text=selected.map(p=>p.text).join('\n');
  const raw={...invoiceFields(text),...plan.defaults,...g.defaults};
  raw.lineRef=raw.lineRef||'1';
  const normalized=normalizeValues(raw,plan),issues=[...normalized.issues,issue('VERIFY_ORIGINAL','Review the original pages; field suggestions are not verification.','WARNING')];
  if(!text.trim())issues.push(issue('MANUAL_EXTRACTION','No usable text layer. Enter actual fields manually; OCR is not configured.','WARNING'));
  const ids=[...text.matchAll(/(?:invoice\s*(?:number|no\.?|#)|bill\s*(?:number|no\.?|#))\s*[:=]?\s*([A-Za-z0-9][A-Za-z0-9_./-]{0,100})/gi)].map(m=>key(m[1]));
  if(new Set(ids).size>1)issues.push(issue('MULTIPLE_INVOICES','This group contains multiple invoice identifiers. Split its page range or explicitly correct the row.','ERROR','invoiceNumber'));
  output.push({source_ref:{pageStart:g.pageStart,pageEnd:g.pageEnd,group:i+1},raw_values:raw,normalized:normalized.normalized,issues,skipReason:null});
 }
 return output;
}
export function normalizedKey(target,n){
 const part=target==='KPI'?'KPI':'INVENTORY';
 if(n.invoiceNumber&&n.vendor)return hash(JSON.stringify([part,'INVOICE',key(n.vendor),key(n.invoiceNumber),key(n.accountNumber),key(n.lineRef||'1')]));
 return hash(JSON.stringify([part,'MEASUREMENT',n.sourceId||key(n.sourceCode),n.taskId||key(n.kpiCode),key(n.campusCode),n.intervalStart,n.intervalEnd,n.quantity,n.unit,n.category||'']));
}
export function rowWarnings(){return issue('CONSUMPTION_CONFIRMATION','Confirm that quantity is actual consumption, not purchased stock, an invoice amount or a meter cumulative reading.','WARNING');}
export function safeCsvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
