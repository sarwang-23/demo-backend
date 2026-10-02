import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseInvoiceText,extractInvoice,validateFile,basicPdfText} from '../lib/invoices.mjs';
import {date,number} from '../lib/shared.mjs';
import {reportCsv} from '../lib/dashboard.mjs';
const sample=name=>readFileSync(new URL('../samples/'+name,import.meta.url));
test('electricity PDF extraction reads the file, not a hard-coded fixture',()=>{
 const x=extractInvoice(sample('sample-electricity.pdf'),'application/pdf');
 assert.equal(x.method,'BASIC_PDF_TEXT');assert.equal(x.fields.quantity,12500);assert.equal(x.fields.unit,'kWh');assert.equal(x.fields.amountInr,112500);assert.equal(x.fields.category,'PURCHASED_ELECTRICITY');assert.equal(x.fields.activityDate,'2026-09-30');assert.equal(x.fields.vendor,'Greenfield Utilities (Demo)');
});
test('diesel PDF uses litre consumption and keeps money separate',()=>{
 const x=extractInvoice(sample('sample-diesel.pdf'),'application/pdf');assert.equal(x.fields.quantity,220);assert.equal(x.fields.unit,'litre');assert.equal(x.fields.amountInr,20460);assert.equal(x.fields.category,'DIESEL');
});
test('invoice parser cannot turn a money-only invoice into consumption',()=>{const x=parseInvoiceText('Vendor: Test\nInvoice number: A-001\nTotal amount: INR 12500.00');assert.equal(x.fields.amountInr,12500);assert.equal(x.fields.quantity,undefined);});
test('ambiguous multi-line consumption requires manual review',()=>{const x=parseInvoiceText('Consumption: 1200 kWh\nConsumption: 1800 kWh');assert.equal(x.fields.quantity,undefined);assert.match(x.warnings.join(' '),/Multiple consumption/);});
test('MWh normalization is explicit',()=>{const x=parseInvoiceText('Consumption: 1.5 MWh');assert.equal(x.fields.quantity,1500);assert.equal(x.fields.unit,'kWh');assert.match(x.warnings.join(' '),/converted/);});
test('scanned PNG never claims OCR or fabricated extracted fields',()=>{const x=extractInvoice(sample('scanned-electricity.png'),'image/png');assert.equal(x.method,'MANUAL_REVIEW');assert.equal(x.ocrAvailable,false);assert.deepEqual(x.fields,{});});
test('complex font PDF safely falls back to manual review',()=>{assert.equal(basicPdfText(Buffer.from('%PDF-1.7 /ToUnicode 8 0 R')),'');});
test('file signature, MIME, extension, empty and size validation',()=>{
 assert.throws(()=>validateFile('x.pdf','application/pdf',Buffer.from('not a pdf')),/content and extension/);
 assert.throws(()=>validateFile('x.exe','application/pdf',sample('sample-electricity.pdf')),/content and extension/);
 assert.throws(()=>validateFile('x.pdf','image/png',sample('sample-electricity.pdf')),/content type/);
 assert.throws(()=>validateFile('x.txt','text/plain',Buffer.alloc(0)),/non-empty/);
 assert.throws(()=>validateFile('x.txt','text/plain',Buffer.alloc(10*1024*1024+1,65)),/10 MB/);
 assert.equal(validateFile('../../invoice.pdf','application/pdf',sample('sample-electricity.pdf')).originalName,'invoice.pdf');
});
test('invalid calendar dates and non-finite quantities are rejected',()=>{
 assert.throws(()=>date('2026-02-31','date'),/real date/);assert.throws(()=>number(Infinity,'quantity'),/number/);assert.equal(date('2026-09-30','date'),'2026-09-30');
});
test('CSV export neutralizes spreadsheet formulas',()=>{
 const x=reportCsv({factorNotice:'DEMO ONLY',activities:[{id:'1',description:'=HYPERLINK("bad")',quantity:5,calculation:null}]});assert.match(x,/'=HYPERLINK/);assert.match(x,/DEMO ONLY/);
});
