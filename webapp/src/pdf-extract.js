import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Configure PDF.js worker for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export async function extractPdfText(file, onProgress) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  let text = `\n\n----- ${file.name} -----\n\n`

  for (let i = 1; i <= pdf.numPages; i++) {
    if (typeof onProgress === 'function') onProgress({ file: file.name, page: i, total: pdf.numPages })
    const page = await pdf.getPage(i)
    // Try extracting selectable text first
    const content = await page.getTextContent()
    let pageText = content.items
      .map((it) => (it && typeof it === 'object' && 'str' in it ? it.str : ''))
      .filter(Boolean)
      .join(' ')
      .trim()

    // If the page has very little or no selectable text, try OCR
    if (!pageText || pageText.length < 50) {
      try {
        // Render page to canvas at a decent scale for OCR
        const viewport = page.getViewport({ scale: 2.5 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        await page.render({ canvasContext: ctx, viewport }).promise

        // helper: quick check whether canvas contains any non-white pixels
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        let hasInk = false
        for (let p = 0; p < imageData.data.length; p += 4 * 50) { // sample pixels
          const r = imageData.data[p]
          const g = imageData.data[p + 1]
          const b = imageData.data[p + 2]
          if (r < 250 || g < 250 || b < 250) { hasInk = true; break }
        }

        if (!hasInk) {
          // nothing to OCR on this page
          console.debug('Page canvas appears blank — skipping OCR for page', i)
        } else {
          // Try a few ways to feed the image into tesseract, preferring direct canvas input
          async function tryRecognizeWith(w, input) {
            try {
              const res = await w.recognize(input)
              return res?.data?.text ?? res?.text ?? ''
            } catch (err) {
              return ''
            }
          }

          // Prefer dynamic import of tesseract.js (if installed) for worker-based OCR
          let ocrText = ''
          try {
            const mod = await import('tesseract.js')
            const createWorker = mod.createWorker ?? mod.default?.createWorker
            if (typeof createWorker === 'function') {
              const maybeWorker = createWorker()
              const worker = maybeWorker instanceof Promise ? await maybeWorker : maybeWorker

              // Try recognize directly first; fall back to legacy init only if necessary
              let resultText = ''
              if (typeof worker.recognize === 'function') {
                resultText = (await tryRecognizeWith(worker, canvas)) || (await tryRecognizeWith(worker, canvas.toDataURL()))
                if (!resultText) {
                  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
                  if (blob) {
                    const url = URL.createObjectURL(blob)
                    resultText = (await tryRecognizeWith(worker, url)) || ''
                    URL.revokeObjectURL(url)
                  }
                }
              }

              if (!resultText && typeof worker.load === 'function') {
                try {
                  await worker.load()
                  if (typeof worker.loadLanguage === 'function') await worker.loadLanguage('eng')
                  if (typeof worker.initialize === 'function') await worker.initialize('eng')
                  resultText = (await tryRecognizeWith(worker, canvas)) || (await tryRecognizeWith(worker, canvas.toDataURL()))
                  if (!resultText) {
                    const blob2 = await new Promise((res) => canvas.toBlob(res, 'image/png'))
                    if (blob2) {
                      const url2 = URL.createObjectURL(blob2)
                      resultText = (await tryRecognizeWith(worker, url2)) || ''
                      URL.revokeObjectURL(url2)
                    }
                  }
                } catch (initErr) {
                  console.warn('legacy worker init/recognize failed', initErr)
                }
              }

              ocrText = (resultText || '').trim()

              if (typeof worker.terminate === 'function') await worker.terminate()

            } else if (typeof mod.recognize === 'function') {
              // Some builds expose a top-level recognize() helper
              const res = await mod.recognize(canvas, 'eng')
              ocrText = (res?.data?.text ?? res?.text ?? '').trim()
            } else if (mod.default && typeof mod.default.recognize === 'function') {
              const res = await mod.default.recognize(canvas, 'eng')
              ocrText = (res?.data?.text ?? res?.text ?? '').trim()
            } else {
              console.warn('tesseract.js imported but no suitable API found; skipping OCR for this page')
            }
          } catch (e) {
            if (typeof window !== 'undefined' && window.Tesseract && typeof window.Tesseract.recognize === 'function') {
              try {
                const { data: { text: ttext } } = await window.Tesseract.recognize(canvas, 'eng')
                ocrText = (ttext || '').trim()
              } catch (err) {
                console.warn('window.Tesseract OCR failed for page', i, err)
              }
            } else {
              console.warn('tesseract.js not available; skipping OCR for this page', e)
            }
          }

          if (ocrText) {
            pageText = pageText ? pageText + '\n' + ocrText : ocrText
          }
        }
      } catch (ocrErr) {
        console.error('OCR error for page', i, ocrErr)
      }
    }

    text += pageText + '\n'
  }
  return text.trim() + '\n'
}
