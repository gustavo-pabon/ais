// PDF extraction + burn-in redaction scaffolding
export async function extractPdfText(arrayBuffer){
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer }).promise;
  let text = '';
  const spansByPage = {};
  for (let i=1; i<=pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    text += pageText + '\n';
    const viewport = page.getViewport({ scale: 2.0 });
    const boxes = content.items.map(it => {
      const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
      const x = tx[4], y = tx[5] - it.height;
      return { x, y, w: it.width, h: it.height };
    });
    spansByPage[i-1] = boxes; // TODO: restrict to PII spans only
  }
  return { text, spansByPage };
}

export async function redactPdf(arrayBuffer, spansByPage){
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer }).promise;
  const outDoc = await PDFLib.PDFDocument.create();

  for (let i=1; i<=pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Draw redaction boxes (currently draws all text boxes; replace with PII boxes after mapping)
    (spansByPage[i-1] || []).forEach(b => {
      ctx.fillStyle = 'black';
      ctx.fillRect(b.x, canvas.height - b.y - b.h, b.w, b.h); // invert y
    });

    const pngBytes = await new Promise(res => canvas.toBlob(async blob => {
      const arr = await blob.arrayBuffer(); res(arr);
    }, 'image/png'));

    const pdfPage = outDoc.addPage();
    const png = await outDoc.embedPng(pngBytes);
    pdfPage.setSize(png.width, png.height);
    pdfPage.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
  }
  const bytes = await outDoc.save();
  return bytes;
}
