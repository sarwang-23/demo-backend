"""Optional renderer/interaction fixture: pip install playwright; playwright install chromium.
No backend network or cloud execution. Run python tests/browser-ui.py.
"""
import json,uuid,os,shutil
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
out=Path(os.environ.get('UI_ARTIFACT_DIR','ui-artifacts'));out.mkdir(parents=True,exist_ok=True)
u=lambda: str(uuid.uuid4())
tenant,person,campus,campus2,building,period,docid=[u() for _ in range(7)]
user={'id':person,'tenantId':tenant,'name':'UI Verification User','email':'ui@fixture.example','role':'ADMIN'}
meta={'tenant':{'id':tenant,'name':'UI TEST WORKSPACE - SYNTHETIC','storage_used_bytes':'10500','storage_quota_bytes':'1073741824'},'categories':{'PURCHASED_ELECTRICITY':['SCOPE_2','kWh'],'DIESEL':['SCOPE_1','litre'],'LPG':['SCOPE_1','kg']},'campuses':[{'id':campus,'name':'Main campus (test)'},{'id':campus2,'name':'Research campus (test)'}],'buildings':[{'id':building,'name':'Administration','campus_id':campus}],'periods':[{'id':period,'name':'FY 2026-27 (test)','status':'OPEN','start_date':'2026-04-01','end_date':'2027-03-31'}],'factors':[]}
dash={'totals':{'tonnes_co2e':'43.891345','calculated_records':'36','invoice_backed_records':'12'},'campuses':[{'id':campus,'name':'Main campus (test)','kg_co2e':'29500'},{'id':campus2,'name':'Research campus (test)','kg_co2e':'14391.345'}],'monthly':[],'pipeline':[{'status':'DRAFT','count':'2'},{'status':'SUBMITTED','count':'1'},{'status':'UNDER_REVIEW','count':'2'},{'status':'VERIFIED','count':'1'},{'status':'CALCULATED','count':'36'}],'jobs':[]}
records=[]
docs=[{'id':docid,'original_name':'synthetic-invoice.txt','mime_type':'text/plain','file_size':'124','sha256':'a'*64,'status':'REVIEW_REQUIRED','scan_result':'CLEAN','version':3,'extraction':{'fields':{'vendor':'Synthetic Utility','invoiceNumber':'TEST-001','amountInr':2000,'quantity':200,'activityDate':'2026-06-02','category':'PURCHASED_ELECTRICITY'},'warnings':['UI fixture only. Not a live malware verdict. Check original consumption.']}}]
requests=[];errors=[];checks=[]
def route_handler(route):
 r=route.request;p=urlparse(r.url).path;method=r.method;requests.append({'path':p,'method':method})
 body=r.post_data_json if method in ['POST','PATCH'] and 'application/json' in r.headers.get('content-type','') else None
 data={};status=200
 if p.endswith('/auth/login'): data={'user':user,'token':'fixture-session-only'}
 elif p.endswith('/auth/logout'):data={'loggedOut':True}
 elif p.endswith('/meta'):data=meta
 elif p.endswith('/dashboard'):data=dash
 elif p.endswith('/activities') and method=='GET':data={'items':records,'nextCursor':None}
 elif p.endswith('/activities') and method=='POST':
  assert isinstance(body['quantity'],str),'quantity must remain a string';assert body['unit']=='kWh';assert 'tenantId' not in body;assert r.headers.get('idempotency-key')
  a={'id':u(),'campus_id':body['campusId'],'period_id':body['periodId'],'building_id':body.get('buildingId'),'category':body['category'],'quantity':body['quantity'],'unit':body['unit'],'activity_date':body['activityDate'],'input_source':'MANUAL','status':'DRAFT','version':1,'created_by':person};records.append(a);data=a;status=201;checks.append('manual DTO uses decimal string, canonical unit, key; no caller tenant')
 elif p.endswith('/documents/upload'):
  assert r.headers.get('idempotency-key');assert r.headers.get('x-filename');assert r.headers.get('content-type')=='text/plain';checks.append('raw invoice upload includes MIME, filename and retry key');data={'id':u(),'status':'QUEUED'};status=202
 elif p.endswith('/documents'):data={'items':docs,'nextCursor':None}
 elif p.endswith('/documents/'+docid):data=docs[0]
 elif p.endswith('/confirm'):
  assert body['reviewConfirmed'] is True;assert body['quantity']=='200';assert body['amountInr']=='2000';checks.append('invoice DTO separates money and consumption; explicit human confirmation');data={'id':u()};status=201
 elif p.endswith('/jobs'):data={'items':[{'id':u(),'kind':'SCAN_INVOICE','status':'QUEUED','attempts':0,'max_attempts':5,'last_error':None}],'nextCursor':None}
 elif p.endswith('/campuses') and method=='POST':assert body['name']=='New Test Campus';checks.append('workspace setup form submits name/code without property collision');data={'id':u()};status=201
 else:raise AssertionError('Unexpected fixture API '+method+' '+p)
 route.fulfill(status=status,content_type='application/json',body=json.dumps({'success':True,'data':data,'requestId':u()}))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium') or None,headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1050},device_scale_factor=1)
 page.on('pageerror',lambda e:errors.append(str(e)))
 source=Path(__file__).resolve().parents[1]/'public'
 html=(source/'index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','').replace('<script defer src="/app.js"></script>','')
 page.set_content(html)
 page.add_style_tag(content=(source/'style.css').read_text())
 def binding(path,opts):
  output={}
  class FakeRoute:
   request=SimpleNamespace(url='https://fixture.invalid/api/v2'+path.removeprefix('/api/v2'),method=opts.get('method','GET'),post_data_json=json.loads(opts['body']) if isinstance(opts.get('body'),str) and 'application/json' in opts.get('headers',{}).get('Content-Type','') else None,headers={k.lower():v for k,v in opts.get('headers',{}).items()})
   def fulfill(self,**kwargs):output.update(kwargs)
  route_handler(FakeRoute());return output
 page.expose_function('fixtureApi',binding)
 page.evaluate("""() => { window.fetch=async(path,opts={})=>{ const plain={...opts};if(plain.body instanceof Blob)plain.body=await plain.body.text();const r=await window.fixtureApi(path,plain);return new Response(r.body,{status:r.status,headers:{'Content-Type':r.content_type}}); };if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)); }""")
 page.add_script_tag(content=(source/'app.js').read_text())
 page.screenshot(path=str(out/'login.png'),full_page=True)
 page.fill('[name=tenantId]',tenant);page.fill('[name=email]','ui@fixture.example');page.fill('[name=password]','UI-fixture-only-password');page.click('#loginForm button')
 page.wait_for_selector('#workspace:not([hidden])');page.wait_for_selector('.kpi-number')
 assert page.locator('.kpi-number').first.inner_text().startswith('43.89');checks.append('dashboard renders synthetic fixture quantities without runtime error')
 assert 'localStorage.setItem' not in (source/'app.js').read_text();assert 'sessionStorage.setItem' not in (source/'app.js').read_text();checks.append('source check: no auth token written to web storage')
 page.screenshot(path=str(out/'dashboard.png'),full_page=True)
 page.click('[data-view=entries]');page.click('[data-action=new]');page.wait_for_selector('#entryDialog[open]');page.fill('#entryForm [name=quantity]','123.456789');page.fill('#entryForm [name=activityDate]','2026-06-01');page.screenshot(path=str(out/'manual-entry.png'),full_page=True);page.click('#entryForm button[type=submit]');page.wait_for_selector('text=123.456789 kWh');checks.append('manual dialog saves and ledger renders new row')
 page.click('[data-view=invoices]');page.wait_for_selector('#invoiceFile');page.screenshot(path=str(out/'invoices.png'),full_page=True)
 page.click('[data-action=review-invoice]');page.wait_for_selector('#entryDialog[open]');assert page.locator('#entryForm [name=quantity]').input_value()=='200';assert page.locator('#invoiceReviewNotes').inner_text().startswith('UI fixture only');page.check('#entryForm [name=reviewConfirmed]');page.click('#entryForm button[type=submit]');page.wait_for_selector('#entryDialog',state='hidden');checks.append('invoice review displays extraction warning before confirmation')
 page.click('[data-view=invoices]');page.set_input_files('#invoiceFile',{'name':'upload-test.txt','mimeType':'text/plain','buffer':b'Synthetic invoice only'});page.click('[data-action=upload]');page.wait_for_function("document.querySelector('#notice').textContent.includes('Evidence received')")
 page.click('[data-view=jobs]');page.wait_for_selector('text=Scan Invoice');checks.append('queue page renders job state')
 page.click('[data-view=setup]');page.fill('[data-resource=campuses] [name=name]','New Test Campus');page.fill('[data-resource=campuses] [name=code]','NEW');page.click('[data-resource=campuses] button');page.wait_for_function("document.querySelector('#notice').textContent.includes('Workspace record created')")
 page.click('[data-view=overview]');page.wait_for_selector('.kpi-number');page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');checks.append('390px mobile overview has no page-level horizontal overflow')
 assert page.locator('#logout').is_visible();page.click('#logout');page.wait_for_selector('#loginView:not([hidden])');checks.append('mobile logout clears the workspace')
 assert not errors,errors
 browser.close()
report={'checksPassed':len(checks),'checks':checks,'pageErrors':errors,'apiRequests':len(requests),'browser':'local Chromium / Playwright','backend':'Native Chromium renders local HTML/CSS/JS injected by test harness; fetch mocked. Browser loopback HTTP navigation was blocked by environment. Not a network/CSP/PostgreSQL/S3/ClamAV end-to-end test','screenshots':'Synthetic workspace fixtures, not customer data or production totals'}
(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
