import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// ─── Helpers ────────────────────────────────────────────────
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
function weekRange(date = new Date()) {
  // Week runs Sat → Fri
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun,6=Sat
  const diffToSat = (day >= 6) ? 0 : day + 1;
  const sat = new Date(d);
  sat.setDate(d.getDate() - diffToSat);
  sat.setHours(0, 0, 0, 0);
  const fri = new Date(sat);
  fri.setDate(sat.getDate() + 6);
  fri.setHours(23, 59, 59, 999);
  return { start: sat, end: fri };
}

// ─── Main Component ─────────────────────────────────────────
export default function TimeTracking({ user, employee }) {
  const isAdmin = employee?.role === "admin";
  const isManager = employee?.role === "manager";

  const [entries, setEntries] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [activeEntry, setActiveEntry] = useState(null); // current open clock-in
  const [loading, setLoading] = useState(true);
  const [clockLoading, setClockLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null); // admin filter
  const [editModal, setEditModal] = useState(null); // { entry }
  const [editForm, setEditForm] = useState({});
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── Computed week range ──
  const weekDate = new Date();
  weekDate.setDate(weekDate.getDate() - weekOffset * 7);
  const { start: weekStart, end: weekEnd } = weekRange(weekDate);

  // ── Load employees (admin only) ──
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("employees").select("id, name, title, role, hourly_rate")
      .order("name")
      .then(({ data }) => setAllEmployees(data || []));
  }, [isAdmin]);

  // ── Load entries ──
  const loadEntries = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("time_entries")
      .select("*, employees(id, name, title, hourly_rate)")
      .gte("clock_in", weekStart.toISOString())
      .lte("clock_in", weekEnd.toISOString())
      .order("clock_in", { ascending: false });

    if (isAdmin && selectedEmployee) {
      query = query.eq("employee_id", selectedEmployee);
    }

    const { data, error } = await query;
    if (error) { setError("Failed to load entries."); setLoading(false); return; }

    setEntries(data || []);

    // Find open clock-in for current user
    const open = (data || []).find(
      e => e.employee_id === employee?.id && !e.clock_out
    );
    setActiveEntry(open || null);
    setLoading(false);
  }, [weekStart.toISOString(), weekEnd.toISOString(), selectedEmployee, employee?.id, isAdmin]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // ── Clock In ──
  async function handleClockIn() {
    setClockLoading(true); setError(""); setSuccess("");
    const { error } = await supabase.from("time_entries").insert({
      employee_id: employee.id,
      clock_in: new Date().toISOString(),
    });
    if (error) setError("Clock in failed. Try again.");
    else { setSuccess("Clocked in!"); await loadEntries(); }
    setClockLoading(false);
  }

  // ── Clock Out ──
  async function handleClockOut() {
    setClockLoading(true); setError(""); setSuccess("");
    const { error } = await supabase.from("time_entries")
      .update({ clock_out: new Date().toISOString() })
      .eq("id", activeEntry.id);
    if (error) setError("Clock out failed. Try again.");
    else { setSuccess("Clocked out!"); await loadEntries(); }
    setClockLoading(false);
  }

  // ── Admin: Save edit ──
  async function handleSaveEdit() {
    setError("");
    const { id } = editModal.entry;
    const updates = {
      clock_in: new Date(editForm.clock_in).toISOString(),
      clock_out: editForm.clock_out ? new Date(editForm.clock_out).toISOString() : null,
      notes: editForm.notes || null,
      edited_by: user.id,
      edited_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("time_entries").update(updates).eq("id", id);
    if (error) { setError("Save failed. Check dates."); return; }
    setEditModal(null);
    setSuccess("Entry updated.");
    await loadEntries();
  }

  // ── Admin: Delete entry ──
  async function handleDelete(entryId) {
    if (!window.confirm("Delete this entry?")) return;
    await supabase.from("time_entries").delete().eq("id", entryId);
    setSuccess("Entry deleted.");
    await loadEntries();
  }

  // ── Weekly totals ──
  function weeklyTotals(empId) {
    const empEntries = entries.filter(e => e.employee_id === empId && e.hours_worked != null);
    const totalHours = empEntries.reduce((sum, e) => sum + parseFloat(e.hours_worked || 0), 0);
    return totalHours;
  }

  // ── Group entries by employee (admin view) ──
  function groupedEntries() {
    const map = {};
    entries.forEach(e => {
      const eid = e.employee_id;
      if (!map[eid]) map[eid] = { info: e.employees, entries: [] };
      map[eid].entries.push(e);
    });
    return Object.values(map);
  }

  // ── My own entries (non-admin) ──
  const myEntries = entries.filter(e => e.employee_id === employee?.id);
  const myWeekHours = weeklyTotals(employee?.id);
  const myWeekPay = employee?.hourly_rate ? (myWeekHours * employee.hourly_rate) : null;

  // ─── Styles ──────────────────────────────────────────────
  const s = {
    wrap: { padding: "16px", maxWidth: "900px", margin: "0 auto", fontFamily: "Arial, sans-serif" },
    card: { background: "#fff", borderRadius: "12px", padding: "20px", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" },
    h2: { fontSize: "18px", fontWeight: "700", color: "#1a3c1a", marginBottom: "4px" },
    h3: { fontSize: "15px", fontWeight: "600", color: "#2d5a2d", marginBottom: "12px" },
    badge: (role) => ({
      display: "inline-block", padding: "2px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "600",
      background: role === "admin" ? "#fff3cd" : role === "manager" ? "#d1ecf1" : "#d4edda",
      color: role === "admin" ? "#856404" : role === "manager" ? "#0c5460" : "#155724",
    }),
    clockBtn: (active) => ({
      width: "100%", padding: "16px", borderRadius: "12px", border: "none", cursor: "pointer",
      fontSize: "16px", fontWeight: "700", letterSpacing: "0.5px",
      background: active ? "#dc3545" : "#2d5a2d",
      color: "#fff", transition: "opacity 0.2s",
    }),
    table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
    th: { background: "#f0f4f0", color: "#2d5a2d", padding: "8px 10px", textAlign: "left", fontWeight: "600", borderBottom: "2px solid #d0ddd0" },
    td: { padding: "8px 10px", borderBottom: "1px solid #eee", verticalAlign: "middle" },
    editBtn: { background: "#2d5a2d", color: "#fff", border: "none", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "12px", marginRight: "4px" },
    delBtn: { background: "#dc3545", color: "#fff", border: "none", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "12px" },
    select: { padding: "8px 12px", borderRadius: "8px", border: "1px solid #ccc", fontSize: "13px", marginRight: "8px" },
    navBtn: { background: "#f0f4f0", border: "1px solid #ccc", borderRadius: "8px", padding: "6px 14px", cursor: "pointer", fontSize: "13px" },
    modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
    modalBox: { background: "#fff", borderRadius: "12px", padding: "24px", width: "min(420px, 92vw)", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" },
    input: { width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #ccc", fontSize: "13px", marginBottom: "10px", boxSizing: "border-box" },
    label: { fontSize: "12px", fontWeight: "600", color: "#555", display: "block", marginBottom: "3px" },
    alert: (type) => ({ padding: "10px 14px", borderRadius: "8px", marginBottom: "12px", fontSize: "13px", background: type === "error" ? "#f8d7da" : "#d4edda", color: type === "error" ? "#721c24" : "#155724" }),
    summaryBox: { display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" },
    summaryCard: (color) => ({ flex: "1", minWidth: "120px", background: color, borderRadius: "10px", padding: "14px 16px" }),
  };

  const toLocalInput = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={{ ...s.card, background: "linear-gradient(135deg, #1a3c1a, #2d5a2d)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <div>
            <div style={{ ...s.h2, color: "#fff", fontSize: "20px" }}>⏱ Time Tracking</div>
            <div style={{ color: "#a8d5a2", fontSize: "13px", marginTop: "2px" }}>
              {employee?.name} &nbsp;<span style={s.badge(employee?.role)}>{employee?.title || employee?.role}</span>
            </div>
          </div>
          {/* Week Nav */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button style={s.navBtn} onClick={() => setWeekOffset(w => w + 1)}>‹ Prev</button>
            <span style={{ fontSize: "13px", color: "#fff", minWidth: "160px", textAlign: "center" }}>
              {fmtDate(weekStart)} – {fmtDate(weekEnd)}
            </span>
            <button style={{ ...s.navBtn, opacity: weekOffset === 0 ? 0.4 : 1 }} disabled={weekOffset === 0} onClick={() => setWeekOffset(w => w - 1)}>Next ›</button>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && <div style={s.alert("error")}>{error}</div>}
      {success && <div style={s.alert("success")}>{success}</div>}

      {/* ── CLOCK IN / OUT (all roles) ── */}
      {weekOffset === 0 && (
        <div style={s.card}>
          <div style={s.h3}>
            {activeEntry ? `🟢 Clocked in at ${fmtTime(activeEntry.clock_in)}` : "🔴 Not clocked in"}
          </div>
          <button
            style={s.clockBtn(!!activeEntry)}
            onClick={activeEntry ? handleClockOut : handleClockIn}
            disabled={clockLoading}
          >
            {clockLoading ? "Please wait..." : activeEntry ? "CLOCK OUT" : "CLOCK IN"}
          </button>
        </div>
      )}

      {/* ── MY WEEK SUMMARY (non-admin) ── */}
      {!isAdmin && (
        <div style={s.card}>
          <div style={s.h3}>This Week</div>
          <div style={s.summaryBox}>
            <div style={s.summaryCard("#f0f4f0")}>
              <div style={{ fontSize: "11px", color: "#666", fontWeight: "600" }}>HOURS WORKED</div>
              <div style={{ fontSize: "22px", fontWeight: "700", color: "#1a3c1a", marginTop: "4px" }}>{fmtHours(myWeekHours)}</div>
            </div>
            {/* Pay only visible if they're admin — managers/staff don't see pay */}
            {isAdmin && myWeekPay != null && (
              <div style={s.summaryCard("#e8f5e9")}>
                <div style={{ fontSize: "11px", color: "#666", fontWeight: "600" }}>WEEK PAY (EST.)</div>
                <div style={{ fontSize: "22px", fontWeight: "700", color: "#1a3c1a", marginTop: "4px" }}>${myWeekPay.toFixed(2)}</div>
              </div>
            )}
          </div>

          {/* My entries table */}
          {loading ? <div style={{ color: "#888", fontSize: "13px" }}>Loading...</div> : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Date</th>
                  <th style={s.th}>In</th>
                  <th style={s.th}>Out</th>
                  <th style={s.th}>Hours</th>
                </tr>
              </thead>
              <tbody>
                {myEntries.length === 0 && (
                  <tr><td colSpan={4} style={{ ...s.td, color: "#888", textAlign: "center" }}>No entries this week</td></tr>
                )}
                {myEntries.map(e => (
                  <tr key={e.id}>
                    <td style={s.td}>{fmtDate(e.clock_in)}</td>
                    <td style={s.td}>{fmtTime(e.clock_in)}</td>
                    <td style={s.td}>{e.clock_out ? fmtTime(e.clock_out) : <span style={{ color: "#f0a500", fontWeight: "600" }}>Active</span>}</td>
                    <td style={s.td}>{fmtHours(e.hours_worked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── ADMIN VIEW ── */}
      {isAdmin && (
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
            <div style={s.h3}>All Employees</div>
            <select style={s.select} value={selectedEmployee || ""} onChange={e => setSelectedEmployee(e.target.value || null)}>
              <option value="">All Employees</option>
              {allEmployees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {loading ? <div style={{ color: "#888", fontSize: "13px" }}>Loading...</div> : (
            groupedEntries().map(({ info, entries: empEntries }) => {
              const totalHrs = empEntries.filter(e => e.hours_worked != null).reduce((s, e) => s + parseFloat(e.hours_worked || 0), 0);
              const weekPay = info?.hourly_rate ? totalHrs * info.hourly_rate : null;
              return (
                <div key={info?.id} style={{ marginBottom: "24px" }}>
                  {/* Employee header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                    <div>
                      <span style={{ fontWeight: "700", color: "#1a3c1a", fontSize: "14px" }}>{info?.name}</span>
                      <span style={{ color: "#888", fontSize: "12px", marginLeft: "8px" }}>{info?.title}</span>
                    </div>
                    <div style={{ display: "flex", gap: "12px", fontSize: "13px" }}>
                      <span style={{ background: "#f0f4f0", borderRadius: "8px", padding: "4px 12px" }}>
                        <strong>{fmtHours(totalHrs)}</strong>
                      </span>
                      {weekPay != null && (
                        <span style={{ background: "#e8f5e9", borderRadius: "8px", padding: "4px 12px" }}>
                          <strong>${weekPay.toFixed(2)}</strong>
                          <span style={{ color: "#888", fontSize: "11px" }}> @ ${info.hourly_rate}/hr</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Date</th>
                        <th style={s.th}>In</th>
                        <th style={s.th}>Out</th>
                        <th style={s.th}>Hours</th>
                        <th style={s.th}>Pay</th>
                        <th style={s.th}>Notes</th>
                        <th style={s.th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {empEntries.length === 0 && (
                        <tr><td colSpan={7} style={{ ...s.td, color: "#888", textAlign: "center" }}>No entries</td></tr>
                      )}
                      {empEntries.map(e => {
                        const entryPay = (e.hours_worked != null && info?.hourly_rate) ? (e.hours_worked * info.hourly_rate).toFixed(2) : null;
                        return (
                          <tr key={e.id}>
                            <td style={s.td}>{fmtDate(e.clock_in)}</td>
                            <td style={s.td}>{fmtTime(e.clock_in)}</td>
                            <td style={s.td}>{e.clock_out ? fmtTime(e.clock_out) : <span style={{ color: "#f0a500", fontWeight: "600" }}>Active</span>}</td>
                            <td style={s.td}>{fmtHours(e.hours_worked)}</td>
                            <td style={s.td}>{entryPay ? `$${entryPay}` : "—"}</td>
                            <td style={s.td}>{e.notes || "—"}</td>
                            <td style={s.td}>
                              <button style={s.editBtn} onClick={() => {
                                setEditModal({ entry: e, empName: info?.name });
                                setEditForm({ clock_in: toLocalInput(e.clock_in), clock_out: toLocalInput(e.clock_out), notes: e.notes || "" });
                              }}>Edit</button>
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
          )}
        </div>
      )}

      {/* ── EDIT MODAL (admin only) ── */}
      {editModal && (
        <div style={s.modal} onClick={() => setEditModal(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ ...s.h2, marginBottom: "16px" }}>Edit Entry — {editModal.empName}</div>
            <label style={s.label}>Clock In</label>
            <input type="datetime-local" style={s.input} value={editForm.clock_in} onChange={e => setEditForm(f => ({ ...f, clock_in: e.target.value }))} />
            <label style={s.label}>Clock Out</label>
            <input type="datetime-local" style={s.input} value={editForm.clock_out} onChange={e => setEditForm(f => ({ ...f, clock_out: e.target.value }))} />
            <label style={s.label}>Notes</label>
            <input type="text" style={s.input} placeholder="e.g. Forgot to clock out" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            {error && <div style={s.alert("error")}>{error}</div>}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" }}>
              <button style={{ ...s.navBtn }} onClick={() => setEditModal(null)}>Cancel</button>
              <button style={{ ...s.editBtn, padding: "8px 20px", fontSize: "13px" }} onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
