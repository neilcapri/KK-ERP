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
    <div style={{ minHeight: '100vh', background: '#1a1714', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ background: '#fff', width: '100%', maxWidth: '380px', padding: '48px 36px', borderRadius: '4px' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '38px', letterSpacing: '3px', marginBottom: '4px' }}>KK ERP</div>
        <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '14px', color: 'var(--ink3)', marginBottom: '32px' }}>Konscious Kitchen Operations</div>

        {error && (
          <div style={{ background: 'var(--red-l)', borderLeft: '3px solid var(--red)', color: 'var(--red)', padding: '10px 14px', borderRadius: '3px', fontSize: '12px', marginBottom: '16px' }}>
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
          <button type="submit" className="btn btn-primary btn-full" style={{ fontFamily: 'var(--display)', fontSize: '18px', letterSpacing: '3px', padding: '14px', marginTop: '8px' }} disabled={loading}>
            {loading ? 'SIGNING IN...' : 'ENTER'}
          </button>
        </form>

        <div style={{ marginTop: '20px', fontSize: '10px', color: 'var(--ink3)', textAlign: 'center', lineHeight: '1.8' }}>
          Contact Snehal to get your login credentials
        </div>
      </div>
    </div>
  )
}
