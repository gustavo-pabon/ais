# Edge Anonymizer (Browser-only Option B)

A minimal PWA that runs PII anonymization **entirely in the browser**:

- Text regex pass (emails/phones/SSN/cards, I-94, names, etc.)
- In-browser NER via `@xenova/transformers` (English/Spanish), with noise filtering
- OCR via `tesseract.js` for images/scans
- PDF rasterization + burn-in redactions using PDF.js + pdf-lib
- Offline-capable via a service worker

## Run
Serve via a local web server (not `file://`), e.g.:
- `npx serve -l 5173 .`
- `python -m http.server 5173`

Open `http://localhost:5173` and load `index.html`. Hard refresh if updates don't appear.

## Detectors (highlights)
- Names via labels (`For:`, `Last/Surname:`, `First (Given) Name:`) + NER
- I‑94 (labeled, 9–15 alphanumeric), USCIS case (IOE/EAC/WAC/LIN/SRC/MSC/NBC/YSC + 10 digits)
- DOB and Arrival/Admit dates (spelled-month formats)
- Document Number (6–12 alphanum), Country of Citizenship
- Emails, phones (tighter), SSN, credit cards (keeps last 4), URLs, OMB No.
