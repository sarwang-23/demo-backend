#!/usr/bin/env python3
"""Opt-in, bounded ENGLISH printed-text OCR. Invoked after CLEAN antivirus status.
Original bytes are never rewritten. Text, word boxes and raw engine confidence
are suggestions for human review, not probabilities of field correctness.
"""
from __future__ import annotations
import csv, io, json, os, re, struct, subprocess, sys, tempfile, time
from pathlib import Path
from document_parser import pdf, InputError, reject
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES, MAX_PIXELS, MAX_TEXT = 10, 20_000_000, 250_000

def limits():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024**2, 768 * 1024**2))
        resource.setrlimit(resource.RLIMIT_CPU, (65, 68))
        resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024**2, 24 * 1024**2))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ImportError, ValueError, OSError):
        pass

def image_size(data: bytes, kind: str):
    if kind == 'png':
        if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n': reject('INVALID_IMAGE', 'Invalid PNG image.')
        return struct.unpack('>II', data[16:24])
    if data[:3] != b'\xff\xd8\xff': reject('INVALID_IMAGE', 'Invalid JPEG image.')
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 255: break
        while pos < len(data) and data[pos] == 255: pos += 1
        if pos >= len(data): break
        marker = data[pos]; pos += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7: continue
        if pos + 2 > len(data): break
        size = int.from_bytes(data[pos:pos+2], 'big')
        if size < 2 or pos + size > len(data): break
        if marker in (0xC0, 0xC1, 0xC2):
            if size < 7: break
            h, w = struct.unpack('>HH', data[pos+3:pos+7]); return w, h
        pos += size
    reject('INVALID_IMAGE', 'Unsupported or damaged JPEG dimensions.')

def read_tsv(raw: str, page: int):
    words, lines = [], {}
    for row in csv.DictReader(io.StringIO(raw), delimiter='\t'):
        text = (row.get('text') or '').strip()
        if row.get('level') != '5' or not text: continue
        if len(words) >= 15000: reject('OCR_TEXT_LIMIT', 'OCR word count exceeds the bounded review size.')
        try:
            conf = float(row['conf'])
            box = [int(row[k]) for k in ('left', 'top', 'width', 'height')]
            group = tuple(row[k] for k in ('block_num', 'par_num', 'line_num'))
        except (ValueError, KeyError): continue
        if conf < 0 or conf > 100 or any(v < 0 for v in box): continue
        words.append({'text': text, 'page': page, 'boxPx': box, 'engineConfidence': conf})
        lines.setdefault(group, []).append(text)
    text = '\n'.join(' '.join(line) for line in lines.values())
    if len(text) > MAX_TEXT: reject('OCR_TEXT_LIMIT', 'OCR text exceeds the review limit.')
    return text, words

def ocr(data: bytes, kind: str):
    if not data or len(data) > MAX_BYTES: reject('FILE_SIZE', 'OCR input must be 1 byte to 10 MiB.')
    if kind not in ('pdf', 'png', 'jpeg'): reject('OCR_TYPE', 'Unsupported OCR input type.')
    started = time.monotonic()
    initial = pdf(data) if kind == 'pdf' else {'pages': [{'page': 1, 'text': '', 'status': 'MANUAL_REQUIRED'}], 'pageCount': 1}
    if initial['pageCount'] > MAX_PAGES: reject('OCR_PAGE_LIMIT', 'OCR supports at most 10 pages per request. Split the document before uploading.')
    if kind != 'pdf':
        w, h = image_size(data, kind)
        if not w or not h or w*h > MAX_PIXELS: reject('OCR_PIXEL_LIMIT', 'Image exceeds the 20 megapixel OCR safety limit.')
    with tempfile.TemporaryDirectory(prefix='cs-ocr-') as directory:
        original = os.path.join(directory, 'original.' + kind)
        Path(original).write_bytes(data)
        output_pages, used_ocr = [], 0
        engine = subprocess.run(['tesseract', '--version'], capture_output=True, timeout=5, check=True).stdout.decode('utf-8', errors='replace').splitlines()[0]
        for page in initial['pages']:
            if len(page['text'].strip()) >= 20:
                output_pages.append({**page, 'method': 'TEXT_LAYER', 'words': []})
                continue  # Never overwrite a usable native text layer with OCR.
            if time.monotonic() - started > 65: reject('OCR_TIMEOUT', 'OCR time budget exceeded. Use fewer pages or review manually.')
            number = page['page']; image = original
            if kind == 'pdf':
                prefix = os.path.join(directory, f'page-{number}')
                proc = subprocess.run(['pdftoppm', '-f', str(number), '-l', str(number), '-singlefile', '-scale-to', '2500', '-png', original, prefix], capture_output=True, timeout=12)
                if proc.returncode: reject('OCR_RENDER_FAILED', 'This PDF page could not be rendered safely.')
                image = prefix + '.png'
            target = os.path.join(directory, f'text-{number}')
            proc = subprocess.run(['tesseract', image, target, '-l', 'eng', '--psm', '6', 'tsv'], capture_output=True, timeout=20)
            if proc.returncode: reject('OCR_ENGINE_FAILED', 'English OCR failed. Check the language data, then retry or use manual review.')
            data_tsv = Path(target + '.tsv').read_bytes()
            if len(data_tsv) > 8*1024*1024: reject('OCR_TEXT_LIMIT', 'OCR output exceeds the limit.')
            text, words = read_tsv(data_tsv.decode('utf-8', errors='replace'), number)
            output_pages.append({'page': number, 'text': text, 'status': 'OCR_REVIEW' if text else 'MANUAL_REQUIRED', 'method': 'TESSERACT_ENGLISH', 'words': words, 'coordinateSpace': 'rendered-image-pixels', 'renderMaxDimension': 2500 if kind == 'pdf' else None})
            used_ocr += 1
        if sum(len(p['text']) for p in output_pages) > MAX_TEXT: reject('OCR_TEXT_LIMIT', 'Combined OCR text exceeds the review limit.')
        return {'kind': 'INVOICE', 'method': 'TESSERACT_ENGLISH_REVIEW', 'pageCount': len(output_pages), 'pages': output_pages,
                'engine': engine, 'language': 'eng', 'ocrPages': used_ocr, 'ocrAvailable': True, 'needsHumanReview': True,
                'warnings': ['Local English printed-text OCR is not accounting validation. Review EVERY consumption value, unit, date and source against the original.',
                             'Word engineConfidence is not a calibrated probability that an invoice field is correct. Handwriting, non-English and complex layouts may require manual entry.']}

def main():
    limits()
    try:
        data = sys.stdin.buffer.read(MAX_BYTES+1)
        result = ocr(data, sys.argv[1])
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=True))
    except InputError as e:
        print(json.dumps({'ok': False, 'error': {'code': e.code, 'message': e.message}}))
    except subprocess.TimeoutExpired:
        print(json.dumps({'ok': False, 'error': {'code': 'OCR_TIMEOUT', 'message': 'OCR timed out. Review manually or split the file.'}}))
    except (FileNotFoundError, subprocess.CalledProcessError):
        print(json.dumps({'ok': False, 'error': {'code': 'OCR_UNAVAILABLE', 'message': 'Install Tesseract English and Poppler in the worker.'}}))
    except Exception:
        print(json.dumps({'ok': False, 'error': {'code': 'OCR_FAILED', 'message': 'OCR failed safely; the original remains unchanged.'}}))
if __name__ == '__main__': main()
