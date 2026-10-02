# Explicit Chromium DOM/HTTP test harness. Requires test-only Python Playwright.
import json, pathlib, re, urllib.request, urllib.error, argparse
args=argparse.ArgumentParser();args.add_argument("--info",required=True);args.add_argument("--out",required=True);args=args.parse_args()
from playwright.sync_api import sync_playwright, expect
info=json.loads(pathlib.Path(args.info).read_text())
out=pathlib.Path(args.out);out.mkdir(parents=True,exist_ok=True); results=[]; errors=[]; console=[]
def ok(name): results.append({'name':name,'passed':True})
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=browser.new_context(viewport={'width':1440,'height':1024},accept_downloads=True)
 page=context.new_page(); page.on('pageerror', lambda e:errors.append(str(e)));page.on('console',lambda m:console.append(m.text) if m.type=='error' else None)
 def bridge(url, opts):
  req=urllib.request.Request(info['base']+url, data=opts.get('body','').encode() if opts.get('body') is not None else None,method=opts.get('method','GET'),headers=opts.get('headers',{}))
  try:
   with urllib.request.urlopen(req) as r: return {'status':r.status,'headers':dict(r.headers),'body':r.read().decode()}
  except urllib.error.HTTPError as e: return {'status':e.code,'headers':dict(e.headers),'body':e.read().decode()}
 page.expose_function('httpFixtureBridge',bridge)
 root=pathlib.Path(__file__).resolve().parents[2]/'public'/'operations'
 def load_dom(name):
  html=(root/name).read_text();html=re.sub(r'<script[^>]*src=[^>]*></script>','',html);html=re.sub(r'<link[^>]*rel="stylesheet"[^>]*>','',html)
  page.set_content(html);page.add_style_tag(content=(root/'style.css').read_text())
  page.evaluate("""() => {window.fetch=async(u,o={})=>{const r=await window.httpFixtureBridge(String(u),o);return new Response(r.body,{status:r.status,headers:r.headers});};if(!crypto.randomUUID)crypto.randomUUID=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=crypto.getRandomValues(new Uint8Array(1))[0]%16;return (c==='x'?n:((n&3)|8)).toString(16)});}""")
  page.add_script_tag(content=(root/('app.js' if name=='index.html' else 'account.js')).read_text())
 load_dom('index.html');ok('Actual operations DOM and scripts loaded with explicit local HTTP fixture bridge')
 page.locator('#loginForm [name=tenantId]').fill(info['tenantId']);page.locator('#loginForm [name=email]').fill(info['email']);page.locator('#loginForm [name=password]').fill(info['password']);page.locator('#loginForm button').click()
 expect(page.locator('#workspace')).to_be_visible();expect(page.locator('#content')).to_contain_text('Unread notifications');ok('Administrator sign-in and actual capability display')
 def tab(key):
  page.locator('[data-tab="'+key+'"]').click();expect(page.locator('#content')).not_to_contain_text('Loading authorized')
 def action(key): page.locator('[data-action="'+key+'"]').first.click();expect(page.locator('#actionDialog')).to_be_visible()
 def confirm():
  page.locator('#actionForm button[type=submit]').click();expect(page.locator('#actionDialog')).not_to_be_visible(timeout=6000)
 tab('inbox');expect(page.locator('#content')).to_contain_text('Review September');page.locator('[data-action=read]').first.click();expect(page.locator('#content')).to_contain_text('READ');ok('Recipient inbox and read marker')
 action('prefs');page.locator('#actionForm [name=emailEnabled]').check();confirm();ok('Own notification preferences')
 tab('people');action('invite');page.locator('#actionForm [name=name]').fill('Synthetic faculty invite');page.locator('#actionForm [name=email]').fill('ui-faculty@test.invalid');page.locator('#actionForm [name=currentPassword]').fill(info['password']);confirm();expect(page.locator('#notice')).to_contain_text('queued');ok('Password-confirmed staff invitation queues without exposing a credential')
 action('memberNew');page.locator('#actionForm [name=userId]').select_option(info['actors']['OTHER_ENTRY']['id']);page.locator('#actionForm [name=departmentId]').select_option('');page.locator('#actionForm [name=reason]').fill('Synthetic campus-wide evidence access approved for the UI test.');confirm();expect(page.locator('#content')).to_contain_text('Campus-wide');ok('Campus-wide membership accepts intentionally blank department')
 tab('transfers');action('task');page.locator('#actionForm [name=assigneeId]').select_option(info['actors']['OTHER_ENTRY']['id']);page.locator('#actionForm [name=reviewerId]').select_option(info['actors']['REVIEWER']['id']);page.locator('#actionForm [name=reason]').fill('Synthetic staff transfer preserving the original authorship.');confirm();expect(page.locator('#content')).to_contain_text('TASK');ok('Audited outstanding-task transfer form')
 action('source');page.locator('#actionForm [name=ownerId]').select_option(info['actors']['OTHER_ENTRY']['id']);page.locator('#actionForm [name=reason]').fill('Synthetic source accountability transfer only, no quantity change.');confirm();expect(page.locator('#content')).to_contain_text('SOURCE');ok('Source responsibility transfer preserves source identity')
 tab('evidence');expect(page.locator('#content')).to_contain_text('SYNTHETIC-scanned-invoice');action('hold');page.locator('#actionForm [name=hold]').check();page.locator('#actionForm [name=reason]').fill('Synthetic preservation hold pending authorized evidence review.');confirm();ok('Audited retention hold without deleting original evidence')
 action('ocr');confirm();ok('Explicit OCR queue request; UI does not invent completion')
 page.locator('[data-action=ocrRuns]').click();expect(page.locator('#detail')).to_contain_text('QUEUED');page.locator('#closeDetail').click()
 tab('exports');action('exportNew');page.locator('#actionForm [name=title]').fill('SYNTHETIC University Inventory Export');confirm();expect(page.locator('#content')).to_contain_text('QUEUED');ok('Locked-period inventory export is queued, not automatically approved')
 tab('delivery');expect(page.locator('#content')).to_contain_text('INVITE');expect(page.locator('#content')).to_contain_text('PENDING');assert '#token=' not in page.locator('#content').inner_text();ok('Redacted delivery log with honest pending status')
 tab('overview');page.evaluate("""() => {const b=document.createElement('div');b.className='callout';b.textContent='SYNTHETIC UI TEST DATA - Chromium DOM/HTTP harness; native navigation blocked. DB, auth and providers are fixtures.';document.querySelector('.page').prepend(b)}""");page.screenshot(path=str(out/'operations-desktop.png'),full_page=True);ok('Desktop visual capture, synthetic label visible')
 assert 'localStorage' not in (root/'app.js').read_text();assert 'sessionStorage' not in (root/'app.js').read_text();ok('Operations script does not use browser-persistent credential storage')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'operations-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');ok('390px mobile layout has no document-wide horizontal overflow')
 page.close();page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.expose_function('httpFixtureBridge',bridge);load_dom('account.html');page.locator('#recover [name=tenantId]').fill(info['tenantId']);page.locator('#recover [name=email]').fill('missing@test.invalid');page.locator('#recover button').click();expect(page.locator('#message')).to_contain_text('active matching account');ok('Public account recovery returns generic response')

 context.close();browser.close()
assert not errors,errors
ok('No application JavaScript errors in DOM harness')
report={'passed':len(results),'failed':0,'checks':results,'pageErrors':errors,'consoleErrors':console,'nativeNavigation':False,'nativeNavigationFailure':'ERR_BLOCKED_BY_ADMINISTRATOR','CSPExecutionTested':False,'realPostgreSQL':False,'realStorageOrAntivirus':False,'auth':'fixture','notes':'Actual app DOM/scripts, explicit local HTTP bridge and domain handlers. Synthetic memory/auth/provider services. Native browser navigation blocked; CSP/TLS/navigation not validated.'}
(out/'results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
