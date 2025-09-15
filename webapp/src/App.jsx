import React, { useRef, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'

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
  const [files, setFiles] = useState([]) // File[]

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  function onFilesSelected(e) {
    const picked = Array.from(e.target.files || [])
    // Deduplicate by name+size+lastModified (basic)
    const key = (f) => `${f.name}-${f.size}-${f.lastModified}`
    const merged = [...files, ...picked].reduce((acc, f) => {
      if (!acc.some((g) => key(g) === key(f))) acc.push(f)
      return acc
    }, [])
    setFiles(merged)
  }

  function removeFile(i) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
  }

  function clearFiles() {
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let v = bytes
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
  }

  return (
    <div className="app">
      <div className="container">

        <header className="header">
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>AIS - Anonymous Immigration Support</h1>
          <div className="meta" style={{ marginTop: 4 }}>
            Endpoint: <code>{api}</code>
          </div>
        </header>
        <main className="messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="bubble" style={{ margin: '12px auto' }}>
              👋 Type your question below and optionally attach files.
              Everything will be anonymized before using any cloud service.
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
          {/* IMPORTANT: encType so files go as multipart/form-data */}
          <form
            className="composer"
            encType="multipart/form-data"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!input.trim() && files.length === 0) return
              // Let useChat collect the form data (message + files)
              await handleSubmit(e)
              // Clear file inputs after sending
              clearFiles()
            }}
          >
            <input
              className="input"
              placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (!isLoading) e.currentTarget.form?.requestSubmit()
                }
              }}
              name="message"
            />

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Hidden native file input */}
              <input
                ref={fileInputRef}
                type="file"
                name="files"
                multiple
                onChange={onFilesSelected}
                style={{ display: 'none' }}
                // Tweak as needed:
                accept=".pdf,.txt,.md,.doc,.docx,.csv,.json,.png,.jpg,.jpeg,.gif"
              />
            {/*

              <button
                type="button"
                className="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
              >
                Attach
              </button>

              <button className="button" type="submit" disabled={isLoading || (!input.trim() && files.length === 0)}>
                {isLoading ? 'Sending…' : 'Send'}
              </button>

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
              */}
            </div>

            {/* 
            {/* File list preview *}
            {files.length > 0 && (
              <div className="filelist">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="fileitem">
                    <span className="filename" title={f.name}>{f.name}</span>
                    <span className="filesize">{formatBytes(f.size)}</span>
                    <button type="button" className="filebtn" onClick={() => removeFile(i)}>✕</button>
                  </div>
                ))}
                <div className="fileactions">
                  <button type="button" className="fileclear" onClick={clearFiles}>Clear files</button>
                </div>
              </div>
            )}
            */}
          </form>
        </div>
      </div>
    </div>
  )
}
