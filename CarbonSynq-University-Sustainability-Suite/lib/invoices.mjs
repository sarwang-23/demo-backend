import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { audit, transaction } from './db.mjs';
import { id,now,text,number,fail,sha256,requireRole,WRITERS } from './shared.mjs';
import { validateActivity,insertActivity,getActivity,requireVersion } from './activities.mjs';
const MAX_BYTES=10*1024*1024;

export function validateFile(filename,declaredMime,bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length===0)fail(422,'EMPTY_FILE','Select a non-empty invoice.');
  if(bytes.length>MAX_BYTES)fail(413,'FILE_TOO_LARGE','Invoice size must not exceed 10 MB.');
  const safeName=path.basename(filename.replaceAll('\\','/')).replace(/[\x00-\x1f\x7f]/g,'_').slice(0,180);
  const ext=path.extname(safeName).toLowerCase();
  let mime;
  if(ext==='.pdf'&&bytes.subarray(0,5).toString()==='%PDF-')mime='application/pdf';
  else if(ext==='.png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(['.jpg','.jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
  else if(ext==='.txt'&&!bytes.includes(0)&&!bytes.toString('utf8').includes('\ufffd'))mime='text/plain';
  else fail(415,'UNSUPPORTED_FILE','File content and extension must match PDF, PNG, JPEG or UTF-8 TXT.');
  const allowed=mime==='image/jpeg'?['image/jpeg','image/jpg']:mime==='text/plain'?['text/plain']:[''+mime];
  if(declaredMime && !['application/octet-stream',''].includes(declaredMime) && !allowed.includes(declaredMime))
    fail(415,'MIME_MISMATCH','The declared content type does not match the file.');
  return {originalName:safeName,mimeType:mime,fileSize:bytes.length,sha256:sha256(bytes)};
}
function ascii85(value) {
  const s=value.toString('latin1').replace(/\s/g,'').replace(/^<~/,'').replace(/~>$/,'');
  const out=[];let group=[];
  for(const c of s) {
    if(c==='z'&&group.length===0){out.push(0,0,0,0);continue;}
    const v=c.charCodeAt(0)-33;if(v<0||v>84)throw new Error('Unsupported ASCII85');group.push(v);
    if(group.length===5){let n=group.reduce((a,b)=>a*85+b,0);out.push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);group=[];}
  }
  if(group.length>1){const count=group.length;while(group.length<5)group.push(84);const n=group.reduce((a,b)=>a*85+b,0);out.push(...[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].slice(0,count-1));}
  return Buffer.from(out);
}
function literalStrings(s) {
  const out=[];
  for(let i=0;i<s.length;i++) {
    if(s[i]!=='(')continue;
    let result='';let depth=1;
    while(++i<s.length&&depth) {
      let c=s[i];
      if(c==='\\') {
        c=s[++i];if(c===undefined)break;
        if(/[0-7]/.test(c)){let oct=c;for(let j=0;j<2&&/[0-7]/.test(s[i+1]??'x');j++)oct+=s[++i];result+=String.fromCharCode(parseInt(oct,8));}
        else if(c==='n'||c==='r')result+=' ';
        else if(c==='t')result+=' ';
        else if(c==='\r'){if(s[i+1]==='\n')i++;}
        else if(c!=='\n')result+=c;
      } else if(c==='('){depth++;result+=c;}
      else if(c===')'){depth--;if(depth)result+=c;}
      else result+=c;
    }
    if(result.trim())out.push(result);
  }
  return out;
}
/** Conservative text-only parser: standard-font, unencrypted PDF content streams.
 * It deliberately does not claim OCR, font-CMap support, table recognition or universal PDF coverage.
 * Complex/scanned files remain usable as evidence and require manual field review.
 */
