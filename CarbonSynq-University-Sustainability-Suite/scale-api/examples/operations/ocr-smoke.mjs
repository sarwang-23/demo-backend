/** Opt-in actual OCR smoke, separate from repeatable unit tests. Synthetic image-only PDF. */
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { hash } from '../../src/core.mjs';
import { runOcr } from '../../src/operations/ocr.mjs';
const input=new URL('../../samples/ingestion/Image-Only-Manual-Review.pdf',import.meta.url),bytes=await readFile(input),before=hash(bytes),started=Date.now();
const result=await runOcr(bytes,'application/pdf');
assert.equal(result.needsHumanReview,true);assert.equal(result.language,'eng');assert.equal(result.pageCount,1);assert.equal(result.ocrPages,1);assert.ok(result.pages[0].words.length>0);assert.match(result.pages[0].text,/800/);assert.equal(hash(await readFile(input)),before);
const output={test:'Actual English OCR of one synthetic image-only PDF',passed:true,elapsedMs:Date.now()-started,engine:result.engine,pages:result.pageCount,ocrPages:result.ocrPages,wordCount:result.pages[0].words.length,originalSha256:before,originalUnchanged:true,needsHumanReview:result.needsHumanReview,limits:'This is one controlled fixture, not a field-accuracy benchmark or real antivirus/storage acceptance.'};
console.log(JSON.stringify(output,null,2));
if(process.env.OCR_QA_DIRECTORY){await mkdir(process.env.OCR_QA_DIRECTORY,{recursive:true});await writeFile(process.env.OCR_QA_DIRECTORY+'/ocr-result.json',JSON.stringify(result,null,2));await writeFile(process.env.OCR_QA_DIRECTORY+'/ocr-verification.json',JSON.stringify(output,null,2));}
