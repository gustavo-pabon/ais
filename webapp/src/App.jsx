import React, { useRef, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { anonymizeText } from './anonymize.js'
import { extractPdfText } from './pdf-extract.js'
import { DEFAULT_INSTRUCTIONS } from './default-instructions.js'

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
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState('')
  const [localInput, setLocalInput] = useState(input || '')

  const llmProvider = import.meta.env.VITE_LLM_PROVIDER || ''
  const llmModel = import.meta.env.VITE_LLM_MODEL || ''
  const llmApiUrl = import.meta.env.VITE_LLM_API_URL || ''

  // Prepare a system prompt composed of the masked context + optional instructions
  const systemPrompt = `${maskedContext ? maskedContext + '\n\n' : ''}${DEFAULT_INSTRUCTIONS || ''}`.trim()

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Keep a local copy of the input so the Send button reacts immediately
  useEffect(() => { setLocalInput(input || '') }, [input])

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
      setUiError('')
      setIsExtracting(true)
      setExtractStatus('')
      try {
        // Extract from PDFs sequentially so we can report progress
        const texts = []
        for (const p of picked) {
          const t = await extractPdfText(p, ({ file, page, total }) => setExtractStatus(`${file}: page ${page}/${total}`))
          texts.push(t)
        }
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
      finally {
        setIsExtracting(false)
        setExtractStatus('')
      }
    }

    // Clear the native input so selecting same file again re-triggers
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canSend = !!(localInput && localInput.trim())

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

          {messages.filter((m) => m.role !== 'system').map((m, i) => (
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
              // Make sure there's exactly one system message at the start
              const sp = systemPrompt
              if (typeof setMessages === 'function') {
                setMessages((prev = []) => {
                  const withoutSystem = (prev || []).filter((m) => m.role !== 'system')
                  return [{ role: 'system', content: sp }, ...withoutSystem]
                })
              }
              if (typeof handleSubmit === 'function') await handleSubmit(e)
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', width: '100%' }}> 
              <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
              value={localInput}
              onChange={(e) => { setLocalInput(e.target.value); if (typeof handleInputChange === 'function') handleInputChange(e) }}
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
              <button type="button" className="button" onClick={() => { if (typeof stop === 'function') stop() }}>
                Stop
              </button>
              ) : messages.length > 0 ? (
              <button type="button" className="button" onClick={() => { if (typeof reload === 'function') reload() }}>
                Regenerate
              </button>
              ) : null}

              {messages.length > 0 && !isLoading && (
              <button type="button" className="button" onClick={() => { if (typeof setMessages === 'function') setMessages([]) }}>
                Clear
              </button>
              )}
            </div>

            {uiError && (
              <div style={{ color: 'crimson', fontSize: 12, marginTop: 6 }}>{uiError}</div>
            )}

            {isExtracting && (
              <div style={{ color: '#444', fontSize: 13, marginTop: 8 }}>
                ⏳ Extracting text from PDFs — {extractStatus || 'starting...'}
              </div>
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
            {/* System prompt (masked context + instructions) sent to the server for system-role injection */}
            {systemPrompt ? <input type="hidden" name="systemPrompt" value={systemPrompt} /> : null}
           </form>

          {/* Debug: show raw messages content at the end */}
          <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Current input (debug)
            </label>
            <pre style={{ width: '100%', maxHeight: 40, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {String(localInput)}
            </pre>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 12, marginBottom: 6 }}>
              Raw messages (debug)
            </label>
            <pre style={{ width: '100%', maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {JSON.stringify(messages, null, 2)}
            </pre>
          </div>
         </div>
       </div>
     </div>
   )
 }
