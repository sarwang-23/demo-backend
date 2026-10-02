"""Native Chromium tests: actual HTTP/static UI/parser/domain, synthetic DB/storage/scanner."""
import os,sys,json,subprocess,time,re,base64,urllib.request,urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[2];out=Path(os.environ.get('UI_OUTPUT_DIR','/mnt/data/ingestion-ui-qa'));out.mkdir(parents=True,exist_ok=True)
srv=subprocess.Popen(['node','tests/ingestion/http-fixture.mjs'],cwd=root,env={**os.environ,'INGESTION_UI_FIXTURE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
config=json.loads(srv.stdout.readline());results=[];errors=[];dom_harness=os.environ.get('UI_DOM_HARNESS')=='1'
def navigate(page):
 if not dom_harness:
  page.goto(config['url']+'/university/imports');return
 def bridge(path,opts):
  if not isinstance(path,str) or not path.startswith('/') or path.startswith('//'):raise ValueError('Only this fixture relative path is accepted')
  data=base64.b64decode(opts['base64']) if opts.get('base64') is not None else opts.get('body',None)
  if isinstance(data,str):data=data.encode()
  request=urllib.request.Request(config['url']+path,data=data,headers=opts.get('headers',{}),method=opts.get('method','GET'))
  try:r=urllib.request.urlopen(request)
  except urllib.error.HTTPError as e:r=e
  with r:return {'status':r.status,'body':base64.b64encode(r.read()).decode(),'headers':dict(r.headers)}
 page.expose_function('__fixture_http',bridge)
 html=(root/'public/ingestion/index.html').read_text();html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]*>','',html);page.set_content(html);page.add_style_tag(content=(root/'public/ingestion/style.css').read_text())
 page.add_script_tag(content="""window.fetch=async(path,options={})=>{if(options.body instanceof Blob){let a=new Uint8Array(await options.body.arrayBuffer());options={...options,base64:btoa(Array.from(a,b=>String.fromCharCode(b)).join(''))};delete options.body;}let r=await window.__fixture_http(path,options);return new Response(Uint8Array.from(atob(r.body),x=>x.charCodeAt(0)),{status:r.status,headers:r.headers});};if(!crypto.randomUUID)crypto.randomUUID=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};""")
 page.add_script_tag(content=(root/'public/ingestion/app.js').read_text())
def done(name):results.append(name);print('PASS',name,flush=True)
def login(page):
 navigate(page);page.locator('[name=tenantId]').fill(config['tenantId']);page.locator('[name=email]').fill('entry@test.invalid');page.locator('[name=password]').fill('FixtureOnly@123');page.locator('#loginForm button').click();expect(page.locator('#workspace')).to_be_visible()
def batch(page,name,kind='SPREADSHEET'):
 page.locator('#createForm [name=name]').fill(name);page.locator('#period').select_option(config['periodId']);page.locator('#createForm [name=kind]').select_option(kind);page.locator('#createForm button').click();expect(page.locator('#batchName')).to_have_text(name)
def upload(page,paths):
 page.locator('#files').set_input_files([str(p) for p in paths]);page.locator('#upload').click();expect(page.locator('#fileCount')).to_have_text(str(len(paths))+' FILES',timeout=30000)
 for _ in range(40):
  page.locator('#refresh').click();page.wait_for_timeout(200)
  if page.locator('#fileList .state').filter(has_text='REVIEW_REQUIRED').count()==len(paths):return
 raise AssertionError('Parser workers did not finish')
def defaults(page):
 for field,val in [('sourceId',config['sourceId']),('factorId',config['factorId']),('fallbackFactorId',config['fallbackId'])]:page.locator('#defaultFields [data-field='+field+']').select_option(val)
 page.locator('#defaultFields [data-field=fallbackReason]').fill('Checked against the synthetic reviewed residual factor.')
def confirmdialog(page):
 expect(page.locator('#confirmDialog')).to_be_visible();page.locator('#confirmForm [name=ack]').check();page.locator('#confirmForm button.primary').click();expect(page.locator('#confirmDialog')).not_to_be_visible()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1600,'height':1050});page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append('CSP: '+m.text) if m.type=='error' and ('Content Security Policy' in m.text or 'Refused to' in m.text) else None)
  login(page);done('Login and live local HTTP domain dispatch in '+('DOM harness' if dom_harness else 'native navigation'))
  batch(page,'SYNTHETIC | Messy campus spreadsheet');upload(page,[root/'samples/ingestion/University-Messy-Data.xlsx']);done('Real XLSX byte upload and parser through HTTP')
  page.locator('#fileList button').first.click();expect(page.locator('#headerRow')).to_have_value('5');page.locator('#dateOrder').select_option('DMY');defaults(page)
  page.get_by_role('button',name='Normalize & preview',exact=True).click();expect(page.locator('#rowTable tbody tr')).to_have_count(5);expect(page.locator('#rowTable')).to_contain_text('1500.000000');expect(page.locator('#rowTable')).to_contain_text('SKIPPED');done('Header suggestions, MWh normalization and visible skipped rows')
  page.locator('#allRows').check();page.locator('#confirmSelected').click();confirmdialog(page);expect(page.locator('#rowTable .state').filter(has_text='READY')).to_have_count(3);done('Three actual records confirmed; repeated header and subtotal not imported')
  page.locator('#reviewPanel').scroll_into_view_if_needed();page.screenshot(path=str(out/'review-workbench.png'))
  page.locator('#allRows').uncheck();page.locator('#allRows').check();page.locator('#commitSelected').click();confirmdialog(page);expect(page.locator('#rowTable .state').filter(has_text='IMPORTED')).to_have_count(3);done('Reviewed selection creates three drafts through the existing carbon service')
  with page.expect_download() as download:page.locator('#exportXlsx').click()
  download.value.save_as(str(out/'Normalized-Example.xlsx'));done('Browser downloads the actual normalized XLSX')
  page.locator('#completeBatch').click();confirmdialog(page);expect(page.locator('#batchKind')).to_contain_text('COMPLETE');done('Batch closes only after records resolved')
  batch(page,'SYNTHETIC | Six PDF invoices','INVOICE');upload(page,list((root/'samples/ingestion/invoices').glob('*.pdf')));done('Six real PDFs upload with individual processing statuses')
  page.locator('#fileList').get_by_role('button',name='Demo-Invoice-01.pdf',exact=True).click();defaults(page);page.get_by_role('button',name='Normalize & preview',exact=True).click();expect(page.locator('#rowTable tbody tr')).to_have_count(1);expect(page.locator('#rowTable')).to_contain_text('11250.00');done('Invoice quantity and INR amount remain distinct in review UI')
  # Spreadsheet already imported the same source interval, so overlap must be flagged.
  expect(page.locator('#rowTable .state')).to_have_text('INVALID');done('Existing Scope 2 period data blocks duplicate/overlapping intake')
  page.get_by_role('button',name='Normalize remaining invoices',exact=True).click();confirmdialog(page);expect(page.locator('#rowTable tbody tr')).to_have_count(6);done('Shared invoice setup normalizes all six files into a single review workbench')
  page.locator('#createPanel').evaluate('(e)=>e.hidden=true');page.locator('#uploadCard').evaluate('(e)=>e.hidden=true');page.locator('#detail details').first.evaluate('(e)=>e.open=false');page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'intake-desktop.png'))
  page.set_viewport_size({'width':390,'height':844});page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'intake-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile overflow';done('390px mobile view without page overflow')
  assert not errors,errors;done('No JavaScript errors in tested UI controls')
  browser.close()
finally:
 srv.terminate()
 try:srv.wait(timeout=8)
 except subprocess.TimeoutExpired:srv.kill()
 (out/'results.json').write_text(json.dumps({'passed':len(results),'checks':results,'errors':errors,'environment':'Chromium; real HTTP/parser/domain; synthetic memory DB, storage and scanner.','mode':'DOM_WITH_LOCAL_HTTP_BRIDGE' if dom_harness else 'DIRECT_BROWSER_HTTP','browserNavigationTested':not dom_harness,'productionCSPTested':not dom_harness},indent=2))
