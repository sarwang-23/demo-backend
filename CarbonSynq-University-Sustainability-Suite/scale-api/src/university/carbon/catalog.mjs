/** Supported accounting shapes, NOT an emission-factor database. */
export const SOURCE_KINDS = Object.freeze({
  STATIONARY_COMBUSTION: {scope:'SCOPE_1',units:['litre','kg','m3','GJ'],examples:['Diesel generator','Boiler','Hostel kitchen LPG','Campus hospital furnace']},
  MOBILE_COMBUSTION: {scope:'SCOPE_1',units:['litre','kg','m3','GJ'],examples:['University-owned buses','Campus cars','Ambulances','Grounds equipment']},
  REFRIGERANT: {scope:'SCOPE_1',units:['kg'],examples:['Air-conditioning','Chillers','Laboratory refrigeration']},
  DIRECT_GAS: {scope:'SCOPE_1',units:['kg'],examples:['Documented SF6 release','Clinical N2O release','Laboratory GHG release']},
  ONSITE_PROCESS: {scope:'SCOPE_1',units:['kg','m3','item'],examples:['On-campus wastewater process','University farm inputs','Process emissions with reviewed method']},
  PURCHASED_ELECTRICITY: {scope:'SCOPE_2',units:['kWh'],commodity:'ELECTRICITY',examples:['Grid imports','Landlord-supplied purchased electricity','Third-party rooftop PPA electricity']},
  PURCHASED_STEAM: {scope:'SCOPE_2',units:['kWh'],commodity:'STEAM',examples:['Purchased steam expressed as delivered energy']},
  PURCHASED_HEAT: {scope:'SCOPE_2',units:['kWh'],commodity:'HEAT',examples:['Purchased district heat']},
  PURCHASED_COOLING: {scope:'SCOPE_2',units:['kWh'],commodity:'COOLING',examples:['Purchased chilled-water energy']},
  ATTRIBUTE_REPLACEMENT_ELECTRICITY: {scope:'SCOPE_2',units:['kWh'],commodity:'ELECTRICITY',examples:['Consumed self-generation with sold attributes; specialist-reviewed replacement accounting']}
});
export const FACILITY_TYPES=['ACADEMIC','LABORATORY','HOSTEL','DINING','HOSPITAL','SPORTS','DATA_CENTRE','ADMINISTRATION','FARM','LEASED','OTHER'];
export const FACTOR_USES=['DIRECT','LOCATION','MARKET_CONTRACT','RESIDUAL','GRID_FALLBACK'];
export const QUALITY_CRITERIA=[
  'EMISSIONS_ATTRIBUTE','UNIQUE_CLAIM','RETIRED_FOR_TENANT','VINTAGE_MATCH',
  'MARKET_BOUNDARY','SUPPLIER_ALLOCATION','DIRECT_PURCHASE_ATTRIBUTES','RESIDUAL_MIX_TREATMENT'
];
export const CHECKLIST=[
 ['DG_BOILERS_KITCHENS','Diesel generators, boilers and kitchens','STATIONARY_COMBUSTION'],
 ['OWNED_FLEET','Owned or controlled buses, vehicles and grounds equipment','MOBILE_COMBUSTION'],
 ['AC_CHILLERS','Air-conditioning, refrigeration and chillers','REFRIGERANT'],
 ['LAB_HOSPITAL_GASES','Laboratory, clinical and electrical-equipment greenhouse gas releases','DIRECT_GAS'],
 ['CAMPUS_PROCESSES','On-campus wastewater, agriculture and other direct processes','ONSITE_PROCESS'],
 ['GRID_AND_PPA','Grid, landlord-supplied and third-party PPA electricity','PURCHASED_ELECTRICITY'],
 ['DISTRICT_ENERGY','Purchased steam, heat and cooling','THERMAL_ENERGY'],
 ['SOLAR_ATTRIBUTES','Self-generation, exports and ownership of renewable attributes','SOLAR_ATTRIBUTES']
].map(([code,label,kind])=>({code,label,kind}));
export const EXTRA_KPIS=[
 ['GRID_EXPORT_KWH','Electricity exported to the grid','ENERGY','kWh','SUM'],
 ['SOLAR_SELF_USE_KWH','On-site solar consumed on campus','ENERGY','kWh','SUM'],
 ['EV_CHARGING_KWH','Campus EV charging electricity - submeter only','ENERGY','kWh','SUM'],
 ['DIESEL_STOCK_LITRE','Closing diesel stock','ENERGY','litre','LATEST'],
 ['DG_RUNTIME_HOURS','Generator operating hours','ENERGY','hour','SUM'],
 ['REFRIGERANT_RECOVERED_KG','Recovered refrigerant sent for reuse or disposal','ENERGY','kg','SUM'],
 ['METER_CALIBRATIONS','Completed utility meter calibrations','GOVERNANCE','count','SUM'],
 ['ENERGY_AUDIT_ACTIONS','Energy audit corrective actions completed','GOVERNANCE','count','SUM'],
 ['CAMPUS_BIODIVERSITY_AREA_M2','Area managed for biodiversity','GOVERNANCE','m2','LATEST'],
 ['RAINWATER_HARVESTED_M3','Rainwater harvested','WATER','m3','SUM']
].map(([code,name,domain,unit,aggregation])=>({code,name,domain,unit,aggregation,evidenceRequired:true,guidance:'Supplementary operational indicator only. No automatic emissions conversion, subtraction or certification. Avoid overlap between campus totals and submeters.'}));
export const CARBON_CATALOG={version:'scope12-1',sourceKinds:SOURCE_KINDS,facilityTypes:FACILITY_TYPES,factorUses:FACTOR_USES,qualityCriteria:QUALITY_CRITERIA,checklist:CHECKLIST,extraKpis:EXTRA_KPIS,
  capabilities:{scope1GasBreakdown:true,biogenicDisclosure:true,scope2DualReporting:true,reviewedEnergyInstruments:true,grossImportAccounting:true,sourceCoverage:true,correctiveActions:true,automaticOfficialFactors:false,certificateRegistryVerification:false,automaticOcr:false},
  methodology:'Configurable 2015 Scope 2 Guidance accounting controls. Later consultation proposals are not silently adopted. Eligibility and factor accuracy require qualified review.',
  limits:{sourcesPerBoundary:200,recordsPerPeriod:5000,recordsPerSource:5000,allocationsPerRecord:20,instrumentsPerPeriod:1000},
  notes:['Scope 2 LOCATION and MARKET are alternative results, never added together.','Biogenic CO2 is disclosed separately; biogenic CH4 and N2O remain in direct emissions.','Purchases are not necessarily fuel consumed; refrigerant purchased is not necessarily gas released.','The inventory counts one Scope 1/2 engine per activated period; legacy history is preserved.']};
