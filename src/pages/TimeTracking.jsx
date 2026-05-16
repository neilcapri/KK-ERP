import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}
function fmtHours(h) {
  if (h == null) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
}
function weekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToSat = day >= 6 ? 0 : day + 1;
  d.setDate(d.getDate() - diffToSat);
  d.setHours(0, 0, 0, 0);
  return d;
}
function getRange(selectedDate, rangeType) {
  const start = weekStart(selectedDate);
  let end;
  if (rangeType === "2weeks") {
    end = new Date(start); end.setDate(start.getDate() + 13); end.setHours(23,59,59,999);
  } else if (rangeType === "month") {
    end = new Date(start); end.setDate(start.getDate() + 29); end.setHours(23,59,59,999);
  } else {
    end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
  }
  return { start, end };
}

function WeekCalendar({ selectedDate, onSelectWeek, onClose }) {
  const [viewDate, setViewDate] = useState(new Date(selectedDate));
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  function isSameWeek(date) { return weekStart(selectedDate).getTime() === weekStart(date).getTime(); }
  function isToday(date) { const t = new Date(); return date.getDate()===t.getDate()&&date.getMonth()===t.getMonth()&&date.getFullYear()===t.getFullYear(); }
  function isFuture(date) { return date > new Date(); }
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return (
    <div style={{ position:"absolute", top:"110%", left:"50%", transform:"translateX(-50%)", background:"#fff", borderRadius:"12px", boxShadow:"0 4px 24px rgba(0,0,0,0.15)", padding:"16px", zIndex:100, width:"280px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
        <button onClick={() => setViewDate(new Date(year, month-1, 1))} style={{ background:"none", border:"none", fontSize:"16px", cursor:"pointer", padding:"4px 8px" }}>‹</button>
        <span style={{ fontWeight:"700", color:"#1a3c1a", fontSize:"14px" }}>{months[month]} {year}</span>
        <button onClick={() => setViewDate(new Date(year, month+1, 1))} style={{ background:"none", border:"none", fontSize:"16px", cursor:"pointer", padding:"4px 8px" }}>›</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", marginBottom:"4px" }}>
        {days.map(d => <div key={d} style={{ textAlign:"center", fontSize:"10px", fontWeight:"600", color:"#888", padding:"4px 0" }}>{d}</div>)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:"2px" }}>
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const selected = isSameWeek(date), today = isToday(date), future = isFuture(date);
          return <div key={i} onClick={() => { if (!future) { onSelectWeek(date); onClose(); } }}
            style={{ textAlign:"center", padding:"6px 2px", borderRadius:"6px", fontSize:"12px", cursor:future?"not-allowed":"pointer",
              background:selected?"#1a3c1a":today?"#e8f5e9":"transparent",
              color:selected?"#fff":future?"#ccc":today?"#1a3c1a":"#333",
              fontWeight:selected||today?"700":"400" }}>{date.getDate()}</div>;
        })}
      </div>
      <div style={{ marginTop:"10px", textAlign:"center" }}>
        <button onClick={() => { onSelectWeek(new Date()); onClose(); }}
          style={{ background:"#1a3c1a", color:"#fff", border:"none", borderRadius:"8px", padding:"6px 16px", fontSize:"12px", cursor:"pointer" }}>
          This Week
        </button>
      </div>
    </div>
  );
}

// ── Live running timer (admin only) ─────────────────────────
function LiveTimer({ clockIn, hourlyRate }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    function tick() {
      setElapsed(Math.floor((Date.now() - new Date(clockIn).getTime()) / 1000));
    }
    tick();
    const id = setInterval(tick, 30000); // update every 30s
    return () => clearInterval(id);
  }, [clockIn]);

  const hrs = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const hoursDecimal = elapsed / 3600;
  const cost = hourlyRate ? hoursDecimal * hourlyRate : null;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "#fff8e1", border: "1px solid #ffe082", borderRadius: "8px", padding: "4px 10px" }}>
      <span style={{ fontSize: "12px", color: "#f57c00", fontWeight: "700" }}>
        🟡 {hrs}h {mins}m
      </span>
      {cost != null && (
        <span style={{ fontSize: "12px", color: "#2e7d32", fontWeight: "700" }}>
          ${cost.toFixed(2)}
        </span>
      )}
    </div>
  );
}

