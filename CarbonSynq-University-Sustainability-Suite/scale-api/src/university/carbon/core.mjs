/** Scope 1/2 validation and deterministic decimal-string arithmetic.
 * Source facts, factor versions and quantities are reviewed; this module never invents factors.
 */
import { fields,choice,integer,bool,code,reason,evidenceIds,dateRange,https,scaled,format,divideRounded,sum,ratio,fail,text,uuid,day,decimal } from '../core.mjs';
import { SOURCE_KINDS,FACILITY_TYPES,FACTOR_USES,QUALITY_CRITERIA,CHECKLIST } from './catalog.mjs';
export const ZERO='0.000000';
export function region(v){return text(v,'region',120).toUpperCase();}
export function boundedArray(v,min,max,name){if(!Array.isArray(v)||v.length<min||v.length>max)fail(422,'ARRAY_SIZE',`${name} requires ${min} to ${max} items.`);return v;}
export function unique(v,name){if(new Set(v).size!==v.length)fail(422,'DUPLICATE_ITEM',`${name} must not repeat.`);return v;}
export function sourceInput(b){
 fields(b,['campusId','buildingId','departmentId','ownerId','code','name','kind','substance','unit','region','facilityType','activeFrom','activeTo','description']);
 const spec=SOURCE_KINDS[b.kind];if(!spec)fail(422,'SOURCE_KIND','Select a supported Scope 1/2 source kind.');
 const [from,to]=dateRange(b.activeFrom,b.activeTo||'2100-12-31');const substance=code(b.substance);
 if(spec.commodity&&substance!==spec.commodity)fail(422,'COMMODITY_MISMATCH','Purchased-energy source must match its commodity.');
 return {campus_id:uuid(b.campusId),building_id:b.buildingId?uuid(b.buildingId):null,department_id:b.departmentId?uuid(b.departmentId):null,
  owner_id:uuid(b.ownerId),code:code(b.code),name:text(b.name,'name',180),kind:b.kind,scope:spec.scope,substance,unit:choice(b.unit,spec.units,'unit'),region:region(b.region),facility_type:choice(b.facilityType,FACILITY_TYPES,'facilityType'),active_from:from,active_to:to,description:reason(b.description)};
}
export function factorInput(b){
 fields(b,['name','kind','substance','unit','use','components','gwpBasis','source','sourceUrl','region','boundary','versionLabel','validFrom','validTo','zeroReason']);
 const spec=SOURCE_KINDS[b.kind];if(!spec)fail(422,'SOURCE_KIND','Unsupported factor source kind.');
 const use=choice(b.use,FACTOR_USES,'factor use');if((spec.scope==='SCOPE_1')!==(use==='DIRECT'))fail(422,'FACTOR_USE','Direct factors apply only to Scope 1; energy factors require an explicit Scope 2 method.');
 const parts=boundedArray(b.components,1,12,'components').map(c=>{
  fields(c,['gas','massPerUnit','gwp']);const gas=code(c.gas),massPerUnit=decimal(c.massPerUnit,'massPerUnit',9,true),gwp=decimal(c.gwp,'gwp',9);
  if(['CO2','CO2_BIOGENIC','CO2E'].includes(gas)&&gwp!=='1.000000000')fail(422,'CO2_GWP','CO2, biogenic CO2 and pre-aggregated CO2e use multiplier 1.');
  return {gas,massPerUnit,gwp};
 });unique(parts.map(c=>c.gas),'gas components');
 if(parts.some(c=>c.gas==='CO2E')&&parts.length!==1)fail(422,'DOUBLE_FACTOR','Do not add gas components to an already-aggregated CO2e factor.');
 if(spec.scope==='SCOPE_2'&&(parts.length!==1||parts[0].gas!=='CO2E'))fail(422,'ENERGY_FACTOR','Scope 2 requires one documented generation-only CO2e factor, excluding upstream fuel/T&D.');
 if(['STATIONARY_COMBUSTION','MOBILE_COMBUSTION'].includes(b.kind)&&!parts.some(c=>c.gas==='CO2E')){const gasSet=new Set(parts.map(c=>c.gas));if(!(gasSet.has('CO2')||gasSet.has('CO2_BIOGENIC'))||!gasSet.has('CH4')||!gasSet.has('N2O'))fail(422,'COMBUSTION_GAS_COVERAGE','Combustion factors need CO2 (fossil and/or biogenic), CH4 and N2O, or one documented all-gas CO2e factor.');}
 const substance=code(b.substance);if(spec.commodity&&substance!==spec.commodity)fail(422,'COMMODITY_MISMATCH','Factor commodity must match its energy kind.');
 if(['REFRIGERANT','DIRECT_GAS'].includes(b.kind)&&(parts.length!==1||parts[0].gas!==substance||parts[0].massPerUnit!=='1.000000000'))fail(422,'GAS_FACTOR','Gas-release quantities are kg of the named gas: use that gas, massPerUnit=1 and its reviewed GWP.');
 const zero=parts.every(c=>scaled(c.massPerUnit,9)===0n);const [from,to]=dateRange(b.validFrom,b.validTo);
 return {name:text(b.name,'name',180),kind:b.kind,substance,unit:choice(b.unit,spec.units,'unit'),use,components:parts,gwp_basis:reason(b.gwpBasis),source:text(b.source,'source',1500),source_url:https(b.sourceUrl),region:region(b.region),boundary:reason(b.boundary),version_label:text(b.versionLabel,'versionLabel',80),valid_from:from,valid_to:to,zero_reason:zero?reason(b.zeroReason):(text(b.zeroReason,'zeroReason',2000,true)||null)};
}
export function calculateGas(quantity,factor){
 const q=scaled(decimal(quantity,'quantity',6,true));let total=0n,bio=0n;
 const gases=factor.components.map(c=>{const mass=q*scaled(c.massPerUnit,9),massKg=format(divideRounded(mass,1000000000n)),co2e=divideRounded(mass*scaled(c.gwp,9),1000000000000000000n);
  if(c.gas==='CO2_BIOGENIC')bio+=divideRounded(mass,1000000000n);else total+=co2e;
  return {...c,massKg,kgCo2e:c.gas==='CO2_BIOGENIC'?null:format(co2e),separateBiogenicDisclosure:c.gas==='CO2_BIOGENIC'};});
 return {kgCo2e:format(total),biogenicCo2Kg:format(bio),gases,gasBreakdownAvailable:!gases.some(c=>c.gas==='CO2E'),formula:'sum(quantity x kg gas/unit x 100-year GWP); biogenic CO2 disclosed separately',rounding:'BigInt exact products; each gas rounded half-up to 6 decimal kg CO2e, then summed'};
}
function nonnegative(n,name){if(n<0n)fail(422,'NEGATIVE_BALANCE',`${name} is negative. Reconcile the original records; values are not clipped to zero.`);return format(n);}
function quantities(b,names){return names.map(k=>scaled(decimal(b[k],k,6,true)));}
export function quantityPreview(b){
 if(b.mode==='DIRECT'){fields(b,['mode','quantity','unit']);return {quantity:decimal(b.quantity,'quantity',6,true),unit:text(b.unit,'unit',30),method:'Direct measured/reviewed consumption or release'};}
 if(b.mode==='FUEL_STOCK'){fields(b,['mode','unit','opening','received','transfersIn','closing','transfersOut']);const [o,r,i,c,out]=quantities(b,['opening','received','transfersIn','closing','transfersOut']);return {quantity:nonnegative(o+r+i-c-out,'Fuel consumed'),unit:choice(b.unit,['litre','kg','m3'],'stock unit'),method:'opening + received + transfers in - closing - transfers out',warning:'Use one coherent stock boundary. Transfers within that boundary cancel; purchases alone are not consumption.'};}
 if(b.mode==='METER'){fields(b,['mode','unit','opening','closing','multiplier','rolloverAt']);const [o,c]=quantities(b,['opening','closing']);const mult=scaled(decimal(b.multiplier,'multiplier'));let delta=c-o;
  if(b.rolloverAt!=null){const maximum=scaled(decimal(b.rolloverAt,'rolloverAt'));if(o>=maximum||c>=maximum||c>=o)fail(422,'METER_ROLLOVER','One rollover requires closing < opening and both readings below the exclusive rollover value.');delta=maximum-o+c;}
  if(delta<0n)fail(422,'METER_RESET','Negative meter movement. Enter a documented rollover, or split a replaced/reset meter into separate reading intervals.');
  return {quantity:format(divideRounded(delta*mult,1000000n)),unit:choice(b.unit,['kWh','litre','kg','m3','GJ'],'meter unit'),method:'(closing - opening + documented single rollover, if any) x multiplier',warning:'Use a gross import register for purchased electricity. Net meters cannot establish gross imports without separate evidence.'};}
 if(b.mode==='REFRIGERANT_BALANCE'){fields(b,['mode','openingEquipmentKg','openingStockKg','acquiredKg','closingEquipmentKg','closingStockKg','transferredOutKg']);const [oe,os,a,ce,cs,out]=quantities(b,['openingEquipmentKg','openingStockKg','acquiredKg','closingEquipmentKg','closingStockKg','transferredOutKg']);return {quantity:nonnegative(oe+os+a-ce-cs-out,'Refrigerant released'),unit:'kg',method:'opening equipment + opening stock + acquired - closing equipment - closing stock - transferred out',warning:'Include gas acquired/disposed in equipment. Recovered gas belongs in closing stock or transfers out, never both. Boundary and inventory records require review.'};}
 if(b.mode==='SERVICE_TOPUP'){fields(b,['mode','lossReplacementKg','replacesLeakOnly','notes']);if(b.replacesLeakOnly!==true)fail(422,'LEAK_ATTESTATION','Top-up method is limited to documented replacement of leaked gas, not initial charging or every refrigerant purchase.');return {quantity:decimal(b.lossReplacementKg,'lossReplacementKg',6,true),unit:'kg',method:'Documented replacement of leaked refrigerant only',notes:reason(b.notes)};}
 if(b.mode==='ENERGY_CONVERSION'){fields(b,['mode','quantity','unit']);const q=scaled(decimal(b.quantity,'quantity',6,true)),unit=choice(b.unit,['MWh','GJ','kWh'],'energy unit');return {quantity:format(unit==='MWh'?q*1000n:unit==='GJ'?divideRounded(q*2500n,9n):q),unit:'kWh',method:unit==='GJ'?'1 GJ = 2500/9 kWh':'MWh x 1000, or unchanged kWh',warning:'This converts delivered energy, not steam mass, fuel volume, currency or avoided generation.'};}
 if(b.mode==='ELECTRICITY_BALANCE'){fields(b,['mode','grossImportsKwh','onsiteGenerationKwh','exportsKwh']);const [i,g,e]=quantities(b,['grossImportsKwh','onsiteGenerationKwh','exportsKwh']);return {quantity:format(i),unit:'kWh',campusUseKwh:nonnegative(i+g-e,'Campus electricity use'),method:'Scope 2 quantity = gross acquired electricity; energy balance = imports + generation - exports',warning:'Exports and owned generation never subtract from gross-import emissions. Generation attributes, direct PPAs and replacement claims require separate review; this balance grants no renewable claim.'};}
 fail(422,'QUANTITY_MODE','Unsupported quantity method.');
}
export function normalizedQuantity(b,source){const p=quantityPreview(b);if(p.unit!==source.unit)fail(422,'UNIT_MISMATCH','Derived quantity unit must match the registered source.');
 if(b.mode==='FUEL_STOCK'&&!['STATIONARY_COMBUSTION','MOBILE_COMBUSTION'].includes(source.kind))fail(422,'QUANTITY_MODE','Fuel stocks are only for combustion sources.');
 if(['REFRIGERANT_BALANCE','SERVICE_TOPUP'].includes(b.mode)&&source.kind!=='REFRIGERANT')fail(422,'QUANTITY_MODE','Refrigerant methods are limited to refrigerant sources.');
 if(b.mode==='ELECTRICITY_BALANCE'&&source.kind!=='PURCHASED_ELECTRICITY')fail(422,'QUANTITY_MODE','Electricity balance is only for purchased electricity.');return p;}
