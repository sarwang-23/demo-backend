/** Offline example: actual sample bytes -> staging preview -> safe normalized XLSX.
 * No database, cloud storage, virus scanner, approval or production ledger is touched.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseFile,exportWorkbook} from '../../src/ingestion/parser.mjs';
import {workbookRows,invoiceRows,suggestSheet,suggestGroups} from '../../src/ingestion/normalize.mjs';
const out=resolve(process.argv[2]||'import-example-output');await mkdir(out,{recursive:true});
const wb=await parseFile(await readFile(new URL('../../samples/ingestion/University-Messy-Data.xlsx',import.meta.url)),'xlsx');
const sheet=wb.sheets[0],suggestion=suggestSheet(sheet),plan={sheet:sheet.name,headerRow:suggestion.headerRow,mapping:suggestion.mapping,dateOrder:'DMY',numberFormat:'IN_EN',defaults:{},forwardFill:['campusCode','sourceCode','unit']};
const rows=workbookRows(wb,plan).map((r,i)=>({...r,id:'example-'+(i+1),filename:'University-Messy-Data.xlsx',status:r.skipReason?'SKIPPED':r.issues.some(i=>i.severity==='ERROR')?'INVALID':'REVIEW',review_reason:r.skipReason||'',record_id:null}));
await writeFile(resolve(out,'normalized-preview.json'),JSON.stringify({mode:'LOCAL_NORMALIZATION_ONLY',originalFileUnchanged:true,plan,rows},null,2));
await writeFile(resolve(out,'normalized-preview.xlsx'),await exportWorkbook(rows));
const pdf=await parseFile(await readFile(new URL('../../samples/ingestion/Six-Invoices-One-PDF.pdf',import.meta.url)),'pdf');
const invoices=invoiceRows(pdf,{groups:suggestGroups(pdf),defaults:{},dateOrder:'AUTO'});
await writeFile(resolve(out,'six-invoice-preview.json'),JSON.stringify(invoices,null,2));
console.log(JSON.stringify({output:out,spreadsheetRows:rows.length,skipped:rows.filter(r=>r.status==='SKIPPED').length,invoiceGroups:invoices.length,draftsCreated:0,ocrUsed:false,note:'Register source/factors and review via /university/imports before real draft import.'},null,2));