// ── Mobile employee card (admin) ──────────────────────────────
function EmployeeCard({ info, empEntries, onEdit, onDelete, toLocalInput }) {
  const [expanded, setExpanded] = useState(false);
  const totalHrs = empEntries.filter(e => e.hours_worked != null).reduce((s, e) => s + parseFloat(e.hours_worked||0), 0);
  const totalPay = info?.hourly_rate ? totalHrs * info.hourly_rate : null;
  const activeEntry = empEntries.find(e => !e.clock_out);
  return (
    <div style={{ background:"#f9f9f9", borderRadius:"10px", marginBottom:"12px", overflow:"hidden", border: activeEntry ? "1px solid #ffe082" : "1px solid #e0e0e0" }}>
      <div onClick={() => setExpanded(v => !v)}
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", cursor:"pointer" }}>
        <div>
          <div style={{ fontWeight:"700", color:"#1a3c1a", fontSize:"14px" }}>{info?.name}</div>
          <div style={{ fontSize:"11px", color:"#888" }}>{info?.title}</div>
          {activeEntry && (
            <div style={{ marginTop:"4px" }}>
              <LiveTimer clockIn={activeEntry.clock_in} hourlyRate={info?.hourly_rate} />
            </div>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:"13px", fontWeight:"700", color:"#1a3c1a" }}>{fmtHours(totalHrs)}</div>
            {totalPay != null && <div style={{ fontSize:"11px", color:"#2d5a2d" }}>${totalPay.toFixed(2)}</div>}
          </div>
          <span style={{ fontSize:"16px", color:"#888" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop:"1px solid #e0e0e0" }}>
          {empEntries.length === 0 && <div style={{ padding:"12px 14px", color:"#888", fontSize:"13px" }}>No entries</div>}
          {empEntries.map(e => {
            const entryPay = (e.hours_worked != null && info?.hourly_rate) ? (e.hours_worked * info.hourly_rate).toFixed(2) : null;
            return (
              <div key={e.id} style={{ padding:"10px 14px", borderBottom:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"6px" }}>
                <div style={{ flex:"1", minWidth:"120px" }}>
                  <div style={{ fontSize:"12px", fontWeight:"600", color:"#333" }}>{fmtDate(e.clock_in)}</div>
                  <div style={{ fontSize:"11px", color:"#666" }}>
                    {fmtTime(e.clock_in)} → {e.clock_out ? fmtTime(e.clock_out) : <span style={{ color:"#f0a500" }}>Active</span>}
                  </div>
                  <div style={{ fontSize:"11px", color:"#888" }}>{fmtHours(e.hours_worked)}{entryPay ? ` · $${entryPay}` : ""}</div>
                  {e.notes && <div style={{ fontSize:"10px", color:"#aaa" }}>{e.notes}</div>}
                </div>
                <div style={{ display:"flex", gap:"4px" }}>
                  <button style={{ background:"#2d5a2d", color:"#fff", border:"none", borderRadius:"6px", padding:"4px 10px", cursor:"pointer", fontSize:"12px" }}
                    onClick={() => onEdit(e, info?.name)}>Edit</button>
                  <button style={{ background:"#dc3545", color:"#fff", border:"none", borderRadius:"6px", padding:"4px 10px", cursor:"pointer", fontSize:"12px" }}
                    onClick={() => onDelete(e.id)}>Del</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TimeTracking({ user, employee }) {
  const isAdmin = employee?.role === "admin";
  const [entries, setEntries] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [activeEntry, setActiveEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clockLoading, setClockLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [rangeType, setRangeType] = useState("1week");
  const [showCalendar, setShowCalendar] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [adminClockModal, setAdminClockModal] = useState(false);
  const [adminClockEmp, setAdminClockEmp] = useState("");
  const [adminClockTime, setAdminClockTime] = useState("");
  const [adminClockOut, setAdminClockOut] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const calendarRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const { start: rangeStart, end: rangeEnd } = getRange(selectedDate, isAdmin ? rangeType : "1week");
  const isCurrentWeek = weekStart(new Date()).getTime() === weekStart(selectedDate).getTime();

  useEffect(() => {
    function handleClick(e) { if (calendarRef.current && !calendarRef.current.contains(e.target)) setShowCalendar(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("employees").select("id, name, title, role, hourly_rate").order("name")
      .then(({ data }) => setAllEmployees(data || []));
  }, [isAdmin]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("time_entries")
      .select("*, employees(id, name, title, hourly_rate)")
      .gte("clock_in", rangeStart.toISOString())
      .lte("clock_in", rangeEnd.toISOString())
      .order("clock_in", { ascending: false });
    if (isAdmin && selectedEmployee) query = query.eq("employee_id", selectedEmployee);
    const { data, error } = await query;
    if (error) { setError("Failed to load entries."); setLoading(false); return; }
    setEntries(data || []);
    const open = (data || []).find(e => e.employee_id === employee?.id && !e.clock_out);
    setActiveEntry(open || null);
    setLoading(false);
  }, [rangeStart.toISOString(), rangeEnd.toISOString(), selectedEmployee, employee?.id, isAdmin]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  async function handleClockIn() {
    setClockLoading(true); setError(""); setSuccess("");
    const { error } = await supabase.from("time_entries").insert({ employee_id: employee.id, clock_in: new Date().toISOString() });
    if (error) setError("Clock in failed.");
    else { setSuccess("Clocked in!"); await loadEntries(); }
    setClockLoading(false);
  }
  async function handleClockOut() {
    setClockLoading(true); setError(""); setSuccess("");
    const { error } = await supabase.from("time_entries").update({ clock_out: new Date().toISOString() }).eq("id", activeEntry.id);
    if (error) setError("Clock out failed.");
    else { setSuccess("Clocked out!"); await loadEntries(); }
    setClockLoading(false);
  }
  async function handleAdminClock() {
    if (!adminClockEmp || !adminClockTime) { setError("Select employee and clock-in time."); return; }
    setError("");
    const { error } = await supabase.from("time_entries").insert({
      employee_id: adminClockEmp, clock_in: new Date(adminClockTime).toISOString(),
      clock_out: adminClockOut ? new Date(adminClockOut).toISOString() : null,
      notes: "Added by admin", edited_by: user.id, edited_at: new Date().toISOString(),
    });
    if (error) { setError("Failed. Check times."); return; }
    setAdminClockModal(false); setAdminClockEmp(""); setAdminClockTime(""); setAdminClockOut("");
    setSuccess("Entry added."); await loadEntries();
  }
  async function handleSaveEdit() {
    setError("");
    const updates = {
      clock_in: new Date(editForm.clock_in).toISOString(),
      clock_out: editForm.clock_out ? new Date(editForm.clock_out).toISOString() : null,
      notes: editForm.notes || null, edited_by: user.id, edited_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("time_entries").update(updates).eq("id", editModal.entry.id);
    if (error) { setError("Save failed."); return; }
    setEditModal(null); setSuccess("Entry updated."); await loadEntries();
  }
  async function handleDelete(entryId) {
    if (!window.confirm("Delete this entry?")) return;
    await supabase.from("time_entries").delete().eq("id", entryId);
    setSuccess("Entry deleted."); await loadEntries();
  }

  function weeklyTotals(empId) {
    return entries.filter(e => e.employee_id === empId && e.hours_worked != null)
      .reduce((sum, e) => sum + parseFloat(e.hours_worked||0), 0);
  }
  function groupedEntries() {
    const map = {};
    entries.forEach(e => {
      if (!map[e.employee_id]) map[e.employee_id] = { info: e.employees, entries: [] };
      map[e.employee_id].entries.push(e);
    });
    return Object.values(map);
  }

  const myEntries = entries.filter(e => e.employee_id === employee?.id);
  const myWeekHours = weeklyTotals(employee?.id);

  const toLocalInput = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const nowLocalInput = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  const s = {
    wrap: { padding:"16px", maxWidth:"900px", margin:"0 auto", fontFamily:"Arial, sans-serif" },
    card: { background:"#fff", borderRadius:"12px", padding:"20px", marginBottom:"16px", boxShadow:"0 1px 4px rgba(0,0,0,0.1)" },
    h2: { fontSize:"18px", fontWeight:"700", color:"#1a3c1a" },
    h3: { fontSize:"15px", fontWeight:"600", color:"#2d5a2d", marginBottom:"12px" },
    badge: (role) => ({ display:"inline-block", padding:"2px 10px", borderRadius:"12px", fontSize:"11px", fontWeight:"600", background:role==="admin"?"#fff3cd":"#d1ecf1", color:role==="admin"?"#856404":"#0c5460" }),
    clockBtn: (active) => ({ width:"100%", padding:"16px", borderRadius:"12px", border:"none", cursor:"pointer", fontSize:"16px", fontWeight:"700", background:active?"#dc3545":"#2d5a2d", color:"#fff" }),
    table: { width:"100%", borderCollapse:"collapse", fontSize:"13px" },
    th: { background:"#f0f4f0", color:"#2d5a2d", padding:"8px 10px", textAlign:"left", fontWeight:"600", borderBottom:"2px solid #d0ddd0" },
    td: { padding:"8px 10px", borderBottom:"1px solid #eee", verticalAlign:"middle" },
    editBtn: { background:"#2d5a2d", color:"#fff", border:"none", borderRadius:"6px", padding:"4px 10px", cursor:"pointer", fontSize:"12px", marginRight:"4px" },
    delBtn: { background:"#dc3545", color:"#fff", border:"none", borderRadius:"6px", padding:"4px 10px", cursor:"pointer", fontSize:"12px" },
    navBtn: { background:"#f0f4f0", border:"1px solid #ccc", borderRadius:"8px", padding:"6px 14px", cursor:"pointer", fontSize:"13px" },
    select: { padding:"8px 12px", borderRadius:"8px", border:"1px solid #ccc", fontSize:"13px", marginRight:"8px" },
    modal: { position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 },
    modalBox: { background:"#fff", borderRadius:"12px", padding:"24px", width:"min(420px, 92vw)", boxShadow:"0 4px 24px rgba(0,0,0,0.2)" },
    input: { width:"100%", padding:"8px 10px", borderRadius:"8px", border:"1px solid #ccc", fontSize:"13px", marginBottom:"10px", boxSizing:"border-box" },
    label: { fontSize:"12px", fontWeight:"600", color:"#555", display:"block", marginBottom:"3px" },
    alert: (type) => ({ padding:"10px 14px", borderRadius:"8px", marginBottom:"12px", fontSize:"13px", background:type==="error"?"#f8d7da":"#d4edda", color:type==="error"?"#721c24":"#155724" }),
  };

  const rangeLabel = rangeType==="2weeks"?"2 Weeks":rangeType==="month"?"Month":"Week";

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={{ ...s.card, background:"linear-gradient(135deg, #1a3c1a, #2d5a2d)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"8px" }}>
          <div>
            <div style={{ ...s.h2, color:"#fff", fontSize:"20px" }}>⏱ Time Tracking</div>
            <div style={{ color:"#a8d5a2", fontSize:"13px", marginTop:"2px" }}>
              {employee?.name} &nbsp;<span style={s.badge(employee?.role)}>{employee?.title||employee?.role}</span>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"8px" }}>
            {isAdmin && (
              <div style={{ display:"flex", gap:"4px" }}>
                {["1week","2weeks","month"].map(r => (
                  <button key={r} onClick={() => setRangeType(r)} style={{
                    padding:"4px 12px", borderRadius:"6px", border:"none", cursor:"pointer", fontSize:"11px", fontWeight:"600",
                    background:rangeType===r?"#fff":"rgba(255,255,255,0.2)", color:rangeType===r?"#1a3c1a":"#fff",
                  }}>{r==="1week"?"1 Week":r==="2weeks"?"2 Weeks":"Month"}</button>
                ))}
              </div>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:"8px", position:"relative" }} ref={calendarRef}>
              <button style={s.navBtn} onClick={() => { const d=new Date(selectedDate); d.setDate(d.getDate()-(rangeType==="month"?28:rangeType==="2weeks"?14:7)); setSelectedDate(d); }}>‹ Prev</button>
              <button onClick={() => setShowCalendar(v => !v)} style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:"8px", padding:"6px 12px", cursor:"pointer", color:"#fff", fontSize:"12px", minWidth: isMobile ? "140px" : "200px", textAlign:"center" }}>
                📅 {isMobile ? fmtDate(rangeStart).slice(0,6) + "–" + fmtDate(rangeEnd).slice(0,6) : `${fmtDate(rangeStart)} – ${fmtDate(rangeEnd)}`}
              </button>
              <button style={{ ...s.navBtn, opacity:isCurrentWeek?0.4:1 }} disabled={isCurrentWeek}
                onClick={() => { const d=new Date(selectedDate); d.setDate(d.getDate()+(rangeType==="month"?28:rangeType==="2weeks"?14:7)); setSelectedDate(d); }}>Next ›</button>
              {showCalendar && <WeekCalendar selectedDate={selectedDate} onSelectWeek={setSelectedDate} onClose={() => setShowCalendar(false)} />}
            </div>
          </div>
        </div>
      </div>

      {error && <div style={s.alert("error")}>{error}</div>}
      {success && <div style={s.alert("success")}>{success}</div>}

      {/* Clock In/Out */}
      {isCurrentWeek && (
        <div style={s.card}>
          <div style={s.h3}>{activeEntry ? `🟢 Clocked in at ${fmtTime(activeEntry.clock_in)}` : "🔴 Not clocked in"}</div>
          <button style={s.clockBtn(!!activeEntry)} onClick={activeEntry ? handleClockOut : handleClockIn} disabled={clockLoading}>
            {clockLoading ? "Please wait..." : activeEntry ? "CLOCK OUT" : "CLOCK IN"}
          </button>
          {isAdmin && (
            <button onClick={() => { setAdminClockModal(true); setAdminClockTime(nowLocalInput()); setAdminClockOut(""); setAdminClockEmp(""); }}
              style={{ width:"100%", marginTop:"10px", padding:"10px", borderRadius:"10px", border:"1px solid #2d5a2d", background:"transparent", color:"#2d5a2d", fontSize:"13px", fontWeight:"600", cursor:"pointer" }}>
              + Add Entry for Employee
            </button>
          )}
        </div>
      )}

      {/* Non-admin view */}
      {!isAdmin && (
        <div style={s.card}>
          <div style={s.h3}>Week Summary</div>
          <div style={{ display:"flex", gap:"12px", flexWrap:"wrap", marginBottom:"16px" }}>
            <div style={{ flex:"1", minWidth:"120px", background:"#f0f4f0", borderRadius:"10px", padding:"14px 16px" }}>
              <div style={{ fontSize:"11px", color:"#666", fontWeight:"600" }}>HOURS WORKED</div>
              <div style={{ fontSize:"22px", fontWeight:"700", color:"#1a3c1a", marginTop:"4px" }}>{fmtHours(myWeekHours)}</div>
            </div>
          </div>
          {loading ? <div style={{ color:"#888", fontSize:"13px" }}>Loading...</div> : (
            <table style={s.table}>
              <thead><tr><th style={s.th}>Date</th><th style={s.th}>In</th><th style={s.th}>Out</th><th style={s.th}>Hours</th></tr></thead>
              <tbody>
                {myEntries.length===0 && <tr><td colSpan={4} style={{ ...s.td, color:"#888", textAlign:"center" }}>No entries this week</td></tr>}
                {myEntries.map(e => (
                  <tr key={e.id}>
                    <td style={s.td}>{fmtDate(e.clock_in)}</td>
                    <td style={s.td}>{fmtTime(e.clock_in)}</td>
                    <td style={s.td}>{e.clock_out ? fmtTime(e.clock_out) : <span style={{ color:"#f0a500", fontWeight:"600" }}>Active</span>}</td>
                    <td style={s.td}>{fmtHours(e.hours_worked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Admin view */}
      {isAdmin && (
        <div style={s.card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px", flexWrap:"wrap", gap:"8px" }}>
            <div style={s.h3}>All Employees — {rangeLabel}</div>
            <select style={s.select} value={selectedEmployee||""} onChange={e => setSelectedEmployee(e.target.value||null)}>
              <option value="">All Employees</option>
              {allEmployees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {loading ? <div style={{ color:"#888", fontSize:"13px" }}>Loading...</div> : (
            isMobile ? (
              // ── Mobile: card layout ──
              groupedEntries().map(({ info, entries: empEntries }) => (
                <EmployeeCard key={info?.id} info={info} empEntries={empEntries}
                  onEdit={(e, empName) => { setEditModal({ entry:e, empName }); setEditForm({ clock_in:toLocalInput(e.clock_in), clock_out:toLocalInput(e.clock_out), notes:e.notes||"" }); }}
                  onDelete={handleDelete} toLocalInput={toLocalInput} />
              ))
            ) : (
              // ── Desktop: table layout ──
              groupedEntries().map(({ info, entries: empEntries }) => {
                const totalHrs = empEntries.filter(e => e.hours_worked!=null).reduce((s,e) => s+parseFloat(e.hours_worked||0), 0);
                const totalPay = info?.hourly_rate ? totalHrs*info.hourly_rate : null;
                return (
                  <div key={info?.id} style={{ marginBottom:"24px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px", flexWrap:"wrap", gap:"8px" }}>
                      <div>
                        <span style={{ fontWeight:"700", color:"#1a3c1a", fontSize:"14px" }}>{info?.name}</span>
                        <span style={{ color:"#888", fontSize:"12px", marginLeft:"8px" }}>{info?.title}</span>
                      </div>
                      <div style={{ display:"flex", gap:"12px", fontSize:"13px" }}>
                        <span style={{ background:"#f0f4f0", borderRadius:"8px", padding:"4px 12px" }}><strong>{fmtHours(totalHrs)}</strong></span>
                        {totalPay!=null && (
                          <span style={{ background:"#e8f5e9", borderRadius:"8px", padding:"4px 12px" }}>
                            <strong>${totalPay.toFixed(2)}</strong>
                            <span style={{ color:"#888", fontSize:"11px" }}> @ ${info.hourly_rate}/hr</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <table style={s.table}>
                      <thead><tr>
                        <th style={s.th}>Date</th><th style={s.th}>In</th><th style={s.th}>Out</th>
                        <th style={s.th}>Hours</th><th style={s.th}>Pay</th><th style={s.th}>Notes</th><th style={s.th}>Actions</th>
                      </tr></thead>
                      <tbody>
                        {empEntries.length===0 && <tr><td colSpan={7} style={{ ...s.td, color:"#888", textAlign:"center" }}>No entries</td></tr>}
                        {empEntries.map(e => {
                          const entryPay = (e.hours_worked!=null&&info?.hourly_rate) ? (e.hours_worked*info.hourly_rate).toFixed(2) : null;
                          return (
                            <tr key={e.id}>
                              <td style={s.td}>{fmtDate(e.clock_in)}</td>
                              <td style={s.td}>{fmtTime(e.clock_in)}</td>
                              <td style={s.td}>{e.clock_out ? fmtTime(e.clock_out) : <span style={{ color:"#f0a500", fontWeight:"600" }}>Active</span>}</td>
                              <td style={s.td}>{e.clock_out ? fmtHours(e.hours_worked) : <LiveTimer clockIn={e.clock_in} hourlyRate={info?.hourly_rate} />}</td>
                              <td style={s.td}>{entryPay?`$${entryPay}`:"—"}</td>
                              <td style={s.td}>{e.notes||"—"}</td>
                              <td style={s.td}>
                                <button style={s.editBtn} onClick={() => { setEditModal({entry:e,empName:info?.name}); setEditForm({clock_in:toLocalInput(e.clock_in),clock_out:toLocalInput(e.clock_out),notes:e.notes||""}); }}>Edit</button>
                                <button style={s.delBtn} onClick={() => handleDelete(e.id)}>Del</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })
            )
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editModal && (
        <div style={s.modal} onClick={() => setEditModal(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ ...s.h2, marginBottom:"16px" }}>Edit Entry — {editModal.empName}</div>
            <label style={s.label}>Clock In</label>
            <input type="datetime-local" style={s.input} value={editForm.clock_in} onChange={e => setEditForm(f => ({...f,clock_in:e.target.value}))} />
            <label style={s.label}>Clock Out</label>
            <input type="datetime-local" style={s.input} value={editForm.clock_out} onChange={e => setEditForm(f => ({...f,clock_out:e.target.value}))} />
            <label style={s.label}>Notes</label>
            <input type="text" style={s.input} placeholder="e.g. Forgot to clock out" value={editForm.notes} onChange={e => setEditForm(f => ({...f,notes:e.target.value}))} />
            {error && <div style={s.alert("error")}>{error}</div>}
            <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end", marginTop:"8px" }}>
              <button style={s.navBtn} onClick={() => setEditModal(null)}>Cancel</button>
              <button style={{ ...s.editBtn, padding:"8px 20px", fontSize:"13px" }} onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Add Entry Modal */}
      {adminClockModal && (
        <div style={s.modal} onClick={() => setAdminClockModal(false)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ ...s.h2, marginBottom:"16px" }}>Add Time Entry</div>
            <label style={s.label}>Employee</label>
            <select style={{ ...s.input, height:"42px" }} value={adminClockEmp} onChange={e => setAdminClockEmp(e.target.value)}>
              <option value="">Select employee...</option>
              {allEmployees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <label style={s.label}>Clock In</label>
            <input type="datetime-local" style={s.input} value={adminClockTime} onChange={e => setAdminClockTime(e.target.value)} />
            <label style={s.label}>Clock Out (optional)</label>
            <input type="datetime-local" style={s.input} value={adminClockOut} onChange={e => setAdminClockOut(e.target.value)} />
            {error && <div style={s.alert("error")}>{error}</div>}
            <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end", marginTop:"8px" }}>
              <button style={s.navBtn} onClick={() => setAdminClockModal(false)}>Cancel</button>
              <button style={{ ...s.editBtn, padding:"8px 20px", fontSize:"13px" }} onClick={handleAdminClock}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
