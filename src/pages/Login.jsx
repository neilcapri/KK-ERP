import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await signIn(email, password)
    if (error) setError('Invalid email or password. Please try again.')
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--kk-green)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      {/* Subtle texture overlay */}
      <div style={{ position: 'fixed', inset: 0, backgroundImage: 'radial-gradient(circle at 20% 80%, rgba(231,155,129,.12) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(227,221,209,.06) 0%, transparent 50%)', pointerEvents: 'none' }} />

      <div style={{
        background: 'var(--kk-cream)',
        width: '100%', maxWidth: '400px',
        padding: '52px 44px',
        borderRadius: '8px',
        boxShadow: '0 32px 80px rgba(0,0,0,.3)',
        position: 'relative',
      }}>
        {/* Top accent line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--kk-peach)', borderRadius: '8px 8px 0 0' }} />

        <div style={{ marginBottom: '32px' }}>
          <div style={{
            fontFamily: 'var(--display)', fontSize: '42px',
            letterSpacing: '5px', color: 'var(--kk-green)', lineHeight: 1,
          }}>KK ERP</div>
          <div style={{
            fontFamily: 'var(--serif)', fontStyle: 'italic',
            fontSize: '13px', color: 'var(--ink2)', marginTop: '6px',
            letterSpacing: '.5px',
          }}>Konscious Kitchen Operations</div>
          <div style={{
            width: '32px', height: '2px',
            background: 'var(--kk-peach)',
            marginTop: '16px', borderRadius: '2px',
          }} />
        </div>

        {error && (
          <div style={{
            background: 'var(--red-l)', borderLeft: '3px solid var(--red)',
            color: 'var(--red)', padding: '10px 14px', borderRadius: '4px',
            fontSize: '12px', marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required autoComplete="email" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" required autoComplete="current-password" />
          </div>
          <button
            type="submit"
            className="btn btn-full"
            style={{
              background: 'var(--kk-green)', color: 'var(--kk-cream)',
              fontFamily: 'var(--display)', fontSize: '18px',
              letterSpacing: '4px', padding: '16px',
              marginTop: '8px', borderRadius: '6px',
              transition: 'all .2s',
            }}
            disabled={loading}
          >
            {loading ? 'SIGNING IN...' : 'ENTER'}
          </button>
        </form>

        <div style={{
          marginTop: '24px', fontSize: '10px',
          color: 'var(--ink3)', textAlign: 'center',
          lineHeight: '1.8', letterSpacing: '.5px',
        }}>
          Contact Snehal to get your login credentials
        </div>
      </div>
    </div>
  )
}