export function recordInput(b){
 fields(b,['periodId','sourceId','intervalStart','intervalEnd','externalKey','description','quantityInput','factorId','marketAllocations','fallbackFactorId','fallbackReason','evidenceIds','dataQuality','assumptions','zeroReason','replacesId']);const [from,to]=dateRange(b.intervalStart,b.intervalEnd);
 const allocations=boundedArray(b.marketAllocations||[],0,20,'marketAllocations').map(a=>{fields(a,['instrumentId','quantityKwh']);return {instrumentId:uuid(a.instrumentId),quantityKwh:decimal(a.quantityKwh,'quantityKwh')};});unique(allocations.map(a=>a.instrumentId),'instruments');
 const dataQuality=choice(b.dataQuality,['MEASURED','ESTIMATED'],'dataQuality');return {period_id:uuid(b.periodId),source_id:uuid(b.sourceId),interval_start:from,interval_end:to,external_key:text(b.externalKey,'externalKey',160),description:reason(b.description),quantity_input:b.quantityInput,factor_id:uuid(b.factorId),market_allocations:allocations,fallback_factor_id:b.fallbackFactorId?uuid(b.fallbackFactorId):null,fallback_reason:text(b.fallbackReason,'fallbackReason',2000,true),evidence_ids:evidenceIds(b.evidenceIds),data_quality:dataQuality,assumptions:dataQuality==='ESTIMATED'?reason(b.assumptions):(text(b.assumptions,'assumptions',2000,true)||''),zero_reason:text(b.zeroReason,'zeroReason',2000,true),replaces_id:b.replacesId?uuid(b.replacesId):null};
}
export function checkFactor(record,source,factor,uses){
 if(factor.status!=='APPROVED'||!uses.includes(factor.use)||factor.kind!==source.kind||factor.substance!==source.substance||factor.unit!==source.unit||factor.valid_from>record.interval_start||factor.valid_to<record.interval_end)fail(422,'FACTOR_MISMATCH','Use an approved factor matching source kind, substance, unit, method and the entire consumption interval. Split intervals at factor changes.');
 if(factor.region!==source.region&&!(source.scope==='SCOPE_1'&&factor.region==='GLOBAL'))fail(422,'FACTOR_REGION','Factor geography must match the source region; only direct gas/fuel factors may use a reviewed GLOBAL geography.');
}
export function calculateMarket(quantity,parts,fallback){const q=scaled(quantity),used=parts.reduce((n,p)=>n+scaled(p.quantityKwh),0n);if(used>q)fail(422,'OVERALLOCATED_LOAD','Instrument quantities exceed consumption.');const remaining=format(q-used);
 if(q>used&&!fallback)fail(422,'UNCOVERED_MARKET_LOAD','Unmatched energy needs an approved residual-mix or explicitly justified grid-fallback factor.');
 const lines=parts.map(p=>({...p,kgCo2e:calculateGas(p.quantityKwh,p.factor).kgCo2e}));const residual=fallback?calculateGas(remaining,fallback).kgCo2e:ZERO;
 return {kgCo2e:sum([...lines.map(l=>l.kgCo2e),residual]),matchedKwh:format(used),unmatchedKwh:remaining,residualKgCo2e:residual,lines,fallbackFactorId:fallback?.id||null,fallbackFactor:fallback||null};
}
export function boundaryInput(b){fields(b,['periodId','campusIds','campusExclusions','approach','statement','baseYear','recalculationPolicy','scope2Mode','scope2Rationale','sources','screening','evidenceIds']);
 const campusIds=unique(boundedArray(b.campusIds,1,200,'campusIds').map(x=>uuid(x)),'campuses');const exclusions=boundedArray(b.campusExclusions||[],0,200,'campusExclusions').map(x=>{fields(x,['campusId','rationale']);return {campusId:uuid(x.campusId),rationale:reason(x.rationale)};});unique(exclusions.map(x=>x.campusId),'excluded campuses');if(exclusions.some(x=>campusIds.includes(x.campusId)))fail(422,'BOUNDARY_CONFLICT','A campus cannot be both included and excluded.');
 const sources=boundedArray(b.sources,0,200,'sources').map(x=>{fields(x,['sourceId','decision','rationale','frequency','evidenceIds']);return {sourceId:uuid(x.sourceId),decision:choice(x.decision,['INCLUDED','EXCLUDED','NO_ACTIVITY'],'decision'),rationale:reason(x.rationale),frequency:choice(x.frequency,['MONTHLY','ANNUAL'],'frequency'),evidenceIds:evidenceIds(x.evidenceIds)};});unique(sources.map(x=>x.sourceId),'sources');
 const screening=boundedArray(b.screening,1,1600,'screening').map(x=>{fields(x,['campusId','code','decision','rationale']);return {campusId:uuid(x.campusId),code:choice(x.code,CHECKLIST.map(c=>c.code),'screening code'),decision:choice(x.decision,['PRESENT','NOT_APPLICABLE'],'screening decision'),rationale:reason(x.rationale)};});unique(screening.map(x=>x.campusId+':'+x.code),'screening rows');
 return {period_id:uuid(b.periodId),campus_ids:campusIds,campus_exclusions:exclusions,approach:choice(b.approach,['OPERATIONAL_CONTROL','FINANCIAL_CONTROL'],'consolidation approach'),statement:reason(b.statement),base_year:integer(b.baseYear,1990,2100,'baseYear'),recalculation_policy:reason(b.recalculationPolicy),scope2_mode:choice(b.scope2Mode,['DUAL','LOCATION_ONLY'],'scope2Mode'),scope2_rationale:reason(b.scope2Rationale),sources,screening,evidence_ids:evidenceIds(b.evidenceIds)};
}
export function instrumentInput(b){fields(b,['periodId','name','kind','registry','serial','beneficiary','region','quantityKwh','validFrom','validTo','vintageFrom','vintageTo','retiredOn','factorId','qualityChecks','evidenceIds']);
 const [from,to]=dateRange(b.validFrom,b.validTo),[vf,vt]=dateRange(b.vintageFrom,b.vintageTo);fields(b.qualityChecks,QUALITY_CRITERIA);
 const checks={};for(const k of QUALITY_CRITERIA){const x=b.qualityChecks[k];fields(x,['assessment','explanation']);checks[k]={assessment:choice(x.assessment,['PASS','NOT_APPLICABLE'],'quality assessment'),explanation:reason(x.explanation)};
  if(QUALITY_CRITERIA.slice(0,5).includes(k)&&x.assessment!=='PASS')fail(422,'INSTRUMENT_QUALITY','Attribute, exclusive claim, retirement, vintage and market checks must pass.');}
 const retired=day(b.retiredOn);if(retired>new Date().toISOString().slice(0,10))fail(422,'FUTURE_RETIREMENT','A planned retirement cannot support a present emissions claim.');
 const registry=text(b.registry,'registry',180),serial=text(b.serial,'serial',180);
 return {period_id:uuid(b.periodId),name:text(b.name,'name',180),kind:choice(b.kind,['EAC','PPA','SUPPLIER_PRODUCT'],'instrument kind'),registry,serial,serial_key:registry.toUpperCase().replace(/\s+/g,' ')+'|'+serial.toUpperCase().replace(/\s+/g,''),beneficiary:text(b.beneficiary,'beneficiary',200),region:region(b.region),quantity_kwh:decimal(b.quantityKwh,'quantityKwh'),valid_from:from,valid_to:to,vintage_from:vf,vintage_to:vt,retired_on:retired,factor_id:uuid(b.factorId),quality_checks:checks,evidence_ids:evidenceIds(b.evidenceIds)};
}
export function intervalDays(a,b){return Math.floor((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000)+1;}
export function gaps(from,to,intervals){let cursor=from;const missing=[],next=d=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10),prev=d=>new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 for(const x of [...intervals].sort((a,b)=>a.interval_start.localeCompare(b.interval_start))){if(x.interval_end<cursor||x.interval_start>to)continue;if(x.interval_start>cursor)missing.push({from:cursor,to:prev(x.interval_start)});if(x.interval_end>=cursor)cursor=next(x.interval_end);if(cursor>to)break;}if(cursor<=to)missing.push({from:cursor,to});return missing;}
