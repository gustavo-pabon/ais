import React, { useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'

export default function App() {
  // Use env var if present, otherwise default to /api/chat
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

  // Auto-scroll on new messages
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="app">
      <div className="container">

        <header className="header">
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>AIS - Annonymous Immigration Support</h1>
          <div className="meta" style={{ marginTop: 4 }}>
            Endpoint: <code>{api}</code>
          </div>
        </header>

        <main className="messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="bubble" style={{ margin: '12px auto' }}>
              👋 Type a message below to start chatting.
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role === 'user' ? 'user' : 'assistant'}`}>
              {m.role !== 'user' && <div className="avatar">AI</div>}
              {m.role === 'user' && <div className="avatar">U</div>}
              <div className="bubble">
                {m.content}
                {i === messages.length - 1 && isLoading && m.role !== 'user' && (
                  <div className="meta" style={{ marginTop: 6 }}>
                    <span className="typing">
                      <span className="dot"></span><span className="dot"></span><span className="dot"></span>
                    </span>
                  </div>
                )}
              </div>
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
            onSubmit={(e) => {
              e.preventDefault()
              if (!input.trim() || isLoading) return
              handleSubmit(e)
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
                  if (!isLoading) {
                    e.currentTarget.form?.requestSubmit()
                  }
                }
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button" type="submit" disabled={isLoading || !input.trim()}>
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
                <button
                  type="button"
                  className="button"
                  onClick={() => setMessages([])}
                  title="Clear conversation"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </div>

      </div>
    </div>
  )
}
