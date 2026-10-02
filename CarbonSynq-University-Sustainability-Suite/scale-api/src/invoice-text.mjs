// Reused conservative parser, executed ONLY in a bounded worker thread after scanning.
import { inflateSync } from "node:zlib";
function ascii85(value) {
    const s = value.toString('latin1').replace(/\s/g, '').replace(/^<~/, '').replace(/~>$/, '');
    const out = [];
    let group = [];
    for (const c of s) {
        if (c === 'z' && group.length === 0) {
            out.push(0, 0, 0, 0);
            continue;
        }
        const v = c.charCodeAt(0) - 33;
        if (v < 0 || v > 84)
            throw new Error('Unsupported ASCII85');
        group.push(v);
        if (group.length === 5) {
            let n = group.reduce((a, b) => a * 85 + b, 0);
            out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
            group = [];
        }
    }
    if (group.length > 1) {
        const count = group.length;
        while (group.length < 5)
            group.push(84);
        const n = group.reduce((a, b) => a * 85 + b, 0);
        out.push(...[(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].slice(0, count - 1));
    }
    return Buffer.from(out);
}
function literalStrings(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] !== '(')
            continue;
        let result = '';
        let depth = 1;
        while (++i < s.length && depth) {
            let c = s[i];
            if (c === '\\') {
                c = s[++i];
                if (c === undefined)
                    break;
                if (/[0-7]/.test(c)) {
                    let oct = c;
                    for (let j = 0; j < 2 && /[0-7]/.test(s[i + 1] ?? 'x'); j++)
                        oct += s[++i];
                    result += String.fromCharCode(parseInt(oct, 8));
                }
                else if (c === 'n' || c === 'r')
                    result += ' ';
                else if (c === 't')
                    result += ' ';
                else if (c === '\r') {
                    if (s[i + 1] === '\n')
                        i++;
                }
                else if (c !== '\n')
                    result += c;
            }
            else if (c === '(') {
                depth++;
                result += c;
            }
            else if (c === ')') {
                depth--;
                if (depth)
                    result += c;
            }
            else
                result += c;
        }
        if (result.trim())
            out.push(result);
    }
    return out;
}
/** Conservative text-only parser: standard-font, unencrypted PDF content streams.
 * It deliberately does not claim OCR, font-CMap support, table recognition or universal PDF coverage.
 * Complex/scanned files remain usable as evidence and require manual field review.
 */
