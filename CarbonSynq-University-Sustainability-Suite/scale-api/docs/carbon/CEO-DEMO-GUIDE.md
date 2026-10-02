# CEO walkthrough - Scope 1 and Scope 2

## Pehle setup aur honesty

Yeh release candidate hai. Screenshot aur offline `carbon:demo` data synthetic hai; in values ko university ka actual carbon footprint mat bolna. Real workspace mein factor catalog aur measured records automatically seeded nahi hain.

Live-stack rehearsal ke liye `UPGRADE.md` follow karo. Login ke liye provisioning command se nikla tenant ID aur credentials chahiye. Root ka purana SQLite demo alag hai. Naya screen: `http://localhost:8080/university` -> **Scope 1 & 2**.

## Meeting se pehle

Ek clean OPEN reporting period rakho. Admin, data-entry aur reviewer accounts alag rakho. Existing invoice/document flow mein anonymized evidence upload karo; scan CLEAN aur storage complete hone do. Document IDs note karo. Sources ke liye DG/boiler fuel aur campus electricity import choose karo. Real factors sirf qualified reviewer ke approved source se register karo.

**Ek person apni entry, factor ya boundary approve nahi kar sakta.** Admin ke paas bhi self-approval bypass nahi hai. UI mein returned current `version` use hoti hai; API client ko bhi wahi karna hai.

## 7-step presentation

1. **Campus accountability:** source register dikhao - campus, source, owner, fuel/energy unit aur active period.
2. **Clear boundary:** included/excluded/no-activity sources aur eight-category checklist dikhao. Kisi missing source ko zero nahi maana jata. Reviewer se boundary approve karao.
3. **Scope 1:** fuel stock calculator dikhao. Example, sirf illustration: opening100 + received200 - closing20 = 280 litres consumed. Invoice ki INR amount fuel quantity nahi banti. Actual record review ke baad calculate hota hai.
4. **Scope 2:** same energy consumption ka location-based aur market-based alternative dikhao. Certificate/PPA allocation sirf approved evidence se; unmatched energy ka fallback factor zaroori hai. Dono totals ko add nahi karte.
5. **Accountability before report:** source-coverage dates, pending approval aur corrective actions dikhao. HIGH finding close nahi hui toh final readiness fail rahegi.
6. **Evidence and correction:** calculated record kholo - source, original quantity method, factor/GWP versions aur evidence. Galat approved entry delete nahi hoti; separate reviewed void aur replacement chain banti hai.
7. **Leadership report:** ready period lock karo, frozen report generate karo, separate reviewer approve kare, JSON/CSV/printable HTML export dikhao. Market/location alternatives aur biogenic CO2 separate hain.

## Offline arithmetic rehearsal

```bash
cd scale-api
npm run carbon:demo
```

This executable example uses a disposable memory store, synthetic evidence and factors only. It verifies two source records through separate approvals. Expected synthetic outputs:

- Scope 1: 2,680 kgCO2e.
- Scope 2 location: 70,000 kgCO2e.
- Scope 2 market: 54,000 kgCO2e.
- Scope 1 + 2 location: 72,680 kgCO2e.
- Scope 1 + 2 market alternative: 56,680 kgCO2e.

Market allocation example: 40,000 kWh at a synthetic zero contract factor plus 60,000 kWh at synthetic 0.9 gives 54,000 kgCO2e. The synthetic location factor is 0.7 for 100,000 kWh. These numbers are not an official grid or supplier method and must never be reused as real approved factors.

## CEO ke saamne kya claim nahi karna

'AI automatically verified the invoice', 'all universities compliant', 'certificates registry verified', 'production load tested', 'net-zero achieved' aur 'every possible source included' mat bolna. Implemented workflow aur measured test results dikhao. Live infrastructure, applicable factors aur university-specific boundary acceptance pending ho toh openly mark karo.
