import { anonymizeText } from './anonymize.js';
import { ocrImage } from './ocr.js';
import { extractPdfText, redactPdf } from './pdf-redact.js';

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

// Simple UI logger
function log(msg, isError=false){
  const el = document.getElementById('anonPreview');
  el.textContent = (el.textContent ? el.textContent + '\n' : '') + (isError ? '⚠️ ' : '') + msg;
  if (isError) console.error(msg);
}

const fileInput = document.getElementById('fileInput');
const textInput = document.getElementById('textInput');
const btnAnonText = document.getElementById('btnAnonText');
const btnProcessFiles = document.getElementById('btnProcessFiles');
const chkSpanish = document.getElementById('chkSpanish');
const chkRasterizePDF = document.getElementById('chkRasterizePDF');
const origPreview = document.getElementById('origPreview');
const anonPreview = document.getElementById('anonPreview');
const downloadList = document.getElementById('downloadList');
const dropzone = document.getElementById('dropzone');

dropzone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropzone.classList.add('hover'); });
dropzone.addEventListener('dragleave', ()=>dropzone.classList.remove('hover'));
dropzone.addEventListener('drop', (e)=>{
  e.preventDefault();
  dropzone.classList.remove('hover');
  handleFiles(e.dataTransfer.files);
});
dropzone.addEventListener('click', ()=>fileInput.click());
fileInput.addEventListener('change', ()=>handleFiles(fileInput.files));

btnAnonText.addEventListener('click', async ()=>{
  try{
    const raw = textInput.value || '';
    origPreview.textContent = raw;
    anonPreview.textContent = 'Working...';
    const anon = await anonymizeText(raw, { preferSpanish: chkSpanish.checked });
    anonPreview.textContent = anon;
  } catch(err){
    log('Error anonymizing text: ' + (err?.message || err), true);
  }
});

btnProcessFiles.addEventListener('click', async ()=>{
  await handleFiles(fileInput.files);
});

async function handleFiles(fileList){
  try{
    if (!fileList || fileList.length === 0){
      log('No files selected.');
      return;
    }
    downloadList.innerHTML = '';
    anonPreview.textContent = '';
    origPreview.textContent = '';
    const files = Array.from(fileList); // robust iteration
    for (const f of files){
      log(`Processing: ${f.name}`);
      const ab = await f.arrayBuffer();
      const name = f.name || 'file';
      const dotIdx = name.lastIndexOf('.');
      const ext = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
      if (ext === 'txt'){
        const raw = new TextDecoder().decode(new Uint8Array(ab));
        origPreview.textContent = raw;
        const anon = await anonymizeText(raw, { preferSpanish: chkSpanish.checked });
        anonPreview.textContent = anon;
        appendJSONDownload(name.replace(/\.txt$/i,'-anonymized.json'), { text_anonymized: anon, doc_type: 'txt' });
      } else if (ext === 'pdf'){
        const { text, spansByPage } = await extractPdfText(ab.slice(0));
        origPreview.textContent = text.slice(0, 20000);
        const anon = await anonymizeText(text, { preferSpanish: chkSpanish.checked });
        anonPreview.textContent = anon.slice(0, 20000);

        if (chkRasterizePDF.checked){
          const redactedBytes = await redactPdf(ab.slice(0), spansByPage);
          appendBlobDownload(name.replace(/\.pdf$/i,'-redacted.pdf'), new Blob([redactedBytes], { type: 'application/pdf'}));
        }
        appendJSONDownload(name.replace(/\.pdf$/i,'-anonymized.json'), { text_anonymized: anon, doc_type: 'pdf' });
      } else if (ext === 'docx'){
        origPreview.textContent = '(DOCX preview omitted)';
        anonPreview.textContent = 'DOCX extraction not yet wired for local-only mode. Paste text or use PDF for now.';
        appendJSONDownload(name.replace(/\.docx$/i,'-TODO.txt'), { note: 'Integrate mammoth or docx-wasm to extract text client-side.' });
      } else if (f.type && f.type.startsWith('image/')){
        const { text } = await ocrImage(ab);
        origPreview.textContent = text.slice(0, 20000);
        const anon = await anonymizeText(text, { preferSpanish: chkSpanish.checked });
        anonPreview.textContent = anon.slice(0, 20000);
        appendJSONDownload(name.replace(/\.[^.]+$/,'-anonymized.json'), { text_anonymized: anon, doc_type: 'image' });
      } else {
        log(`Unsupported file type: ${name}`, true);
        appendJSONDownload(name + '.unsupported.txt', { note: 'Unsupported file type' });
      }
      log(`Done: ${f.name}`);
    }
  } catch(err){
    log('Error processing files: ' + (err?.message || err), true);
  }
}

function appendBlobDownload(filename, blob){
  const url = URL.createObjectURL(blob);
  const li = document.createElement('li');
  li.innerHTML = `<a class="dl" download="${filename}" href="${url}">Download ${filename}</a>`;
  downloadList.appendChild(li);
}
function appendJSONDownload(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  appendBlobDownload(filename, blob);
}

// Global error capture for visibility
window.addEventListener('error', (e)=> log('Runtime error: ' + e.message, true));
window.addEventListener('unhandledrejection', (e)=> log('Unhandled promise rejection: ' + (e.reason?.message || e.reason), true));
