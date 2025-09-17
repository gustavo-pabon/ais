import React, { useRef, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { anonymizeText } from './anonymize.js'  

// Configure PDF.js worker for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export default function App() {
  const api = import.meta.env.VITE_CHAT_API || '/api/chat'

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    stop,
    reload,
    setMessages,
  } = useChat({ api })

  const listRef = useRef(null)
  const fileInputRef = useRef(null)
  const [maskedContext, setMaskedContext] = useState('') // user-editable masked text
  const [uiError, setUiError] = useState('')

  const llmProvider = import.meta.env.VITE_LLM_PROVIDER || ''
  const llmModel = import.meta.env.VITE_LLM_MODEL || ''
  const llmApiUrl = import.meta.env.VITE_LLM_API_URL || ''

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let v = bytes
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
  }

  // Run anonymization and return a string. This is async because
  // `anonymizeText` performs NER lookups and returns a Promise.
  async function maskPII(text) {
    if (!text) return ''
    return await anonymizeText(text)
  }

  async function extractPdfText(file) {
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    let text = `\n----- ${file.name} -----\n`

    for (let i = 1; i <= pdf.numPages; i++) {
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
          const viewport = page.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const ctx = canvas.getContext('2d')
          await page.render({ canvasContext: ctx, viewport }).promise

          // Prefer dynamic import of tesseract.js (if installed) for worker-based OCR
          let ocrText = ''
          try {
            const t = await import('tesseract.js')
            const { createWorker } = t
            const worker = createWorker()
            await worker.load()
            await worker.loadLanguage('eng')
            await worker.initialize('eng')
            const { data: { text: ttext } } = await worker.recognize(canvas)
            await worker.terminate()
            ocrText = (ttext || '').trim()
          } catch (e) {
            // If dynamic import failed, try using window.Tesseract if present
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
            // Prefer OCR text when selectable text is absent or extremely short
            pageText = pageText ? pageText + '\n' + ocrText : ocrText
          }
        } catch (ocrErr) {
          console.error('OCR error for page', i, ocrErr)
        }
      }

      text += pageText + '\n'
    }
    return text.trim() + '\n'
  }

  async function onFilesSelected(e) {
    setUiError('')
    const pickedAll = Array.from(e.target.files || [])
    const picked = pickedAll.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (pickedAll.length > picked.length) {
      setUiError('Only PDF files are allowed.')
    }
    // Deduplicate by name+size+lastModified
    const key = (f) => `${f.name}-${f.size}-${f.lastModified}`

    if (picked.length > 0) {
      try {
        // Extract from all PDFs, concatenate
        const texts = await Promise.all(picked.map(extractPdfText))
        const combined = texts.join('\n').trim()
        if (combined) {
          try {
            const masked = await maskPII(combined)
            setMaskedContext((prev) => (prev ? prev + '\n' + masked : masked))
          } catch (err) {
            console.error(err)
            setUiError('Failed to anonymize PDF text.')
          }
        }
      } catch (err) {
        console.error(err)
        setUiError('Failed to read one or more PDFs.')
      }
    }

    // Clear the native input so selecting same file again re-triggers
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canSend = !!(input && input.trim()) || !!(maskedContext && maskedContext.trim())

  return (
    <div className="app">
      <div className="container">

        <header className="header">
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>AIS - Anonymous Immigration Support</h1>
        </header>

        <main className="messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="bubble" style={{ margin: '12px auto' }}>
              👋 Type your question below and optionally attach PDF files.
              Everything will be anonymized client-side before any request.
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role === 'user' ? 'user' : 'assistant'}`}>
              <div className="avatar">{m.role === 'user' ? 'U' : 'AI'}</div>
              <div className="bubble">{m.content}</div>
            </div>
          ))}

          {error && (
            <div className="message assistant">
              <div className="avatar">!</div>
              <div className="bubble">
                <strong>Oops:</strong> {String(error.message || error)}
              </div>
            </div>
          )}
        </main>

        <div className="composer-wrap">
          <form
            className="composer"
            style={{ display: 'flex', flexDirection: 'column' }}
            onSubmit={async (e) => {
              e.preventDefault()
              if (!canSend) return
              await handleSubmit(e)
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', width: '100%' }}> 
              <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!isLoading && canSend) e.currentTarget.form?.requestSubmit()
                }
              }}
              name="message"
              />
              <button className="button" type="submit" disabled={isLoading || !canSend}>
              {isLoading ? 'Sending…' : 'Send'}
              </button>
            </div>
            
            {/* Attach button row - placed below the input/send row */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginTop: 8, width: '100%' }}>
              {/* Hidden native file input (PDFs only). Not posted to server. */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={onFilesSelected}
                style={{ display: 'none' }}
                accept="application/pdf,.pdf"
              />

              <button
                type="button"
                className="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach PDF files"
              >
                Add PDF to the context
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginTop: 8, width: '100%' }}>
              {isLoading ? (
              <button type="button" className="button" onClick={stop}>
                Stop
              </button>
              ) : messages.length > 0 ? (
              <button type="button" className="button" onClick={reload}>
                Regenerate
              </button>
              ) : null}

              {messages.length > 0 && !isLoading && (
              <button type="button" className="button" onClick={() => setMessages([])}>
                Clear
              </button>
              )}
            </div>

            {uiError && (
              <div style={{ color: 'crimson', fontSize: 12, marginTop: 6 }}>{uiError}</div>
            )}

            {/* Masked context (editable) */}
            <div style={{ marginTop: 12, width: '100%' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                PII-masked context (editable, sent to the LLM)
              </label>
              <textarea
                name="context"
                value={maskedContext}
                onChange={(e) => setMaskedContext(e.target.value)}
                placeholder="Attach PDFs to extract text; PII will be masked here. You can edit before sending."
                style={{ width: '100%', minHeight: 120, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <button
                  type="button"
                  className="button"
                  onClick={async () => {
                    setUiError('')
                    try {
                      const remasked = await maskPII(maskedContext)
                      setMaskedContext(remasked)
                    } catch (err) {
                      console.error(err)
                      setUiError('Failed to re-mask text.')
                    }
                  }}
                  title="Re-apply masking on the current text"
                >
                  Re-mask
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => setMaskedContext('')}
                  title="Clear masked context"
                >
                  Clear context
                </button>
                <span style={{ fontSize: 12, color: '#666' }}>
                  {maskedContext.length} chars
                </span>
              </div>
            </div>

            {/* Optional LLM connection params passed through to the API */}
            {llmProvider ? <input type="hidden" name="llmProvider" value={llmProvider} /> : null}
            {llmModel ? <input type="hidden" name="llmModel" value={llmModel} /> : null}
            {llmApiUrl ? <input type="hidden" name="llmApiUrl" value={llmApiUrl} /> : null}
          </form>
        </div>
      </div>
    </div>
  )
}
