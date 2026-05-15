import { useEffect, useRef, useState } from 'react'

export default function BarcodeScanner() {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState('Tap "Start Scanner" and point at a barcode')
  const [formVisible, setFormVisible] = useState(false)
  const [success, setSuccess] = useState(false)
  const [rmName, setRmName] = useState('')
  const [supplier, setSupplier] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('kg')
  const scannerRef = useRef(null)
  const quaggaRef = useRef(null)

  useEffect(() => {
    // Load Quagga dynamically
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js'
    script.async = true
    document.body.appendChild(script)
    quaggaRef.current = script
    return () => {
      try { window.Quagga?.stop() } catch(e) {}
      document.body.removeChild(script)
    }
  }, [])

  function startScanner() {
    setScanning(true)
    setStatus('Scanning... point camera at barcode')
    setResult(null)
    setFormVisible(false)
    setSuccess(false)

    const tryInit = () => {
      if (!window.Quagga) { setTimeout(tryInit, 200); return }
      window.Quagga.init({
        inputStream: {
          name: 'Live',
          type: 'LiveStream',
          target: scannerRef.current,
          constraints: { facingMode: 'environment', width: { min: 640 }, height: { min: 480 } },
        },
        decoder: {
          readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader','code_39_reader','itf_reader']
        },
        locate: true,
      }, (err) => {
        if (err) { setStatus('❌ Camera error: ' + err.message); setScanning(false); return }
        window.Quagga.start()
      })

      window.Quagga.onDetected((res) => {
        const code = res.codeResult.code
        const format = res.codeResult.format
        if (navigator.vibrate) navigator.vibrate(200)
        window.Quagga.stop()
        setScanning(false)
        setResult({ code, format })
        setFormVisible(true)
        setStatus('✅ Barcode captured! Fill in details below.')
      })
    }
    tryInit()
  }

  function stopScanner() {
    try { window.Quagga?.stop() } catch(e) {}
    setScanning(false)
    setStatus('Tap "Start Scanner" and point at a barcode')
  }

  function resetScanner() {
    try { window.Quagga?.stop() } catch(e) {}
    setScanning(false)
    setResult(null)
    setFormVisible(false)
    setSuccess(false)
    setRmName(''); setSupplier(''); setQty(''); setUnit('kg')
    setStatus('Tap "Start Scanner" and point at a barcode')
  }

  function logEntry() {
    if (!rmName || !qty) { alert('Please fill in Raw Material and Qty'); return }
    setSuccess(true)
  }

  const s = {
    wrap: { padding: 16, maxWidth: 420, margin: '0 auto', fontFamily: 'Arial, sans-serif' },
    card: { background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 12px rgba(0,0,0,0.1)' },
    h1: { fontSize: 18, fontWeight: 700, color: '#1a3c1a', marginBottom: 4 },
    p: { fontSize: 13, color: '#666', marginBottom: 20 },
    scanBox: { position: 'relative', width: '100%', height: 260, background: '#000', borderRadius: 12, overflow: 'hidden', marginBottom: 16, display: scanning ? 'block' : 'none' },
    result: { background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 10, padding: 16, marginBottom: 16 },
    barcodeVal: { fontSize: 22, fontWeight: 700, color: '#1a3c1a', fontFamily: 'monospace', wordBreak: 'break-all' },
    barcodeType: { fontSize: 11, color: '#888', marginTop: 4 },
    btn: (bg, color) => ({ width: '100%', padding: 14, borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 10, background: bg, color }),
    label: { fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
    success: { background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 10, padding: 14, fontSize: 13, color: '#155724', marginBottom: 12 },
    status: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 8 },
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.h1}>🔍 Barcode Scanner Test</div>
        <div style={s.p}>Test barcode scanning on your ingredient packages</div>

        {/* Scanner viewport */}
        <div style={s.scanBox} ref={scannerRef} />

        {/* Result */}
        {result && (
          <div style={s.result}>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>✅ Barcode Detected</div>
            <div style={s.barcodeVal}>{result.code}</div>
            <div style={s.barcodeType}>Format: {result.format?.toUpperCase()}</div>
          </div>
        )}

        {/* Form */}
        {formVisible && (
          <div>
            <label style={s.label}>Raw Material</label>
            <input style={s.input} value={rmName} onChange={e => setRmName(e.target.value)} placeholder="e.g. Almond Flour" />
            <label style={s.label}>Supplier</label>
            <input style={s.input} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Costco" />
            <label style={s.label}>Qty Received</label>
            <input style={s.input} type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
            <label style={s.label}>Unit</label>
            <select style={s.input} value={unit} onChange={e => setUnit(e.target.value)}>
              <option>kg</option><option>g</option><option>L</option><option>ml</option><option>units</option><option>lbs</option>
            </select>
            {success && <div style={s.success}>✅ Entry logged! Stock would update in full ERP.</div>}
            <button style={s.btn('#1a3c1a', '#fff')} onClick={logEntry}>✓ Log Receipt</button>
            <button style={s.btn('#f0f4f0', '#1a3c1a')} onClick={resetScanner}>↩ Scan Again</button>
          </div>
        )}

        {/* Buttons */}
        {!scanning && !formVisible && (
          <button style={s.btn('#1a3c1a', '#fff')} onClick={startScanner}>📷 Start Scanner</button>
        )}
        {scanning && (
          <button style={s.btn('#dc3545', '#fff')} onClick={stopScanner}>⏹ Stop Scanner</button>
        )}

        <div style={s.status}>{status}</div>
      </div>
    </div>
  )
}
