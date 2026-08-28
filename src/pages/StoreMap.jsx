import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

const ZONE_COLORS = {
  City:  { color:'#7F77DD', fill:'#EEEDFE', label:'City (Friday)' },
  North: { color:'#1D9E75', fill:'#E1F5EE', label:'North (Wednesday)' },
  West:  { color:'#EF9F27', fill:'#FAEEDA', label:'West (Thursday)' },
  East:  { color:'#378ADD', fill:'#E6F1FB', label:'East (Wednesday)' },
  ONFC:  { color:'#E24B4A', fill:'#FCEBEB', label:'ONFC (Monday)' },
  Float: { color:'#888888', fill:'#F1EFE8', label:'Float' },
}

export default function StoreMap() {
  const { isAdmin } = useAuth()
  const [activeZones, setActiveZones] = useState(new Set(['City','North','West','East','ONFC','Float']))
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    // Load Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    // Load Leaflet JS
    if (document.getElementById('leaflet-js-store')) {
      setMapReady(true)
      return
    }
    const script = document.createElement('script')
    script.id = 'leaflet-js-store'
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    if (!mapReady) return
    initStoreMap(activeZones)
  }, [mapReady, activeZones])

  function toggleZone(zone) {
    setActiveZones(prev => {
      const next = new Set(prev)
      next.has(zone) ? next.delete(zone) : next.add(zone)
      return next
    })
  }

  return (
    <>
      <div className="page-header">
        <div><h2>STORE MAP</h2><p>All KK retail locations across Ontario</p></div>
        <div style={{ fontSize:12, color:'var(--ink3)' }}>{STORE_DATA.filter(s => activeZones.has(s.zone)).length} stores visible</div>
      </div>

      <div className="page-body">
        {/* Zone filter */}
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--ink3)' }}>Filter zones:</span>
          {Object.entries(ZONE_COLORS).map(([zone, cfg]) => (
            <button key={zone} onClick={() => toggleZone(zone)} style={{
              padding:'5px 12px', borderRadius:20,
              border:'1.5px solid ' + cfg.color,
              background: activeZones.has(zone) ? cfg.fill : 'var(--surface)',
              color: activeZones.has(zone) ? cfg.color : 'var(--ink3)',
              cursor:'pointer', fontSize:11,
              fontFamily:'var(--display)', letterSpacing:'0.5px',
              fontWeight: activeZones.has(zone) ? 600 : 400,
            }}>
              {zone}
            </button>
          ))}
          <button onClick={() => setActiveZones(new Set(Object.keys(ZONE_COLORS)))}
            style={{ padding:'5px 12px', borderRadius:20, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--ink3)', cursor:'pointer', fontSize:11, fontFamily:'var(--display)' }}>
            All
          </button>
          <button onClick={() => setActiveZones(new Set())}
            style={{ padding:'5px 12px', borderRadius:20, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--ink3)', cursor:'pointer', fontSize:11, fontFamily:'var(--display)' }}>
            None
          </button>
        </div>

        {/* Map */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 240px', gap:14, alignItems:'start' }}>
          <div id="kk-store-map" style={{ height:580, borderRadius:8, overflow:'hidden', border:'0.5px solid var(--border)' }} />

          {/* Legend + store list */}
          <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:580, overflowY:'auto' }}>
            <div style={{ fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--ink3)', marginBottom:4 }}>Zones</div>
            {Object.entries(ZONE_COLORS).map(([zone, cfg]) => {
              const stores = STORE_DATA.filter(s => s.zone === zone)
              return (
                <div key={zone} style={{ background:'var(--surface)', border:'0.5px solid var(--border)', borderRadius:6, padding:'8px 10px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ width:10, height:10, borderRadius:'50%', background:cfg.color }} />
                      <span style={{ fontSize:11, fontWeight:600, color:cfg.color }}>{zone}</span>
                    </div>
                    <span style={{ fontSize:10, color:'var(--ink3)' }}>{stores.length} stores</span>
                  </div>
                  <div style={{ fontSize:10, color:'var(--ink3)', marginBottom:6 }}>{cfg.label}</div>
                  {activeZones.has(zone) && stores.map(s => (
                    <div key={s.name} style={{ fontSize:11, padding:'2px 0', borderBottom:'0.5px solid var(--border)', color:'var(--ink2)', cursor:'pointer' }}
                      onClick={() => { if (window._kkStoreMap) window._kkStoreMap.flyTo([s.lat, s.lng], 14, { duration:1 }) }}>
                      {s.name}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

function initStoreMap(activeZones) {
  if (window._kkStoreMap) { window._kkStoreMap.remove(); window._kkStoreMap = null }
  const el = document.getElementById('kk-store-map')
  if (!el || !window.L) return

  const map = window.L.map('kk-store-map', { zoomControl:true }).setView([43.85, -79.5], 8)
  window._kkStoreMap = map

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'© OpenStreetMap contributors', maxZoom:18
  }).addTo(map)

  const visible = STORE_DATA.filter(s => activeZones.has(s.zone))

  visible.forEach(store => {
    const cfg = ZONE_COLORS[store.zone] || ZONE_COLORS.Float
    const marker = window.L.circleMarker([store.lat, store.lng], {
      radius: 7,
      fillColor: cfg.fill,
      color: cfg.color,
      weight: 2,
      fillOpacity: 0.85,
    }).addTo(map)

    marker.bindPopup(
      '<div style="min-width:160px">' +
        '<strong style="color:' + cfg.color + '">' + store.name + '</strong><br>' +
        '<span style="font-size:11px;color:#666">' + (store.city || '') + (store.province ? ', ' + store.province : '') + '</span><br>' +
        '<span style="font-size:11px;background:' + cfg.fill + ';color:' + cfg.color + ';padding:1px 6px;border-radius:4px;margin-top:4px;display:inline-block">' + store.zone + '</span>' +
      '</div>',
      { maxWidth: 220 }
    )
  })
}

// Store data embedded directly
const STORE_DATA = [
  { name: "Academy of lions", lat: 43.6503, lng: -79.4274, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Alter Eat-o Foods for keto", lat: 43.5553, lng: -80.2527, city: "Guelph", province: "Ontario", zone: "West" },
  { name: "Ambrosia Lislieville", lat: 43.6614, lng: -79.3267, city: "Toronto", province: "On", zone: "City" },
  { name: "Ambrosia Natural foods", lat: 43.7265, lng: -79.4085, city: "toronto", province: "Ontario", zone: "City" },
  { name: "Ambrosia Newmarket", lat: 44.0503, lng: -79.4703, city: "newmarket", province: "Ontario", zone: "North" },
  { name: "Baldwin Naturals", lat: 43.654, lng: -79.3957, city: "toronto", province: "ON", zone: "City" },
  { name: "Bullock's Your Independent Grocer", lat: 45.3268, lng: -79.217, city: "huntsville", province: "ontario", zone: "North" },
  { name: "Commissos Fresh foods", lat: 43.1117, lng: -79.0674, city: "Niagara falls", province: "ontario", zone: "West" },
  { name: "Essence Health & Juice Bar Woodbrige", lat: 43.7843, lng: -79.5935, city: "Vaughan", province: "ontario", zone: "North" },
  { name: "Everyday Gourmet Coffee Roasters", lat: 43.6475, lng: -79.3709, city: "Toronto", province: "On", zone: "City" },
  { name: "Fiddleheads Broadwalk 08", lat: 43.4515, lng: -80.5218, city: "waterloo", province: "ON", zone: "West" },
  { name: "Fiddleheads Cambridge 03", lat: 43.3601, lng: -80.3123, city: "Cambridge", province: "On", zone: "West" },
  { name: "FiddleHeads Health & Nutrition", lat: 43.46, lng: -80.4878, city: "Kitchener", province: "ON", zone: "West" },
  { name: "Fiesta Farms", lat: 43.6703, lng: -79.4185, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Foodland Amherstview 6441", lat: 44.2547, lng: -76.7012, city: "Amherstview", province: "Ontario", zone: "East" },
  { name: "Foodland Ary 3344", lat: 43.3918, lng: -80.4449, city: "Ayr", province: "ON", zone: "Float" },
  { name: "Foodland Bright's Grove 3324", lat: 43.0903, lng: -82.0098, city: "Bright's grove", province: "ON", zone: "Float" },
  { name: "Foodland Elamvale 3238", lat: 44.5825, lng: -79.8777, city: "Elamvale", province: "Ontario", zone: "Float" },
  { name: "Foodland Elmira #3359", lat: 43.5978, lng: -80.5581, city: "Elmira", province: "on", zone: "North" },
  { name: "Foodland Forest 6419", lat: 43.0995, lng: -81.9956, city: "Forest", province: "Ontario", zone: "Float" },
  { name: "Foodland Haliburton 6447", lat: 45.0503, lng: -78.5198, city: "Haliburton", province: "ON", zone: "Float" },
  { name: "Foodland Komoka 3250", lat: 42.9697, lng: -81.4087, city: "Komoka", province: "Ontario", zone: "Float" },
  { name: "Foodland Lucan", lat: 43.1896, lng: -81.399, city: "Lucan", province: "On", zone: "Float" },
  { name: "Foodland Mount Forest", lat: 43.9816, lng: -80.7328, city: "Mount Forest", province: "Ontario", zone: "North" },
  { name: "FoodLand Ridgetown", lat: 42.4397, lng: -81.8779, city: "Ridgetown", province: "On", zone: "Float" },
  { name: "Foodland Southampton # 3428", lat: 44.4997, lng: -81.3767, city: "Southhampton", province: "ON", zone: "Float" },
  { name: "Foodland Thornbury", lat: 44.5613, lng: -80.4512, city: "Thornbury", province: "Ontario", zone: "North" },
  { name: "Foodland Thorold #6283", lat: 43.1197, lng: -79.1981, city: "Thorold", province: "ON", zone: "West" },
  { name: "Foodland Verona", lat: 44.4697, lng: -76.7012, city: "Verona", province: "On", zone: "Float" },
  { name: "Foodland Vodden", lat: 43.7397, lng: -79.7181, city: "Brampton", province: "Ontario", zone: "West" },
  { name: "Fort Ancaster Wilson", lat: 43.2197, lng: -79.9881, city: "Ancaster", province: "ON", zone: "West" },
  { name: "Fort Bolton Queen", lat: 43.8797, lng: -79.7281, city: "Bolton", province: "ON", zone: "North" },
  { name: "Fort Brampton Mountainash", lat: 43.7597, lng: -79.7481, city: "Brampton", province: "ON", zone: "West" },
  { name: "Fort Brampton Quarry Edge", lat: 43.7297, lng: -79.7581, city: "Brampton", province: "ON", zone: "West" },
  { name: "Fort Brampton Worthington", lat: 43.6997, lng: -79.8281, city: "Brampton", province: "ON", zone: "West" },
  { name: "Fort Burlington Appleby", lat: 43.3797, lng: -79.8281, city: "Burlington", province: "ON", zone: "West" },
  { name: "Fort Burlington Guelph", lat: 43.3697, lng: -79.8481, city: "Burlington", province: "ON", zone: "West" },
  { name: "FORT Burlington New", lat: 43.3197, lng: -79.7981, city: "Burlington", province: "ON", zone: "West" },
  { name: "Fort Burlington Plains", lat: 43.3397, lng: -79.8081, city: "Burlington", province: "ON", zone: "West" },
  { name: "Fort Hamilton Centennial", lat: 43.2397, lng: -79.7881, city: "Hamilton", province: "ON", zone: "West" },
  { name: "Fort Hamilton Dundurn", lat: 43.2497, lng: -79.8781, city: "Hamilton", province: "ON", zone: "West" },
  { name: "Fort Hamilton Main", lat: 43.2497, lng: -79.9281, city: "Hamilton", province: "ON", zone: "West" },
  { name: "FORT Hamilton Mall", lat: 43.2297, lng: -79.8681, city: "Hamilton", province: "ON", zone: "West" },
  { name: "Fort Hamilton Upper James", lat: 43.2097, lng: -79.8781, city: "Hamilton", province: "ON", zone: "West" },
  { name: "Fort Hwy 27", lat: 43.7897, lng: -79.5981, city: "Woodbridge", province: "ON", zone: "North" },
  { name: "Fort North York Lawrence", lat: 43.7197, lng: -79.4481, city: "North York", province: "ON", zone: "City" },
  { name: "Fort OAKVILLE Neyagawa", lat: 43.4797, lng: -79.7281, city: "Oakville", province: "ON", zone: "West" },
  { name: "Fort Queens Plate", lat: 43.5897, lng: -79.6581, city: "Brampton", province: "ON", zone: "West" },
  { name: "Fort South Oakville", lat: 43.3997, lng: -79.6881, city: "Oakville", province: "ON", zone: "West" },
  { name: "Fort Stoney Creek Hwy 8", lat: 43.2197, lng: -79.7381, city: "Stoney Creek", province: "ON", zone: "West" },
  { name: "Fort Stoney Creek Upper Centennial", lat: 43.2097, lng: -79.7481, city: "Stoney Creek", province: "ON", zone: "West" },
  { name: "Fort Vaughan Major MacKenzie", lat: 43.8497, lng: -79.5281, city: "Vaughan", province: "ON", zone: "North" },
  { name: "Fort Waterdown Hamilton", lat: 43.3297, lng: -79.9081, city: "Waterdown", province: "ON", zone: "West" },
  { name: "Fort Woodbridge", lat: 43.7897, lng: -79.5781, city: "Woodbridge", province: "ON", zone: "North" },
  { name: "Fresh Avenue", lat: 43.6597, lng: -79.4681, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Fresh City Farms", lat: 43.6697, lng: -79.5981, city: "Mississauga", province: "ontario", zone: "West" },
  { name: "Gaudar Natural Foods", lat: 44.6097, lng: -79.4181, city: "Orillia", province: "Ontario", zone: "North" },
  { name: "Goldsmith's Farm Market & Bakery", lat: 44.5613, lng: -80.4512, city: "Thornbury", province: "Ontario", zone: "North" },
  { name: "Haven low carb cafe", lat: 43.6697, lng: -79.3181, city: "toronto", province: "ontario", zone: "City" },
  { name: "Hockley General Store", lat: 43.9697, lng: -80.0881, city: "ORANGEVILLE,", province: "Ontario", zone: "North" },
  { name: "Honey Harbour General Store", lat: 44.8697, lng: -79.8281, city: "Honey Harbour", province: "On", zone: "North" },
  { name: "JOANNE'S PLACE", lat: 44.3097, lng: -78.3281, city: "Peterborough", province: "On", zone: "Float" },
  { name: "karma Co op Grocery", lat: 43.6597, lng: -79.4181, city: "Toronto", province: "On", zone: "City" },
  { name: "Ketolibriyum London", lat: 42.9597, lng: -81.2181, city: "London", province: "ON", zone: "Float" },
  { name: "kim Natural Food", lat: 43.6497, lng: -79.4481, city: "Toronto", province: "ON", zone: "City" },
  { name: "Kupfert & Kim FCP", lat: 43.6475, lng: -79.3809, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "kupfert & Kim Yorkville", lat: 43.6697, lng: -79.3881, city: "toronto", province: "ontario", zone: "City" },
  { name: "Maisies Independent city market", lat: 43.6697, lng: -79.3881, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Marilu's Market", lat: 43.3297, lng: -79.7881, city: "burlington", province: "ontario", zone: "West" },
  { name: "McEwan Fine Foods Donmills", lat: 43.7297, lng: -79.3381, city: "Toronto", province: "ON", zone: "City" },
  { name: "Natura Market Ecommerce Inc", lat: 43.5797, lng: -79.6881, city: "Mississauga", province: "ON", zone: "West" },
  { name: "Nature Emprium Burlington", lat: 43.3897, lng: -79.7881, city: "Burlington", province: "ontario", zone: "West" },
  { name: "Natures Emporium Maple", lat: 43.8597, lng: -79.5181, city: "Vaughan", province: "Ontario", zone: "North" },
  { name: "Natures Emporium New Market", lat: 44.0503, lng: -79.4703, city: "New Market", province: "Ontario", zone: "North" },
  { name: "Natures Emporium Oakville", lat: 43.4597, lng: -79.6681, city: "Oakville", province: "Ontario", zone: "West" },
  { name: "Natures Emporium Southcore", lat: 43.6375, lng: -79.3809, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Natures Emporium Woodbridge", lat: 43.7897, lng: -79.5781, city: "Vaughan", province: "Ontario", zone: "North" },
  { name: "Nottawa General", lat: 44.3697, lng: -80.0881, city: "Nottawa", province: "ON", zone: "North" },
  { name: "Paris natural foods", lat: 46.4797, lng: -80.9981, city: "Sudbury", province: "On", zone: "East" },
  { name: "Peacock Foodland Tobermory", lat: 45.2597, lng: -81.6681, city: "Tobermory", province: "ontario", zone: "North" },
  { name: "Peanut Mill Natural Food market", lat: 43.1797, lng: -79.2381, city: "St. Catharines", province: "Ontario", zone: "West" },
  { name: "Quarter Master natural Foods", lat: 42.9697, lng: -81.2681, city: "London", province: "Ontario", zone: "Float" },
  { name: "Reply Caffe", lat: 43.6597, lng: -79.3881, city: "Toronto", province: "On", zone: "City" },
  { name: "Ripe Juicery", lat: 44.3797, lng: -79.6881, city: "Barrie", province: "On", zone: "North" },
  { name: "Sobeys Acton", lat: 43.6297, lng: -80.0381, city: "Acton", province: "On", zone: "Float" },
  { name: "sobeys Ahmerstburg 4018", lat: 42.1097, lng: -83.1081, city: "Amherstburg", province: "ON", zone: "Float" },
  { name: "Sobeys Algonquin North Bay 4160", lat: 46.3197, lng: -79.4481, city: "North Bay", province: "ON", zone: "North" },
  { name: "Sobeys Angus #537", lat: 44.3097, lng: -79.8881, city: "Angus", province: "ON", zone: "North" },
  { name: "Sobeys Aurora", lat: 43.9997, lng: -79.4681, city: "Aurora", province: "On", zone: "North" },
  { name: "Sobeys Beamsville", lat: 43.1697, lng: -79.4781, city: "Beamsville", province: "On", zone: "West" },
  { name: "Sobeys Bloor & Islington 4743", lat: 43.6397, lng: -79.5281, city: "Etobicoke", province: "ON", zone: "City" },
  { name: "Sobeys Burlington # 742", lat: 43.3397, lng: -79.8281, city: "Burlington", province: "On", zone: "West" },
  { name: "Sobeys Chatam 4116", lat: 42.4097, lng: -82.1881, city: "Chatam", province: "ON", zone: "Float" },
  { name: "Sobeys Collingwood 4151", lat: 44.5097, lng: -80.2181, city: "Collingwood", province: "Ontario", zone: "North" },
  { name: "Sobeys Columbia 878", lat: 43.4397, lng: -80.5081, city: "waterloo", province: "Ontario", zone: "West" },
  { name: "Sobeys Fonthill", lat: 43.0397, lng: -79.2781, city: "Fonthill", province: "ON", zone: "West" },
  { name: "Sobeys Forth Erie", lat: 42.9097, lng: -79.0281, city: "Fort Erie", province: "Ontario", zone: "West" },
  { name: "Sobeys Glen Abbey # 777", lat: 43.4597, lng: -79.7281, city: "Oakville", province: "ON", zone: "West" },
  { name: "Sobeys Glendale", lat: 43.1597, lng: -79.2281, city: "St Catherines", province: "Ontario", zone: "West" },
  { name: "Sobeys Grimsby 642", lat: 43.2097, lng: -79.5681, city: "Grimsby", province: "On", zone: "West" },
  { name: "Sobeys High park 819", lat: 43.6497, lng: -79.4481, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Sobeys Highland # 641", lat: 43.4397, lng: -80.4981, city: "Kitchener", province: "Ontario", zone: "West" },
  { name: "Sobeys Ira Needles 685", lat: 43.4197, lng: -80.4681, city: "Kitchener", province: "ON", zone: "West" },
  { name: "Sobeys Laird & Wicksteed", lat: 43.7097, lng: -79.3581, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Sobeys London #863", lat: 43.0097, lng: -81.2581, city: "London", province: "ON", zone: "Float" },
  { name: "sobeys Maple Grove #637", lat: 43.4797, lng: -79.6881, city: "Oakville", province: "ON", zone: "West" },
  { name: "sobeys March Rd # 4016", lat: 45.3297, lng: -75.9081, city: "Kanata", province: "Ontario", zone: "Float" },
  { name: "Sobeys Mayfield #865", lat: 43.7497, lng: -79.7681, city: "Brampton", province: "Ontario", zone: "West" },
  { name: "Sobeys Milton", lat: 43.5197, lng: -79.8881, city: "Milton", province: "on", zone: "West" },
  { name: "Sobeys New Hamburg", lat: 43.3797, lng: -80.7081, city: "New Hamburg", province: "Ontario", zone: "West" },
  { name: "sobeys Niagara", lat: 43.2297, lng: -79.0581, city: "Niagara", province: "ontario", zone: "Float" },
  { name: "Sobeys North Park #707", lat: 43.7097, lng: -79.7581, city: "Brampton", province: "ON", zone: "West" },
  { name: "Sobeys Northfield #4729", lat: 43.4597, lng: -80.4981, city: "waterloo", province: "On", zone: "West" },
  { name: "Sobeys Orangeville", lat: 43.9197, lng: -80.1081, city: "Orangeville", province: "ontario", zone: "North" },
  { name: "Sobeys Oshawa", lat: 43.8997, lng: -78.8681, city: "Oshawa", province: "Ontario", zone: "East" },
  { name: "Sobeys Parry Sound", lat: 45.3397, lng: -80.0281, city: "Parry Sound", province: "On", zone: "North" },
  { name: "Sobeys Scott & Niagara", lat: 43.1797, lng: -79.2281, city: "St. Catharines", province: "ON", zone: "West" },
  { name: "Sobeys South Ajax", lat: 43.8397, lng: -79.0281, city: "Ajax", province: "On", zone: "East" },
  { name: "sobeys Spadina # 934", lat: 43.6497, lng: -79.3981, city: "Toronto", province: "ON", zone: "City" },
  { name: "Sobeys Stone Church #4737", lat: 43.2297, lng: -79.8681, city: "Stoney creek", province: "ON", zone: "West" },
  { name: "Sobeys Stratford 4110", lat: 43.3697, lng: -80.9881, city: "Stratford", province: "ontario", zone: "West" },
  { name: "Sobeys Todmodern 4728", lat: 43.6797, lng: -79.3581, city: "East York", province: "ON", zone: "City" },
  { name: "sobeys Woodstock 640", lat: 43.1297, lng: -80.7581, city: "Woodstock", province: "ON", zone: "Float" },
  { name: "Sobeys yonge & Balliol", lat: 43.6897, lng: -79.3881, city: "Toronto", province: "ON", zone: "City" },
  { name: "Stevens Your Independent Grocer Bracebridge", lat: 45.0397, lng: -79.3281, city: "Bracebridge", province: "Ontario", zone: "North" },
  { name: "Summerhill Market", lat: 43.6797, lng: -79.3881, city: "North York", province: "Ontario", zone: "City" },
  { name: "The Big Carrot Danforth", lat: 43.6797, lng: -79.3281, city: "Toronto", province: "ontario", zone: "City" },
  { name: "The Big Carrot Southwood", lat: 43.6197, lng: -79.3081, city: "toronto", province: "ontario", zone: "City" },
  { name: "The Great Vine", lat: 44.0097, lng: -78.8681, city: "Huntsville", province: "ontario", zone: "North" },
  { name: "The green root", lat: 43.9297, lng: -76.4881, city: "Belleville", province: "Ontario", zone: "East" },
  { name: "The Green Root Kingston", lat: 43.9297, lng: -76.4881, city: "Kingston", province: "ON", zone: "East" },
  { name: "The Sweet Potato", lat: 43.6697, lng: -79.4181, city: "toronto", province: "ontario", zone: "City" },
  { name: "TNS Health Food Organic Supermarket Cobourg", lat: 43.9597, lng: -78.1681, city: "cobourg", province: "ontario", zone: "East" },
  { name: "Truly Healthy inc", lat: 43.6597, lng: -79.3881, city: "Markham", province: "ON", zone: "Float" },
  { name: "Turtle Crossing Cafe", lat: 43.5597, lng: -79.3081, city: "Barrie", province: "ON", zone: "North" },
  { name: "Victoria Olive Oil Co", lat: 44.2297, lng: -76.4881, city: "Victoria", province: "BC", zone: "Float" },
  { name: "Village Boutique Foods", lat: 43.6597, lng: -79.3881, city: "Burlington", province: "ON", zone: "West" },
  { name: "Vitalife Clinic", lat: 43.6597, lng: -79.3881, city: "Toronto", province: "On", zone: "City" },
  { name: "Well Well Well Nutrition Center", lat: 43.6597, lng: -79.3881, city: "St Catherines", province: "Ontario", zone: "West" },
  { name: "Whole Foods Market Leaside", lat: 43.7097, lng: -79.3581, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Whole Foods Market Ottawa", lat: 45.4197, lng: -75.6881, city: "ottawa", province: "ON", zone: "Float" },
  { name: "Whole Foods Oakville", lat: 43.4797, lng: -79.7281, city: "Oakville", province: "Ontario", zone: "West" },
  { name: "Whole Foods Square On Mississauga", lat: 43.5997, lng: -79.6181, city: "Mississauga", province: "Ontario", zone: "West" },
  { name: "Whole Foods Unionville", lat: 43.8697, lng: -79.3181, city: "Markham", province: "Ontario", zone: "East" },
  { name: "Whole Foods Yorkville", lat: 43.6697, lng: -79.3881, city: "Toronto", province: "Ontario", zone: "City" },
  { name: "Whole Foods Youge & Sheppard", lat: 43.7597, lng: -79.4081, city: "North York", province: "Ontario", zone: "City" },
  { name: "LOBLAWS Inc", lat: 43.65, lng: -79.38, city: "Toronto", province: "ON", zone: "City" },
  { name: "Mary's Mindful Bakehouse Ltd.", lat: 42.3149, lng: -83.0364, city: "Windsor", province: "ON", zone: "East" },
  { name: "Organika Kitchen", lat: 43.66, lng: -79.39, city: "Toronto", province: "ON", zone: "City" },
  { name: "Sydney Bly", lat: 43.65, lng: -79.4, city: "Toronto", province: "ON", zone: "City" },
]
