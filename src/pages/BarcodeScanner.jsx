import { useEffect, useRef, useState } from 'react'

export default function BarcodeScanner() {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState('')
  const [formVisible, setFormVisible] = useState(false)
  const [success, setSuccess] = useState(false)
  const [rmName, setRmName] = useState('')
  const [supplier, setSupplier] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('kg')
  const [supported, setSupported] = useState(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const animFrameRef = useRef(null)
  const detectorRef = useRef(null)

  useEffect(() => {
    if ('BarcodeDetector' in window) {
      setSupported(true)
      setStatus('Tap "Start Scanner" and point at a barcode')
    } else {
      setSupported(false)
      setStatus('❌ BarcodeDetector not supported on this browser/device')
    }
    return () => { stopStream(); cancelAnimationFrame(animFrameRef.current) }
  }, [])

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  async function startScanner() {
    setScanning(true)
    setResult(null)
    setFormVisible(false)
    setSuccess(false)
    setStatus('Starting camera...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      videoRef.current.setAttribute('playsinline', true)
      await videoRef.current.play()

      detectorRef.current = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix']
      })

      setStatus('📷 Scanning... hold steady over barcode')
      scanLoop()
    } catch (err) {
      setStatus('❌ Camera error: ' + err.message)
      setScanning(false)
    }
  }

  async function scanLoop() {
    if (!videoRef.current || !detectorRef.current) return
    if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      try {
        const barcodes = await detectorRef.current.detect(videoRef.current)
        if (barcodes.length > 0) {
          const b = barcodes[0]
          onDetected(b.rawValue, b.format)
          return
        }
      } catch (e) {}
    }
    animFrameRef.current = requestAnimationFrame(scanLoop)
  }

  function onDetected(code, format) {
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    stopStream()
    cancelAnimationFrame(animFrameRef.current)
    setScanning(false)
    setResult({ code, format })
    setFormVisible(true)
    setStatus('✅ Barcode captured!')
  }

  function stopScanner() {
    stopStream()
    cancelAnimationFrame(animFrameRef.current)
    setScanning(false)
    setStatus('Tap "Start Scanner" and point at a barcode')
  }

  function resetScanner() {
    stopScanner()
    setResult(null)
    setFormVisible(false)
    setSuccess(false)
    setRmName(''); setSupplier(''); setQty(''); setUnit('kg')
  }

  function logEntry() {
    if (!rmName || !qty) { alert('Please fill in Raw Material and Qty'); return }
    setSuccess(true)
  }

  const s = {
    page: { background: '#1a3c1a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
    card: { background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420 },
    h1: { fontSize: 20, fontWeight: 700, color: '#1a3c1a', marginBottom: 4 },
    sub: { fontSize: 13, color: '#888', marginBottom: 20 },
    videoWrap: { position: 'relative', width: '100%', borderRadius: 12, overflow: 'hidden', background: '#000', marginBottom: 16, display: scanning ? 'block' : 'none', aspectRatio: '4/3' },
    video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
    overlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
    frame: { width: '75%', height: '35%', border: '2px solid rgba(255,255,255,0.8)', borderRadius: 8, position: 'relative' },
    scanBar: { position: 'absolute', left: 0, right: 0, height: 2, background: '#ff3b3b', boxShadow: '0 0 10px #ff3b3b', animation: 'scan 1.8s ease-in-out infinite' },
    result: { background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 10, padding: 16, marginBottom: 16 },
    code: { fontSize: 20, fontWeight: 700, color: '#1a3c1a', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4 },
    fmt: { fontSize: 11, color: '#888', marginTop: 4, textTransform: 'uppercase' },
    btn: (bg, fg) => ({ width: '100%', padding: '14px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 10, background: bg, color: fg }),
    lbl: { fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4, marginTop: 8 },
    inp: { width: '100%', padding: '11px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 4, boxSizing: 'border-box' },
    okBox: { background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 10, padding: 14, fontSize: 13, color: '#155724', marginBottom: 12 },
    status: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 10, minHeight: 18 },
    unsupported: { background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 10, padding: 14, fontSize: 13, color: '#856404', marginBottom: 16 },
  }

  return (
    <div style={s.page}>
      <style>{`@keyframes scan { 0%,100%{top:15%} 50%{top:75%} }`}</style>
      <div style={s.card}>
        <div style={s.h1}>🔍 KK Barcode Scanner</div>
        <div style={s.sub}>Test barcode scanning on ingredient packages</div>

        {supported === false && (
          <div style={s.unsupported}>
            ⚠️ Your browser doesn't support BarcodeDetector. Please use <strong>Safari on iOS 16+</strong> or <strong>Chrome on Android</strong>.
          </div>
        )}

        {/* Camera view */}
        <div style={s.videoWrap}>
          <video ref={videoRef} style={s.video} muted playsInline autoPlay />
          <div style={s.overlay}>
            <div style={s.frame}>
              <div style={s.scanBar} />
            </div>
          </div>
        </div>

        {/* Result */}
        {result && (
          <div style={s.result}>
            <div style={{ fontSize: 12, color: '#555' }}>✅ Barcode Detected</div>
            <div style={s.code}>{result.code}</div>
            <div style={s.fmt}>Format: {result.format}</div>
          </div>
        )}

        {/* Entry form */}
        {formVisible && (
          <div>
            <label style={s.lbl}>Raw Material</label>
            <input style={s.inp} value={rmName} onChange={e => setRmName(e.target.value)} placeholder="e.g. Almond Flour" />
            <label style={s.lbl}>Supplier</label>
            <input style={s.inp} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Costco" />
            <label style={s.lbl}>Qty Received</label>
            <input style={s.inp} type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
            <label style={s.lbl}>Unit</label>
            <select style={s.inp} value={unit} onChange={e => setUnit(e.target.value)}>
              <option>kg</option><option>g</option><option>L</option><option>ml</option><option>units</option><option>lbs</option>
            </select>
            {success && <div style={s.okBox}>✅ Logged! In full ERP this would update stock.</div>}
            <button style={s.btn('#1a3c1a','#fff')} onClick={logEntry}>✓ Log Receipt</button>
            <button style={s.btn('#f0f4f0','#333')} onClick={resetScanner}>↩ Scan Again</button>
          </div>
        )}

        {supported && !scanning && !formVisible && (
          <button style={s.btn('#1a3c1a','#fff')} onClick={startScanner}>📷 Start Scanner</button>
        )}
        {scanning && (
          <button style={s.btn('#dc3545','#fff')} onClick={stopScanner}>⏹ Stop</button>
        )}

        <div style={s.status}>{status}</div>
      </div>
    </div>
  )
}
