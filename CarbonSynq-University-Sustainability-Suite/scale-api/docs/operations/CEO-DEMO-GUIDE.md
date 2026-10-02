# CEO demo guide - Hinglish

## Pehle kya taiyar karna hai

Actual Docker/staging setup ko pehle chalao. Ek isolated university use karo aur synthetic data/factors ko clearly label karo. Basic provisioning ke baad sources, boundaries, sample KPI tasks, approved illustrative factors, entry user, separate reviewer aur leadership account prepare karo. Synthetic factors ko official factor mat bolo.

Ops workspace: `/operations`. Main university: `/university`. Excel + invoice intake: `/university/imports`. Root npm start se purana SQLite demo khulta hai, naya system nahi.

## Suggested presentation flow

1. Main university console mein manual entry aur Scope 1/2 sources dikhao. Entry aur approval roles alag rakho.
2. Intake mein messy Excel upload karo, header/column mapping dikhao, MWh-to-kWh conversion aur ambiguous date correction explain karo. 5-6 readable PDFs ko per-file status ke saath upload karo.
3. Ek clearly readable English scanned invoice ko live antivirus CLEAN hone do. Request English OCR dabao, worker result ka wait karo, refresh/normalize again aur quantity/unit/date original se verify karo. OCR failure ho toh manual correction honest fallback hai.
4. READY rows ko drafts mein import karo; separate reviewer se approve/calculate karao. Location aur market Scope 2 alternatives ko add mat karo.
5. Operations -> People & access: invite ya evidence membership dikhao. Mail capture mode ho toh seedha bolo: message local capture hai, real email nahi. Same-university ENTRY ko unshared evidence na milna aur explicit share/grant se access milna demonstrate karo.
6. Responsibility screen se open task/source ownership transfer karo. Previous author/history unchanged dikhao. My inbox mein assignment/review update aur preferences dikhao.
7. Reporting period lock karo. Inventory export queue karo, worker ko READY tak pahunchne do, separate reviewer se exact bytes inspect/approve karao; leadership account se final CSV/JSONL download karo. Yeh inventory export hai, full compliance certificate nahi.
8. Restart ke baad saved records aur original evidence dobara verify karo. Yeh step presentation se pehle rehearsal mein zaroor karo.

## Important boundaries ko sahi tarah present karo

New code mein English OCR hai; old guides ka no-OCR note older release ke liye tha. Handwritten/non-English scans automatic guarantee nahi hain. Email provider, actual PostgreSQL/S3/ClamAV integration, native browser/CSP, backup restore, load/security acceptance yahan verified nahi hain. SSO/MFA aur automatic retention deletion/redaction implemented nahi hain.

Demo mein fake pending jobs ko COMPLETE mark mat karo, scanner disable mat karo, aur approval separation weaken mat karo. Failure ka recoverable status dikhana fabricated success se better hai.
