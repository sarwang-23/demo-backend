# Synthetic import rehearsal files

All names, amounts and consumption are invented. These are not real invoices or approved factors.

- `University-Messy-Data.xlsx`: title rows, a repeated header, DMY dates, explicit MWh conversion; row 10 subtotal excluded. The Wide diesel sheet needs a separate diesel source/factor. Needs review intentionally requires corrections.
- `University-Comma-Decimal.csv`: select DMY and DECIMAL_COMMA.
- `University-Ready-Format.csv`: simple mapping rehearsal.
- `invoices/Demo-Invoice-01.pdf` through `06.pdf`: select all six files in one invoice batch.
- `Six-Invoices-One-PDF.pdf`: same six invoices in one PDF. Do not import again after importing the individual files; duplicate identity should block them.
- `Image-Only-Manual-Review.pdf`: no text layer; manually enter consumption, period, invoice identity and source, never fabricate OCR.

Use a synthetic isolated tenant and reviewed illustrative factors. Select or override source IDs to match your actual demo setup. Each scenario should use a clean period/source unless testing duplicates.

- `Normalized-Example.xlsx`: actual normalization-only example output, including visibly skipped header/subtotal rows. It contains no database import or approved emissions.
