import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I'm your KK ERP assistant. Ask me anything about inventory, production, dispatches, or raw materials." }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  async function getContext() {
    const [products, rms, recentDispatches, recentProductions, schedule] = await Promise.all([
      supabase.from('products').select('code,name,units,min_stock,price_per_unit,category').order('category').order('code'),
      supabase.from('raw_materials').select('name,stock,min_stock,unit,category,supplier').order('name'),
      supabase.from('dispatches').select('*,dispatch_items(*)').order('created_at', { ascending: false }).limit(10),
      supabase.from('productions').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('production_schedule').select('*').order('scheduled_date').limit(20),
    ])

    const lowFG = (products.data || []).filter(p => p.units <= p.min_stock && p.units > 0)
    const outFG = (products.data || []).filter(p => p.units <= 0)
    const lowRM = (rms.data || []).filter(r => r.stock <= r.min_stock && r.stock > 0)
    const outRM = (rms.data || []).filter(r => r.stock <= 0)

    return `You are the KK ERP assistant for Konscious Kitchen, a Toronto-based protein-forward, clean-ingredient dessert brand.

CURRENT DATE: ${new Date().toLocaleDateString('en-CA')}

FINISHED GOODS INVENTORY (${(products.data || []).length} products):
${(products.data || []).map(p => `${p.code} (${p.name}): ${p.units} units${p.price_per_unit ? ` @ $${p.price_per_unit}` : ''} [min: ${p.min_stock}]`).join('\n')}

LOW STOCK FG: ${lowFG.map(p => `${p.code}: ${p.units}u`).join(', ') || 'None'}
OUT OF STOCK FG: ${outFG.map(p => p.code).join(', ') || 'None'}

RAW MATERIALS (${(rms.data || []).length} items):
${(rms.data || []).map(r => `${r.name}: ${r.stock?.toFixed(2)} ${r.unit} [min: ${r.min_stock}]`).join('\n')}

LOW STOCK RM: ${lowRM.map(r => `${r.name}: ${r.stock?.toFixed(2)}${r.unit}`).join(', ') || 'None'}
OUT OF STOCK RM: ${outRM.map(r => r.name).join(', ') || 'None'}

RECENT DISPATCHES (last 10):
${(recentDispatches.data || []).map(d => `${d.date} - ${d.customer_name} (Inv #${d.invoice_number || '—'}): ${d.dispatch_items?.length || 0} lines`).join('\n')}

RECENT PRODUCTIONS (last 10):
${(recentProductions.data || []).map(p => `${p.date} - ${p.product_code} +${p.output_units} units (${p.input_qty} ${p.input_type})`).join('\n')}

UPCOMING SCHEDULE:
${(schedule.data || []).map(s => `${s.scheduled_date} - ${s.product_code} (${s.planned_input} ${s.input_type} → ${s.planned_output} units) [${s.status}]`).join('\n') || 'Nothing scheduled'}

Answer questions concisely and helpfully. Use the data above to give specific, accurate answers. If asked about calculations (batch values, RM needed etc.), compute them. Keep responses short and practical.`
  }

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(m => [...m, { role: 'user', content: userMsg }])
    setLoading(true)

    try {
      const context = await getContext()
      const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1000,
          system: context,
          messages: [...history, { role: 'user', content: userMsg }]
        })
      })

      const data = await res.json()
      const reply = data.content?.[0]?.text || 'Sorry, I could not get a response.'
      setMessages(m => [...m, { role: 'assistant', content: reply }])
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: 'Error: ' + err.message }])
    }
    setLoading(false)
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <>
      {/* Chat window */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 80, right: 24, width: 360, height: 500,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 8px 40px rgba(34,56,36,.2)',
          display: 'flex', flexDirection: 'column', zIndex: 999,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            background: 'var(--kk-green)', padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'var(--kk-peach)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16,
              }}>🤖</div>
              <div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 1, color: 'var(--kk-cream)' }}>KK ASSISTANT</div>
                <div style={{ fontSize: 10, color: 'rgba(227,221,209,.5)', fontFamily: 'var(--body)' }}>Powered by Claude</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(227,221,209,.6)', cursor: 'pointer', fontSize: 20 }}>×</button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: m.role === 'user' ? 'var(--kk-green)' : 'var(--surface2)',
                  color: m.role === 'user' ? 'var(--kk-cream)' : 'var(--ink)',
                  fontSize: 12,
                  lineHeight: 1.6,
                  fontFamily: 'var(--body)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  padding: '10px 14px', borderRadius: '12px 12px 12px 2px',
                  background: 'var(--surface2)', fontSize: 12,
                }}>
                  <span style={{ animation: 'pulse 1s infinite' }}>thinking...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '12px 14px',
            borderTop: '1px solid var(--border)',
            display: 'flex', gap: 8,
          }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about inventory, production..."
              rows={1}
              style={{
                flex: 1, padding: '8px 12px',
                border: '1.5px solid var(--border)',
                borderRadius: 8, fontSize: 12,
                fontFamily: 'var(--body)',
                background: 'var(--bg)',
                resize: 'none', outline: 'none',
                color: 'var(--ink)',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--kk-green)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              style={{
                background: 'var(--kk-green)', color: 'var(--kk-cream)',
                border: 'none', borderRadius: 8, padding: '8px 14px',
                cursor: 'pointer', fontSize: 16,
                opacity: !input.trim() || loading ? 0.4 : 1,
                transition: 'opacity .15s',
              }}
            >↑</button>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, right: 24,
          width: 52, height: 52, borderRadius: '50%',
          background: open ? 'var(--kk-brown)' : 'var(--kk-green)',
          color: 'var(--kk-cream)', border: 'none',
          cursor: 'pointer', fontSize: 22,
          boxShadow: '0 4px 20px rgba(34,56,36,.3)',
          zIndex: 1000, transition: 'all .2s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {open ? '×' : '💬'}
      </button>
    </>
  )
}
