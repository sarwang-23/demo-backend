import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase,seed,transaction,audit } from './lib/db.mjs';
import { AppError,fail,object,id,cleanUser,requireRole,now } from './lib/shared.mjs';
import { acquireRuntimeLock } from './lib/runtime.mjs';
import { login,logout,authenticate } from './lib/auth.mjs';
import { metadata,dashboard,auditList,report,reportCsv } from './lib/dashboard.mjs';
import { tenantCheck,createActivity,listActivities,getActivity,preview,updateActivity,deleteActivity,transition } from './lib/activities.mjs';
import { uploadInvoice,listDocuments,documentRow,serializeDocument,confirmInvoice } from './lib/invoices.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA=path.join(HERE,'.local-data');
const staticFiles={
  '/':['public/index.html','text/html; charset=utf-8'],
  '/app.js':['public/app.js','text/javascript; charset=utf-8'],
  '/style.css':['public/style.css','text/css; charset=utf-8'],
  '/api-docs':['public/api-docs.html','text/html; charset=utf-8'],
  '/openapi.json':['docs/openapi.json','application/json; charset=utf-8'],
  '/samples/sample-electricity.pdf':['samples/sample-electricity.pdf','application/pdf'],
  '/samples/sample-diesel.pdf':['samples/sample-diesel.pdf','application/pdf'],
  '/samples/scanned-electricity.png':['samples/scanned-electricity.png','image/png'],
  '/samples/sample-electricity.txt':['samples/sample-electricity.txt','text/plain; charset=utf-8'],
};
async function readBody(req,max=64*1024) {
  const length=Number(req.headers['content-length']??0);
  if(length>max)fail(413,'PAYLOAD_TOO_LARGE',`Request exceeds the ${Math.round(max/1024)} KB limit.`);
  let total=0;const chunks=[];
  for await(const chunk of req){total+=chunk.length;if(total>max)fail(413,'PAYLOAD_TOO_LARGE','Request body is too large.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if(!String(req.headers['content-type']??'').toLowerCase().startsWith('application/json'))fail(415,'CONTENT_TYPE','Use Content-Type: application/json.');
  const raw=await readBody(req);let body;
  try{body=JSON.parse(raw.toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body is not valid JSON.');}
  return object(body);
}
function securityHeaders(res,requestId) {
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('X-Request-Id',requestId);
}
function send(res,status,data,requestId) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({success:true,data,requestId}));
}
export function createDemoServer({dbPath=path.join(DEFAULT_DATA,'demo.sqlite'),quiet=false,seedDemo=true}={}) {
  const db=openDatabase(dbPath);if(seedDemo)seed(db);
  const windows=new Map();
  function rateLimit(key,max,ms) {
    const current=Date.now();let window=windows.get(key);
    if(!window||window.until<=current){window={count:0,until:current+ms};windows.set(key,window);}
    if(++window.count>max)fail(429,'RATE_LIMITED','Too many requests. Please try again later.');
    if(windows.size>1000)for(const [k,v] of windows)if(v.until<=current)windows.delete(k);
  }
  const server=createServer(async(req,res)=>{
    const requestId=id();securityHeaders(res,requestId);
    try {
      const port=req.socket.localPort;
      const allowedHosts=[`localhost:${port}`,`127.0.0.1:${port}`];
      if(!allowedHosts.includes(req.headers.host))fail(403,'INVALID_HOST','This demo is available only through localhost.');
      const origin=req.headers.origin;
      if(origin&&!allowedHosts.map(h=>'http://'+h).includes(origin))fail(403,'INVALID_ORIGIN','Cross-origin requests are disabled.');
      const url=new URL(req.url,`http://${req.headers.host}`);const route=url.pathname;const method=req.method;
      if(method==='GET'&&route==='/health') {
        db.prepare('SELECT 1 AS ok').get();send(res,200,{status:'ok',database:'connected',mode:'LOCAL_DEMO',databaseEngine:'SQLite',ocr:false},requestId);return;
      }
      if(method==='GET'&&Object.hasOwn(staticFiles,route)) {
        const [relative,type]=staticFiles[route];
        res.writeHead(200,{'Content-Type':type});res.end(readFileSync(path.join(HERE,relative)));return;
      }
      if(method==='GET'&&route==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(route==='/api/v1/auth/login'&&method==='POST') {
        rateLimit('login:'+req.socket.remoteAddress,60,15*60*1000);
        send(res,200,await login(db,await jsonBody(req)),requestId);return;
      }
      if(!route.startsWith('/api/v1/'))fail(404,'NOT_FOUND','Route not found.');
      const user=authenticate(db,req.headers.authorization);
      rateLimit('api:'+user.id,300,60*1000);
      const query=Object.fromEntries(url.searchParams);tenantCheck(user,query.universityId);
      let data;let status=200;
      if(route==='/api/v1/auth/me'&&method==='GET')data=cleanUser(user);
      else if(route==='/api/v1/auth/logout'&&method==='POST')data=logout(db,user,req.headers.authorization);
      else if(route==='/api/v1/meta'&&method==='GET')data=metadata(db,user);
      else if(route==='/api/v1/dashboard'&&method==='GET')data=dashboard(db,user,query);
      else if(route==='/api/v1/emission-factors'&&method==='GET')data=metadata(db,user).factors;
      else if(route==='/api/v1/activity-data/preview'&&method==='POST')data=preview(db,user,await jsonBody(req));
      else if(route==='/api/v1/activity-data'&&method==='GET')data=listActivities(db,user,query);
      else if(route==='/api/v1/activity-data'&&method==='POST'){data=createActivity(db,user,await jsonBody(req),req.headers['idempotency-key']??null,requestId);status=201;}
      else if(/^\/api\/v1\/activity-data\/[^/]+$/.test(route)) {
        const aid=route.split('/').at(-1);
        if(method==='GET')data=getActivity(db,user,aid);
        else if(method==='PATCH')data=updateActivity(db,user,aid,await jsonBody(req),requestId);
        else if(method==='DELETE')data=deleteActivity(db,user,aid,await jsonBody(req),requestId);
        else fail(405,'METHOD_NOT_ALLOWED','Unsupported method.');
      } else if(/^\/api\/v1\/activity-data\/[^/]+\/(submit|start-review|verify|reject|calculate)$/.test(route)&&method==='POST') {
        const parts=route.split('/');data=transition(db,user,parts[4],parts[5],await jsonBody(req),requestId);
      } else if(route==='/api/v1/documents/upload'&&method==='POST') {
        requireRole(user,['ORGANISATION_ADMIN','DATA_ENTRY']);
        const type=req.headers['content-type']??'';
        if(!type.startsWith('multipart/form-data;'))fail(415,'CONTENT_TYPE','Use multipart/form-data with a file field named file.');
        const bytes=await readBody(req,10*1024*1024+64*1024);
        let form;try{form=await new Request('http://localhost/upload',{method:'POST',headers:{'content-type':type},body:bytes}).formData();}catch{fail(400,'INVALID_MULTIPART','Malformed file upload.');}
        tenantCheck(user,form.get('universityId'));
        const values=[...form.entries()];const files=values.filter(([,v])=>typeof v!=='string');
        if(files.length!==1||files[0][0]!=='file'||values.length>10)fail(422,'ONE_FILE_REQUIRED','Upload exactly one file using the file field.');
        const file=files[0][1];data=uploadInvoice(db,user,file.name,file.type,Buffer.from(await file.arrayBuffer()),requestId);status=201;
      } else if(route==='/api/v1/documents'&&method==='GET')data=listDocuments(db,user,query);
      else if(/^\/api\/v1\/documents\/[^/]+\/download$/.test(route)&&method==='GET') {
        const doc=documentRow(db,user,route.split('/')[4],true);
        audit(db,user,'INVOICE_DOWNLOADED','Document',doc.id,null,{sha256:doc.sha256},requestId);
        res.writeHead(200,{'Content-Type':doc.mime_type,'Content-Disposition':`attachment; filename="invoice${path.extname(doc.original_name).replace(/[^.a-z0-9]/gi,'')}"; filename*=UTF-8''${encodeURIComponent(doc.original_name).replaceAll("'",'%27')}`,'Content-Length':doc.file_size});res.end(Buffer.from(doc.content));return;
      } else if(/^\/api\/v1\/documents\/[^/]+\/create-activity$/.test(route)&&method==='POST') {
        data=confirmInvoice(db,user,route.split('/')[4],await jsonBody(req),requestId);status=201;
      } else if(/^\/api\/v1\/documents\/[^/]+$/.test(route)&&method==='GET')data=serializeDocument(documentRow(db,user,route.split('/')[4]));
      else if(route==='/api/v1/audit-logs'&&method==='GET')data=auditList(db,user,query);
      else if(route==='/api/v1/reports/summary'&&method==='GET')data=report(db,user,query);
      else if(route==='/api/v1/reports/export'&&method==='GET') {
        const format=query.format??'json';if(!['json','csv'].includes(format))fail(422,'INVALID_FORMAT','Use json or csv.');
        const output=report(db,user,query);audit(db,user,'REPORT_EXPORTED','University',user.university_id,null,{format,filters:query},requestId);
        res.writeHead(200,{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="CarbonSynq-DEMO-report.${format}"`});
        res.end(format==='csv'?reportCsv(output):JSON.stringify(output,null,2));return;
      } else if(/^\/api\/v1\/reporting-periods\/[^/]+\/(lock|unlock)$/.test(route)&&method==='POST') {
        requireRole(user,['ORGANISATION_ADMIN']);const body=await jsonBody(req);tenantCheck(user,body.universityId);
        const parts=route.split('/');const periodId=parts[4];const newStatus=parts[5]==='lock'?'LOCKED':'OPEN';
        transaction(db,()=>{
          const old=db.prepare('SELECT * FROM reporting_periods WHERE id=? AND university_id=?').get(periodId,user.university_id);
          if(!old)fail(404,'NOT_FOUND','Reporting period not found.');
          db.prepare('UPDATE reporting_periods SET status=? WHERE id=? AND university_id=?').run(newStatus,periodId,user.university_id);
          audit(db,user,'PERIOD_'+newStatus,'ReportingPeriod',periodId,{status:old.status},{status:newStatus},requestId);
        });data={id:periodId,status:newStatus};
      } else fail(404,'NOT_FOUND','Route not found.');
      send(res,status,data,requestId);
    } catch(error) {
      if(res.headersSent){res.end();return;}
      const status=error instanceof AppError?error.status:500;
      if(status===500&&!quiet)console.error(`[${requestId}] ${error.stack??error.message}`);
      if(status===429)res.setHeader('Retry-After','60');
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({success:false,error:{code:error instanceof AppError?error.code:'INTERNAL_ERROR',message:error instanceof AppError?error.message:'Something went wrong. Check the server log using the request ID.',...(error instanceof AppError&&error.details?{details:error.details}:{})},requestId}));
      if(!req.complete)req.resume();
    }
  });
  server.headersTimeout=15000;server.requestTimeout=30000;server.keepAliveTimeout=5000;
  server.on('close',()=>db.close());return {server,db};
}
const isDirect=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isDirect) {
  if(process.env.NODE_ENV==='production'){console.error('This isolated demo must not run as a production service. Read docs/HLD.md.');process.exit(1);}
  const port=Number(process.env.DEMO_PORT??5050);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('DEMO_PORT must be between 1024 and 65535.');
  const dataDir=path.resolve(process.env.DEMO_DATA_DIR??DEFAULT_DATA);
  const releaseLock=acquireRuntimeLock(dataDir);
  process.on('exit',releaseLock);
  const {server}=createDemoServer({dbPath:path.join(dataDir,'demo.sqlite')});
  server.on('close',releaseLock);
  server.on('error',error=>{releaseLock();console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Stop the other server or set DEMO_PORT.`:error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    console.log(`\nCarbonSynq University Demo\nOpen http://localhost:${port}\nDemo data: ${process.env.DEMO_DATA_DIR??DEFAULT_DATA}\nLogin: admin@carbonsynq.demo / Demo@12345\nLocal demo only. Synthetic data and illustrative factors. Press Ctrl+C to stop.\n`);
  });
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;server.close(()=>{process.exitCode=0;});server.closeIdleConnections();setTimeout(()=>process.exit(1),5000).unref();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