export function basicPdfText(bytes) {
  const raw=bytes.toString('latin1');
  if(/\/Encrypt\b|\/ToUnicode\b|\/Subtype\s*\/Type0\b/.test(raw))return '';
  const pieces=[];let matches=0;let expanded=0;
  const pattern=/\bstream\r?\n/g;
  let match;
  while((match=pattern.exec(raw))!==null) {
    if(++matches>100)break;
    const end=raw.indexOf('endstream',pattern.lastIndex);
    if(end===-1)break;
    const start=pattern.lastIndex;pattern.lastIndex=end+9;
    const header=raw.slice(Math.max(0,match.index-2048),match.index);
    const dictionary=header.slice(header.lastIndexOf('<<'));
    if(/\/Subtype\s*\/Image/.test(dictionary))continue;
    let stream=Buffer.from(raw.slice(start,end).replace(/\r?\n$/,''),'latin1');
    try {
      if(/\/ASCII85Decode/.test(dictionary))stream=ascii85(stream);
      if(/\/FlateDecode/.test(dictionary))stream=inflateSync(stream,{maxOutputLength:1024*1024});
      if(/\/Filter/.test(dictionary)&&!/\/FlateDecode|\/ASCII85Decode/.test(dictionary))continue;
      expanded+=stream.length;if(expanded>2*1024*1024)break;
      const content=stream.toString('latin1');
      for(const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g))pieces.push(...literalStrings(block[1]));
    } catch { /* Unsupported stream: never fabricate extracted fields. */ }
  }
  return pieces.join('\n').slice(0,100000);
}
export function parseInvoiceText(raw) {
  const source=raw.replace(/\r/g,'').slice(0,100000);
  const fields={};const warnings=[];
  const take=(regex)=>source.match(regex)?.[1]?.trim();
  const vendor=take(/(?:^|\n)\s*(?:vendor|supplier|billed by)\s*:\s*([^\n]{2,150})/i);
  const invoiceNumber=take(/(?:invoice|bill)\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_.-]{1,79})/i);
  const invoiceDate=take(/(?:invoice date|bill date|date)\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if(vendor)fields.vendor=vendor;if(invoiceNumber)fields.invoiceNumber=invoiceNumber;
  if(invoiceDate && Number.isFinite(Date.parse(invoiceDate)) && new Date(invoiceDate).toISOString().slice(0,10)===invoiceDate)fields.activityDate=invoiceDate;
  const quantityMatches=[...source.matchAll(/(?:units consumed|energy consumed|consumption|fuel quantity|quantity)\s*[:=\-]?\s*([\d,]+(?:\.\d{1,4})?)\s*(kwh|mwh|litres?|liters?|ltr|kg|m3|m\u00b3)\b/gi)];
  if(quantityMatches.length===1) {
    const match=quantityMatches[0];let quantity=Number(match[1].replaceAll(',',''));let unit=match[2].toLowerCase();
    if(unit==='mwh'){quantity*=1000;unit='kWh';warnings.push('MWh was converted to kWh. Confirm the conversion.');}
    else if(unit==='kwh')unit='kWh';else if(/lit|ltr/.test(unit))unit='litre';else if(unit==='m\u00b3')unit='m3';
    if(Number.isFinite(quantity)&&quantity>0&&quantity<=1e9){fields.quantity=quantity;fields.unit=unit;}
    if(unit==='kWh')fields.category='PURCHASED_ELECTRICITY';
    else if(unit==='kg'&&/\bLPG\b/i.test(source))fields.category='LPG';
    else if(unit==='m3'&&/natural gas/i.test(source))fields.category='NATURAL_GAS';
    else if(unit==='litre') {
      const diesel=/\bdiesel\b/i.test(source);const petrol=/\bpetrol\b/i.test(source);
      if(diesel!==petrol)fields.category=diesel?'DIESEL':'PETROL';
    }
  } else if(quantityMatches.length>1)warnings.push('Multiple consumption lines found. No quantity was selected; manually confirm a single activity.');
  const amountMatches=[...source.matchAll(/(?:total amount|amount payable|grand total|bill amount)\s*[:=]?\s*(?:INR|Rs\.?|\u20b9)?\s*([\d,]+(?:\.\d{1,2})?)/gi)];
  if(amountMatches.length===1){const amount=Number(amountMatches[0][1].replaceAll(',',''));if(Number.isFinite(amount)&&amount>=0)fields.amountInr=amount;}
  if(!fields.quantity)warnings.push('Consumption quantity was not identified. Money is NEVER substituted for consumption.');
  if(!fields.category)warnings.push('Select and verify the activity category.');
  warnings.push('Extracted fields are suggestions. A person must check the original invoice before creating a draft.');
  return {fields,warnings};
}
export function extractInvoice(bytes,mimeType) {
  const raw=mimeType==='text/plain'?bytes.toString('utf8'):mimeType==='application/pdf'?basicPdfText(bytes):'';
  const parsed=parseInvoiceText(raw);
  return {method:raw?(mimeType==='application/pdf'?'BASIC_PDF_TEXT':'TEXT_INVOICE'):'MANUAL_REVIEW',...parsed,
    textPreview:raw.slice(0,12000),fieldsDetected:Object.keys(parsed.fields),needsHumanReview:true,ocrAvailable:false,
    ...(raw?{}:{warnings:['This image, scan or PDF layout needs manual entry. The original file is preserved as evidence.',...parsed.warnings]})};
}
export function serializeDocument(row) {
  return {id:row.id,universityId:row.university_id,originalName:row.original_name,mimeType:row.mime_type,fileSize:row.file_size,sha256:row.sha256,status:row.status,extraction:JSON.parse(row.extraction_json),reviewed:row.reviewed_json?JSON.parse(row.reviewed_json):null,uploadedById:row.uploaded_by,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,activityId:row.activity_id??null};
}
export function documentRow(db,user,documentId,includeContent=false) {
  const select=includeContent?'d.*':'d.id,d.university_id,d.original_name,d.mime_type,d.file_size,d.sha256,d.status,d.extraction_json,d.reviewed_json,d.uploaded_by,d.version,d.created_at,d.updated_at';
  const row=db.prepare(`SELECT ${select},a.id AS activity_id FROM documents d LEFT JOIN activities a ON a.document_id=d.id WHERE d.id=? AND d.university_id=?`).get(documentId,user.university_id);
  if(!row)fail(404,'NOT_FOUND','Invoice not found.');return row;
}
export function uploadInvoice(db,user,filename,mimeType,bytes,requestId=null) {
  requireRole(user,WRITERS);const f=validateFile(filename,mimeType,bytes);
  const existing=db.prepare('SELECT id FROM documents WHERE university_id=? AND sha256=?').get(user.university_id,f.sha256);
  if(existing)fail(409,'DUPLICATE_FILE','This exact file is already uploaded.',{documentId:existing.id});
  const extraction=extractInvoice(bytes,f.mimeType);const did=id();const timestamp=now();
  transaction(db,()=>{
    db.prepare(`INSERT INTO documents (id,university_id,original_name,mime_type,file_size,sha256,content,status,extraction_json,uploaded_by,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(did,user.university_id,f.originalName,f.mimeType,f.fileSize,f.sha256,bytes,'REVIEW_REQUIRED',JSON.stringify(extraction),user.id,1,timestamp,timestamp);
    audit(db,user,'INVOICE_UPLOADED','Document',did,null,{...f,extractionMethod:extraction.method},requestId);
  });return serializeDocument(documentRow(db,user,did));
}
export function listDocuments(db,user,query={}) {
  const page=Number(query.page??1);const limit=Number(query.limit??25);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)fail(422,'INVALID_PAGINATION','Use page >= 1 and limit between 1 and 100.');
  const total=db.prepare('SELECT COUNT(*) AS n FROM documents WHERE university_id=?').get(user.university_id).n;
  const rows=db.prepare(`SELECT d.id,d.university_id,d.original_name,d.mime_type,d.file_size,d.sha256,d.status,d.extraction_json,d.reviewed_json,d.uploaded_by,d.version,d.created_at,d.updated_at,a.id AS activity_id FROM documents d LEFT JOIN activities a ON a.document_id=d.id WHERE d.university_id=? ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?`).all(user.university_id,limit,(page-1)*limit);
  return {items:rows.map(serializeDocument),pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
}
export function confirmInvoice(db,user,documentId,input,requestId=null) {
  requireRole(user,WRITERS);
  if(input.reviewConfirmed!==true)fail(422,'REVIEW_REQUIRED','Confirm that you checked the original invoice and consumption quantity.');
  const aid=transaction(db,()=>{
    const doc=documentRow(db,user,documentId);requireVersion(doc,input.version);
    if(doc.status==='LINKED')fail(409,'ALREADY_LINKED','This invoice already has an activity.',{activityId:doc.activity_id});
    const a=validateActivity(db,user,input);
    const vendor=text(input.vendor,'vendor',{max:150});const invoiceNumber=text(input.invoiceNumber,'invoiceNumber',{max:80});
    const amountInr=number(input.amountInr,'amountInr',{min:0,max:1e12,optional:true});
    const invoiceKey=sha256(vendor.toLowerCase().replace(/\s+/g,' ')+'|'+invoiceNumber.toUpperCase().replace(/\s+/g,''));
    const previous=db.prepare('SELECT id FROM documents WHERE university_id=? AND invoice_key=?').get(user.university_id,invoiceKey);
    if(previous)fail(409,'DUPLICATE_INVOICE','This vendor and invoice number were already recorded.',{documentId:previous.id});
    const aid=insertActivity(db,user,a,{documentId,amountInr,vendor,invoiceNumber,requestId});
    const reviewed={...a,vendor,invoiceNumber,amountInr,reviewConfirmed:true,reviewedBy:user.id,reviewedAt:now()};
    db.prepare("UPDATE documents SET status='LINKED',reviewed_json=?,invoice_key=?,version=version+1,updated_at=? WHERE id=? AND university_id=?")
      .run(JSON.stringify(reviewed),invoiceKey,now(),documentId,user.university_id);
    audit(db,user,'INVOICE_REVIEW_CONFIRMED','Document',documentId,doc.extraction_json,reviewed,requestId);
    return aid;
  });return getActivity(db,user,aid);
}
