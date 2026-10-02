# CarbonSynq - CEO Demo Runbook

## Demo se pehle

ZIP ko extract karo. `START-BACKEND.cmd` kholo, terminal open rehne do, browser mein `http://localhost:5050` kholo. Node 22.16+ (22.x) ya 24+ chahiye. New demo ke liye npm install, API key ya Neon credentials nahi chahiye.

Sab demo logins ka password `Demo@12345` hai. Admin: `admin@carbonsynq.demo`, entry: `entry@carbonsynq.demo`, reviewer: `reviewer@carbonsynq.demo`, CEO: `ceo@carbonsynq.demo`.

Presentation se pehle ek rehearsal karo. Fresh dataset chahiye toh server stop karke `npm run reset -- --confirm-local-demo-reset` chalao, phir `npm start`. Purana data timestamped backup folder mein preserve hota hai.

## 1. Opening: problem aur value

"University ki electricity aur fuel consumption alag teams ke paas hoti hai. CarbonSynq mein manual entry aur invoice evidence ek workflow mein aate hain. Reviewer quantity verify karta hai; uske baad hi calculation leadership dashboard mein dikhti hai."

"Aaj jo university, historical data aur emission factors dikh rahe hain woh demonstration ke liye synthetic/illustrative hain. Ye actual university audit result nahi hai."

Admin ke Overview mein do campuses, activity records, pending review aur Scope 1/2 dikhao. Fresh seed mein 38 records hain: 36 calculated, 1 draft, 1 submitted. Calculated total 289.3398 tCO2e hai; screen ise rounded dikhati hai.

## 2. Manual entry: data team ka flow

Administrator ya Data entry se **Manual entry** kholo:

| Field | Demo input |
| --- | --- |
| Period | FY 2026-27 |
| Activity date | 2026-10-02 |
| Campus | North Campus |
| Building | Academic Block |
| Category | Purchased electricity |
| Quantity | 1250 |
| Unit | kWh (automatic) |
| Description | CEO DEMO - manual meter reading |

**Preview estimate** dabao. Calculation 1,250 x 0.71 = 887.5 kgCO2e hogi. **Save draft** karo. Dashboard total abhi change nahi hoga. Activity ledger mein isi record ko **Submit** karo.

"Draft ya unverified entry ko hum final emissions mein count nahi kar rahe."

## 3. Separate reviewer: control dikhao

**Switch role -> Reviewer**. Review queue mein apne date/quantity/description wale record ko kholo. Fresh seed ka ek aur submitted record bhi ho sakta hai; apni 1,250 kWh entry hi select karo.

**Review -> Verify -> Calculate**.

"Entry banane wala apni entry approve nahi kar sakta, admin bhi nahi. Original quantity aur factor version ke saath calculation save hoti hai. Calculate ko repeat karne par double counting nahi hoti."

Ab dashboard mein 0.8875 tCO2e add hua. Sirf yahi new manual record calculate kiya ho toh total 290.2273 tCO2e hai.

## 4. Invoice evidence: main feature

Admin par switch karo. **Invoice evidence -> Choose invoice**. ZIP ke `samples/sample-electricity.pdf` ko upload karo. Page par sample download link bhi available hai.

Left pane mein readable PDF text dikhega. **Open original PDF preview** expand karo ya **Download original** se original check karo. Preview browser par depend karta hai; readable text original layout nahi hai. Verify these fields against the original:

| Field | Expected suggestion / input |
| --- | --- |
| Vendor | Greenfield Utilities (Demo) |
| Invoice number | DEMO-ELEC-2026-0930 |
| Date | 2026-09-30 |
| Category | Purchased electricity |
| Quantity | 12500 |
| Unit | kWh |
| Invoice amount | INR 112500 |
| Campus / building | North Campus / Academic Block - select explicitly |

"Rupee amount aur consumption alag fields hain. Carbon calculation 12,500 kWh se hogi, 1,12,500 rupees se nahi. Text extraction sirf suggestion hai; confirmation mandatory hai."

Confirmation checkbox tick karo -> **Confirm review & create draft**. Activity ledger se submit karo. Reviewer se Review -> Verify -> Calculate. This invoice adds **8.875 tCO2e** with the illustrative factor.

Sirf upar ke do records add kiye ho aur seed ke pending records calculate nahi kiye ho, toh total **299.1023 tCO2e**, calculated records **38**, invoice-backed calculated records **1** honge. UI evidence coverage lagbhag **2.6%** dikhaegi. Extra rehearsal activity ho toh total naturally alag hoga.

Same PDF dubara upload karke duplicate protection bhi dikha sakte ho: existing invoice khulega, extra emissions create nahi honge.

## 5. Scanned invoice fallback

Optional: `samples/scanned-electricity.png` upload karo.

"Scan ko evidence ki tarah securely save karte hain. Is local demo mein AI OCR connected nahi hai, isliye system values guess nahi karta. Reviewer actual invoice se fields enter karega."

Manually enter: Campus Energy Services (Demo), DEMO-SCAN-2026-1001, 2026-10-01, purchased electricity, 9800 kWh, INR 88200, South Campus / Student Hostel. Review confirm karke draft banao. Unverified draft emissions mein count nahi hota.

For the diesel PDF: Campus Fuels (Demo), DEMO-DIESEL-2026-0930, 2026-09-30, Diesel, 220 litre, INR 20460, South Campus / Engineering Block. Demo estimate: 589.6 kgCO2e.

## 6. CEO view aur close

Leadership / CEO account kholo. Read-only dashboard par campus filter, Scope 1/2, category contribution aur evidence coverage dikhao. **Reports & factors** par illustrative factor provenance aur CSV/JSON exports dikhao. **Audit trail** par entry, submission, verification, calculation aur invoice events dikhao.

"Leadership ko ek traceable summary milti hai: kis campus ka data hai, evidence kya hai, kisne enter/verify kiya, kaunsa factor use hua aur final calculated result kya hai."

Close honestly: "Ye working local demo hai. Real rollout mein approved emission factors, identity/SSO, production database/object storage, scanning/OCR provider, backup policy aur existing backend integration validate karenge."

## Avoid during presentation

Do not claim these are official emission factors, that uploaded scans undergo AI OCR, that this is production certified, or that the original Neon deployment has been upgraded. Do not run the original database seeder against live data. Do not put real confidential invoices into a rehearsal package intended for sharing.
