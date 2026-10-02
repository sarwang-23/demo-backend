/** Out-of-process parser. No shell, user-controlled paths, eval, or remote AI calls. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseInvoiceText } from '../invoice-text.mjs';
export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function parseFile(bytes,kind,{python=process.env.PARSER_PYTHON||'python3',timeoutMs=30000,maxOutput=8*1024*1024}={}) {
 return new Promise((resolve,reject)=>{
  if(!['xlsx','csv','pdf','export'].includes(kind))return reject(Error('Unsupported internal parser kind'));
  const child=spawn(python,[fileURLToPath(new URL('../../python/document_parser.py',import.meta.url)),kind],{stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32',env:{...Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','TEMP','TMP','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',OPENBLAS_NUM_THREADS:'1'}});
  let done=false,n=0,parts=[],stderr=0;
  const stop=()=>{try {if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);stop();error?reject(error):resolve(value);};
  const err=(code,message)=>Object.assign(new Error(message),{code});
  const timer=setTimeout(()=>finish(err('PARSER_TIMEOUT','Parsing exceeded 30 seconds. Split the file or review manually.')),timeoutMs);
  child.on('error',()=>finish(err('PARSER_UNAVAILABLE','Python parser unavailable. Check the parser dependencies.')));
  child.stdout.on('data',chunk=>{n+=chunk.length;if(n>maxOutput)return finish(err('PARSER_OUTPUT_LIMIT','Parser output too large. Split the file.'));parts.push(chunk);});
  child.stderr.on('data',chunk=>{stderr+=chunk.length;if(stderr>65536)finish(err('PARSER_DIAGNOSTIC_LIMIT','Parser diagnostics exceeded the limit.'));});
  child.stdin.on('error',()=>{});
  child.on('close',()=>{if(done)return;try{const result=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!result.ok)return finish(err(result.error.code,result.error.message));finish(null,result.data);}catch{finish(err('PARSER_FAILED','Parser did not return a valid result.'));}});
  child.stdin.end(bytes);
 });
}
export async function extractImport(bytes,mime) {
 const kind=mime===XLSX_MIME?'xlsx':mime==='text/csv'?'csv':mime==='application/pdf'?'pdf':null;
 if(!kind)throw Error('Unsupported import MIME');
 try {
  const parsed=await parseFile(bytes,kind);
  if(kind==='pdf'){
   const fields=parseInvoiceText(parsed.pages.map(p=>p.text).join('\n'));
   return {...parsed,fields:fields.fields,fieldsDetected:Object.keys(fields.fields),textPreview:parsed.pages.map(p=>p.text).join('\n').slice(0,12000),warnings:[...parsed.warnings,...fields.warnings]};
  }
  return parsed;
 } catch(error){return {kind:kind==='pdf'?'INVOICE':'WORKBOOK',method:'MANUAL_REVIEW',pages:[],sheets:[],fields:{},warnings:[error.message],parserError:{code:error.code||'PARSER_FAILED',message:error.message},needsHumanReview:true,ocrAvailable:false};}
}
export async function exportWorkbook(rows){const result=await parseFile(Buffer.from(JSON.stringify({rows})),'export');return Buffer.from(result.base64,'base64');}
