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
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const animFrameRef = useRef(null)
  const canvasRef = useRef(null)
  const readerRef = useRef(null)

  useEffect(() => {
    return () => {
      stopStream()
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  async function startScanner() {
    setStatus('Starting camera...')
    setScanning(true)
    setResult(null)
    setFormVisible(false)
    setSuccess(false)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', true)
        await videoRef.current.play()
      }

      // Load ZXing
      if (!window.ZXing) {
        await loadScript('https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js')
      }

      const hints = new Map()
      const formats = [
        window.ZXing.BarcodeFormat.EAN_13,
        window.ZXing.BarcodeFormat.EAN_8,
        window.ZXing.BarcodeFormat.UPC_A,
        window.ZXing.BarcodeFormat.UPC_E,
        window.ZXing.BarcodeFormat.CODE_128,
        window.ZXing.BarcodeFormat.CODE_39,
        window.ZXing.BarcodeFormat.ITF,
      ]
      hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats)
      hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true)
      readerRef.current = new window.ZXing.MultiFormatReader()
      readerRef.current.setHints(hints)

      setStatus('Scanning... point camera at barcode')
      scanFrame()
    } catch (err) {
      setStatus('❌ Camera error: ' + err.message)
      setScanning(false)
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
  }

  function scanFrame() {
    if (!videoRef.current || !canvasRef.current || !readerRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const luminanceSource = new window.ZXing.HTMLCanvasElementLuminanceSource(canvas)
        const binaryBitmap = new window.ZXing.BinaryBitmap(new window.ZXing.HybridBinarizer(luminanceSource))
        const result = readerRef.current.decode(binaryBitmap)
        if (result) {
          onDetected(result.getText(), result.getBarcodeFormat())
          return
        }
      } catch (e) {
        // No barcode yet, keep scanning
      }
    }
    animFrameRef.current = requestAnimationFrame(scanFrame)
  }

  function onDetected(code, format) {
    if (navigator.vibrate) navigator.vibrate(200)
    stopStream()
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    setScanning(false)
    setResult({ code, format: String(format) })
    setFormVisible(true)
    setStatus('✅ Barcode captured!')
  }

  function stopScanner() {
    stopStream()
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    setScanning(false)
    setStatus('Tap "Start Scanner" and point at a barcode')
  }

  function resetScanner() {
    stopScanner()
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
    wrap: { padding: 16, maxWidth: 420, margin: '0 auto', fontFamily: 'Arial, sans-serif', background: '#1a3c1a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    card: { background: '#fff', borderRadius: 16, padding: 24, width: '100%', boxShadow: '0 2px 12px rgba(0,0,0,0.2)' },
    h1: { fontSize: 18, fontWeight: 700, color: '#1a3c1a', marginBottom: 4 },
    sub: { fontSize: 13, color: '#666', marginBottom: 20 },
    videoWrap: { position: 'relative', width: '100%', height: 260, background: '#000', borderRadius: 12, overflow: 'hidden', marginBottom: 16, display: scanning ? 'block' : 'none' },
    video: { width: '100%', height: '100%', objectFit: 'cover' },
    scanLine: { position: 'absolute', left: '10%', right: '10%', height: 2, background: '#ff3b3b', top: '50%', boxShadow: '0 0 8px #ff3b3b', animation: 'scanAnim 2s ease-in-out infinite', zIndex: 10 },
    corner: (pos) => {
      const base = { position: 'absolute', width: 20, height: 20, borderColor: '#fff', borderStyle: 'solid' }
      const positions = {
        tl: { top: 20, left: 20, borderWidth: '3px 0 0 3px' },
        tr: { top: 20, right: 20, borderWidth: '3px 3px 0 0' },
        bl: { bottom: 20, left: 20, borderWidth: '0 0 3px 3px' },
        br: { bottom: 20, right: 20, borderWidth: '0 3px 3px 0' },
      }
      return { ...base, ...positions[pos] }
    },
    result: { background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 10, padding: 16, marginBottom: 16 },
    barcodeVal: { fontSize: 20, fontWeight: 700, color: '#1a3c1a', fontFamily: 'monospace', wordBreak: 'break-all' },
    barcodeType: { fontSize: 11, color: '#888', marginTop: 4 },
    btn: (bg, color) => ({ width: '100%', padding: 14, borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 10, background: bg, color }),
    label: { fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
    successBox: { background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 10, padding: 14, fontSize: 13, color: '#155724', marginBottom: 12 },
    status: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 8 },
  }

  return (
    <div style={s.wrap}>
      <style>{`@keyframes scanAnim { 0%,100% { top: 30%; } 50% { top: 70%; } }`}</style>
      <div style={s.card}>
        <div style={s.h1}>🔍 KK Barcode Scanner Test</div>
        <div style={s.sub}>Test scanning on your ingredient packages</div>

        {/* Video */}
        <div style={s.videoWrap}>
          <video ref={videoRef} style={s.video} muted playsInline />
          <div style={s.scanLine} />
          <div style={s.corner('tl')} />
          <div style={s.corner('tr')} />
          <div style={s.corner('bl')} />
          <div style={s.corner('br')} />
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Result */}
        {result && (
          <div style={s.result}>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>✅ Barcode Detected</div>
            <div style={s.barcodeVal}>{result.code}</div>
            <div style={s.barcodeType}>Format: {result.format}</div>
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
            {success && <div style={s.successBox}>✅ Entry logged! Stock would update in full ERP.</div>}
            <button style={s.btn('#1a3c1a', '#fff')} onClick={logEntry}>✓ Log Receipt</button>
            <button style={s.btn('#f0f4f0', '#1a3c1a')} onClick={resetScanner}>↩ Scan Again</button>
          </div>
        )}

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