export function basicPdfText(bytes) {
    const raw = bytes.toString('latin1');
    if (/\/Encrypt\b|\/ToUnicode\b|\/Subtype\s*\/Type0\b/.test(raw))
        return '';
    const pieces = [];
    let matches = 0;
    let expanded = 0;
    const pattern = /\bstream\r?\n/g;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
        if (++matches > 100)
            break;
        const end = raw.indexOf('endstream', pattern.lastIndex);
        if (end === -1)
            break;
        const start = pattern.lastIndex;
        pattern.lastIndex = end + 9;
        const header = raw.slice(Math.max(0, match.index - 2048), match.index);
        const dictionary = header.slice(header.lastIndexOf('<<'));
        if (/\/Subtype\s*\/Image/.test(dictionary))
            continue;
        let stream = Buffer.from(raw.slice(start, end).replace(/\r?\n$/, ''), 'latin1');
        try {
            if (/\/ASCII85Decode/.test(dictionary))
                stream = ascii85(stream);
            if (/\/FlateDecode/.test(dictionary))
                stream = inflateSync(stream, { maxOutputLength: 1024 * 1024 });
            if (/\/Filter/.test(dictionary) && !/\/FlateDecode|\/ASCII85Decode/.test(dictionary))
                continue;
            expanded += stream.length;
            if (expanded > 2 * 1024 * 1024)
                break;
            const content = stream.toString('latin1');
            for (const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g))
                pieces.push(...literalStrings(block[1]));
        }
        catch { /* Unsupported stream: never fabricate extracted fields. */ }
    }
    return pieces.join('\n').slice(0, 100000);
}
export function parseInvoiceText(raw) {
    const source = raw.replace(/\r/g, '').slice(0, 100000);
    const fields = {};
    const warnings = [];
    const take = (regex) => source.match(regex)?.[1]?.trim();
    const vendor = take(/(?:^|\n)\s*(?:vendor|supplier|billed by)\s*:\s*([^\n]{2,150})/i);
    const invoiceNumber = take(/(?:invoice|bill)\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_.-]{1,79})/i);
    const invoiceDate = take(/(?:invoice date|bill date|date)\s*:\s*(\d{4}-\d{2}-\d{2})/i);
    if (vendor)
        fields.vendor = vendor;
    if (invoiceNumber)
        fields.invoiceNumber = invoiceNumber;
    if (invoiceDate && Number.isFinite(Date.parse(invoiceDate)) && new Date(invoiceDate).toISOString().slice(0, 10) === invoiceDate)
        fields.activityDate = invoiceDate;
    const quantityMatches = [...source.matchAll(/(?:units consumed|energy consumed|consumption|fuel quantity|quantity)\s*[:=\-]?\s*([\d,]+(?:\.\d{1,4})?)\s*(kwh|mwh|litres?|liters?|ltr|kg|m3|m\u00b3)\b/gi)];
    if (quantityMatches.length === 1) {
        const match = quantityMatches[0];
        let quantity = Number(match[1].replaceAll(',', ''));
        let unit = match[2].toLowerCase();
        if (unit === 'mwh') {
            quantity *= 1000;
            unit = 'kWh';
            warnings.push('MWh was converted to kWh. Confirm the conversion.');
        }
        else if (unit === 'kwh')
            unit = 'kWh';
        else if (/lit|ltr/.test(unit))
            unit = 'litre';
        else if (unit === 'm\u00b3')
            unit = 'm3';
        if (Number.isFinite(quantity) && quantity > 0 && quantity <= 1e9) {
            fields.quantity = quantity;
            fields.unit = unit;
        }
        if (unit === 'kWh')
            fields.category = 'PURCHASED_ELECTRICITY';
        else if (unit === 'kg' && /\bLPG\b/i.test(source))
            fields.category = 'LPG';
        else if (unit === 'm3' && /natural gas/i.test(source))
            fields.category = 'NATURAL_GAS';
        else if (unit === 'litre') {
            const diesel = /\bdiesel\b/i.test(source);
            const petrol = /\bpetrol\b/i.test(source);
            if (diesel !== petrol)
                fields.category = diesel ? 'DIESEL' : 'PETROL';
        }
    }
    else if (quantityMatches.length > 1)
        warnings.push('Multiple consumption lines found. No quantity was selected; manually confirm a single activity.');
    const amountMatches = [...source.matchAll(/(?:total amount|amount payable|grand total|bill amount)\s*[:=]?\s*(?:INR|Rs\.?|\u20b9)?\s*([\d,]+(?:\.\d{1,2})?)/gi)];
    if (amountMatches.length === 1) {
        const amount = Number(amountMatches[0][1].replaceAll(',', ''));
        if (Number.isFinite(amount) && amount >= 0)
            fields.amountInr = amount;
    }
    if (!fields.quantity)
        warnings.push('Consumption quantity was not identified. Money is NEVER substituted for consumption.');
    if (!fields.category)
        warnings.push('Select and verify the activity category.');
    warnings.push('Extracted fields are suggestions. A person must check the original invoice before creating a draft.');
    return { fields, warnings };
}
export function extractInvoice(bytes, mimeType) {
    const raw = mimeType === 'text/plain' ? bytes.toString('utf8') : mimeType === 'application/pdf' ? basicPdfText(bytes) : '';
    const parsed = parseInvoiceText(raw);
    return { method: raw ? (mimeType === 'application/pdf' ? 'BASIC_PDF_TEXT' : 'TEXT_INVOICE') : 'MANUAL_REVIEW', ...parsed,
        textPreview: raw.slice(0, 12000), fieldsDetected: Object.keys(parsed.fields), needsHumanReview: true, ocrAvailable: false,
        ...(raw ? {} : { warnings: ['This image, scan or PDF layout needs manual entry. The original file is preserved as evidence.', ...parsed.warnings] }) };
}
