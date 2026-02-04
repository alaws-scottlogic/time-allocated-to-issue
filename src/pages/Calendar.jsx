import React, { useEffect, useState } from "react";
import sheetsClient from "../lib/sheetsClient";

const HOUR_HEIGHT = 80;

const ISSUE_COLORS = [
  { bg: "#e3f2fd", border: "#1976d2", text: "#1565c0" }, // Blue
  { bg: "#f3e5f5", border: "#9c27b0", text: "#7b1fa2" }, // Purple
  { bg: "#e8f5e9", border: "#4caf50", text: "#2e7d32" }, // Green
  { bg: "#fff3e0", border: "#ff9800", text: "#e65100" }, // Orange
  { bg: "#fce4ec", border: "#e91e63", text: "#c2185b" }, // Pink
  { bg: "#e0f2f1", border: "#009688", text: "#00796b" }, // Teal
  { bg: "#fffde7", border: "#fbc02d", text: "#f57f17" }, // Yellow
  { bg: "#efebe9", border: "#795548", text: "#5d4037" }, // Brown
];

function getIssueColor(issue) {
  if (!issue) return ISSUE_COLORS[0];
  const str = String(issue);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % ISSUE_COLORS.length;
  return ISSUE_COLORS[index];
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

export default function Calendar() {
  const [timings, setTimings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewType, setViewType] = useState("day"); // 'day' or 'week'
  const [modal, setModal] = useState(null); // { id, date, start, end, issue }
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const spreadsheetId =
        localStorage.getItem("spreadsheetId") ||
        (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
      if (!spreadsheetId) {
        setError("No spreadsheet configured");
        setTimings([]);
      } else {
        const clientId =
          (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
        const data = await sheetsClient.getTimings(spreadsheetId, clientId);
        setTimings(data || []);
      }
    } catch (err) {
      console.error(err);
      setError("Could not load timings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <div style={{ padding: 20 }}>Loading timings...</div>;
  if (error) return <div style={{ padding: 20, color: "red" }}>{error}</div>;

  const toLocalISO = (d) => {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  };

  const handleTimelineClick = (e, day, minH) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const clickedHours = y / HOUR_HEIGHT;
    const totalMinutes = Math.floor((minH + clickedHours) * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    // Use day.baseIso or fallback to today
    const baseDate = day.baseIso ? new Date(day.baseIso) : new Date();
    const startDate = new Date(baseDate);
    startDate.setHours(h, m, 0, 0);

    const endDate = new Date(startDate.getTime() + 30 * 60000);

    setModal({
      id: null,
      date: day.date,
      start: toLocalISO(startDate),
      end: toLocalISO(endDate),
      issue: "",
    });
  };

  const handleEntryClick = (e, t) => {
    e.stopPropagation();
    const start = new Date(t.start);
    const end = new Date(start.getTime() + (t.duration || 0) * 1000);

    setModal({
      id: t.id,
      date: start.toLocaleDateString(),
      start: toLocalISO(start),
      end: toLocalISO(end),
      issue: t.issue || "",
    });
  };

  const handleSaveEntry = async () => {
    if (!modal.issue || !modal.start || !modal.end) {
      alert("Please fill in all fields");
      return;
    }

    setSaving(true);
    try {
      const spreadsheetId =
        localStorage.getItem("spreadsheetId") ||
        (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
      const clientId =
        (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;

      const start = new Date(modal.start);
      const end = new Date(modal.end);
      const duration = Math.round((end - start) / 1000);

      if (duration <= 0) {
        alert("End time must be after start time");
        setSaving(false);
        return;
      }

      const entry = {
        issue: modal.issue,
        start: start.toISOString(),
        duration: duration,
      };

      if (modal.id) {
        await sheetsClient.updateTiming(
          spreadsheetId,
          modal.id,
          entry,
          clientId,
        );
      } else {
        await sheetsClient.appendTiming(spreadsheetId, entry, clientId);
      }

      setModal(null);
      await load(); // Reload all timings
    } catch (err) {
      console.error(err);
      alert("Failed to save entry");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = async () => {
    if (!modal.id) return;
    if (!window.confirm("Are you sure you want to delete this entry?")) return;

    setDeleting(true);
    try {
      const spreadsheetId =
        localStorage.getItem("spreadsheetId") ||
        (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
      const clientId =
        (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;

      await sheetsClient.deleteTiming(spreadsheetId, modal.id, clientId);
      setModal(null);
      await load();
    } catch (err) {
      console.error(err);
      alert("Failed to delete entry");
    } finally {
      setDeleting(false);
    }
  };

  const groupTimingsByDay = (timings) => {
    const groups = {};
    timings.forEach((t) => {
      if (!t.start) return;
      const d = new Date(t.start);
      // Use local date string as key
      const dateKey = d.toLocaleDateString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(t);
    });

    const sortedDays = Object.keys(groups).sort(
      (a, b) => new Date(b) - new Date(a),
    );

    return sortedDays.map((date) => {
      const dayTimings = groups[date].sort(
        (a, b) => new Date(a.start) - new Date(b.start),
      );

      // Extract a base ISO date for this group (from the first timing found)
      const baseIso = dayTimings[0]?.start || null;

      // Calculate start and end hours for this day's view
      let minHour = 9; // default 9am
      let maxHour = 17; // default 5pm

      if (dayTimings.length > 0) {
        const first = new Date(dayTimings[0].start).getHours();
        const lastEntry = dayTimings[dayTimings.length - 1];
        const lastDate = new Date(
          new Date(lastEntry.start).getTime() +
            (lastEntry.duration || 0) * 1000,
        );
        const last = lastDate.getHours();

        minHour = Math.min(minHour, first);
        maxHour = Math.max(maxHour, last + 1);
      }

      return { date, baseIso, timings: dayTimings, minHour, maxHour };
    });
  };

  const formatHour = (hour) => {
    const period = hour >= 12 ? "PM" : "AM";
    const h = hour % 12 || 12;
    return `${h} ${period}`;
  };

  const formatTime = (isoString) => {
    return new Date(isoString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "0m";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h > 0 ? h + "h " : ""}${m}m`;
  };

  if (loading) return <div style={{ padding: 20 }}>Loading timings...</div>;
  if (error) return <div style={{ padding: 20, color: "red" }}>{error}</div>;

  const daysDataRaw = groupTimingsByDay(timings);

  // For daily view, we only want "today".
  // If today has no timings, we create an empty placeholder for it.
  const todayDateStr = new Date().toLocaleDateString();
  const dayViewData =
    viewType === "day"
      ? daysDataRaw.find((d) => d.date === todayDateStr)
        ? [daysDataRaw.find((d) => d.date === todayDateStr)]
        : [
            {
              date: todayDateStr,
              baseIso: new Date().toISOString(),
              timings: [],
              minHour: 9,
              maxHour: 17,
            },
          ]
      : [];

  const weeksData = [];
  if (viewType === "week") {
    const weeks = {};
    daysDataRaw.forEach((day) => {
      const d = new Date(day.timings[0]?.start);
      if (!d) return;
      const weekKey = `${d.getFullYear()}-W${getWeekNumber(d)}`;
      if (!weeks[weekKey])
        weeks[weekKey] = { id: weekKey, days: [], minHour: 9, maxHour: 17 };
      weeks[weekKey].days.push(day);
      weeks[weekKey].minHour = Math.min(weeks[weekKey].minHour, day.minHour);
      weeks[weekKey].maxHour = Math.max(weeks[weekKey].maxHour, day.maxHour);
    });
    // Sort weeks descending, but days within week ascending
    const sortedWeekKeys = Object.keys(weeks).sort().reverse();
    sortedWeekKeys.forEach((k) => {
      weeks[k].days.sort(
        (a, b) => new Date(a.timings[0]?.start) - new Date(b.timings[0]?.start),
      );
      weeksData.push(weeks[k]);
    });
  }

  const renderDayTimeline = (day, globalMinHour, showGutter = true) => {
    const hours = [];
    const minH = globalMinHour !== undefined ? globalMinHour : day.minHour;
    const maxH = day.maxHour;
    for (let h = minH; h <= maxH; h++) {
      hours.push(h);
    }

    return (
      <div
        style={{
          display: "flex",
          position: "relative",
          minHeight: hours.length * HOUR_HEIGHT,
          flex: 1,
        }}
      >
        {/* Time Gutter */}
        {showGutter && (
          <div style={{ width: 60, flexShrink: 0, position: "relative" }}>
            {hours.map((h) => (
              <div
                key={h}
                style={{
                  height: HOUR_HEIGHT,
                  fontSize: 11,
                  color: "#999",
                  textAlign: "right",
                  paddingRight: 12,
                  position: "relative",
                }}
              >
                <span style={{ position: "absolute", top: -8, right: 12 }}>
                  {formatHour(h)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Timeline Content */}
        <div
          onClick={(e) => handleTimelineClick(e, day, minH)}
          style={{
            flex: 1,
            position: "relative",
            borderLeft: "1px solid #eee",
            background: "#fcfcfc",
            minWidth: 150,
            cursor: "cell",
          }}
        >
          {/* Grid Lines */}
          {hours.map((h) => (
            <div
              key={h}
              style={{
                height: HOUR_HEIGHT,
                borderTop: "1px solid #f0f0f0",
                boxSizing: "border-box",
              }}
            />
          ))}

          {/* Timings */}
          {day.timings.map((t, idx) => {
            const startDate = new Date(t.start);
            const startMin = startDate.getHours() * 60 + startDate.getMinutes();
            const viewStartMin = minH * 60;
            const top = ((startMin - viewStartMin) / 60) * HOUR_HEIGHT;

            const durationSec = t.duration || 0;
            const height = (durationSec / 3600) * HOUR_HEIGHT;
            const colors = getIssueColor(t.issue);

            return (
              <div
                key={idx}
                onClick={(e) => handleEntryClick(e, t)}
                style={{
                  position: "absolute",
                  top,
                  left: 4,
                  right: 4,
                  height: Math.max(height, 24),
                  backgroundColor: colors.bg,
                  borderLeft: `3px solid ${colors.border}`,
                  borderRadius: 4,
                  padding: "2px 4px",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                  zIndex: 2,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 11,
                    color: colors.text,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  #{t.issue}
                </div>
                {height > 30 && (
                  <div
                    style={{ fontSize: 9, color: colors.border, opacity: 0.8 }}
                  >
                    {formatDuration(t.duration)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Gaps */}
          {day.timings.map((t, i) => {
            if (i === day.timings.length - 1) return null;
            const next = day.timings[i + 1];
            const endOfCurrent = new Date(
              new Date(t.start).getTime() + (t.duration || 0) * 1000,
            );
            const startOfNext = new Date(next.start);

            if (
              startOfNext > endOfCurrent &&
              startOfNext - endOfCurrent > 60000
            ) {
              const gapStartMin =
                endOfCurrent.getHours() * 60 + endOfCurrent.getMinutes();
              const viewStartMin = minH * 60;
              const top = ((gapStartMin - viewStartMin) / 60) * HOUR_HEIGHT;
              const gapDurationSec = (startOfNext - endOfCurrent) / 1000;
              const height = (gapDurationSec / 3600) * HOUR_HEIGHT;

              return (
                <div
                  key={`gap-${i}`}
                  style={{
                    position: "absolute",
                    top,
                    left: 4,
                    right: 4,
                    height,
                    background:
                      "repeating-linear-gradient(45deg, #fffcf5, #fffcf5 5px, #fff5e6 5px, #fff5e6 10px)",
                    borderLeft: "3px solid #ff9800",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1,
                    opacity: 0.6,
                  }}
                >
                  {height > 20 && (
                    <span
                      style={{
                        fontSize: 9,
                        color: "#e65100",
                        fontStyle: "italic",
                        fontWeight: 600,
                      }}
                    >
                      {formatDuration(gapDurationSec)}
                    </span>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        padding: 24,
        maxWidth: viewType === "week" ? "100%" : 900,
        margin: "0 auto",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Calendar</h2>
        <div
          style={{
            display: "flex",
            background: "#f0f0f0",
            padding: 4,
            borderRadius: 8,
          }}
        >
          <button
            onClick={() => setViewType("day")}
            style={{
              padding: "6px 12px",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: viewType === "day" ? "#fff" : "transparent",
              boxShadow:
                viewType === "day" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Day
          </button>
          <button
            onClick={() => setViewType("week")}
            style={{
              padding: "6px 12px",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: viewType === "week" ? "#fff" : "transparent",
              boxShadow:
                viewType === "week" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Week
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        {viewType === "day" ? (
          dayViewData.length === 0 ? (
            <div>No data found for the calendar view.</div>
          ) : (
            dayViewData.map((day) => (
              <div key={day.date}>
                <h3
                  style={{
                    margin: "0 0 16px 0",
                    fontSize: 16,
                    color: "#555",
                    fontWeight: 600,
                  }}
                >
                  {day.date === new Date().toLocaleDateString()
                    ? "Today"
                    : day.date}
                </h3>
                {renderDayTimeline(day)}
              </div>
            ))
          )
        ) : weeksData.length === 0 ? (
          <div>No data found for the calendar view.</div>
        ) : (
          weeksData.map((week) => (
            <div
              key={week.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 20,
                background: "#fff",
              }}
            >
              <h3
                style={{
                  margin: "0 0 20px 0",
                  fontSize: 18,
                  color: "#333",
                  fontWeight: 700,
                }}
              >
                Week {week.id}
              </h3>
              <div style={{ display: "flex", overflowX: "auto", gap: 0 }}>
                {/* Global Gutter for the week */}
                <div style={{ width: 60, flexShrink: 0 }}>
                  {Array.from({ length: week.maxHour - week.minHour + 1 }).map(
                    (_, i) => (
                      <div
                        key={i}
                        style={{
                          height: HOUR_HEIGHT,
                          fontSize: 11,
                          color: "#999",
                          textAlign: "right",
                          paddingRight: 12,
                          position: "relative",
                        }}
                      >
                        <span
                          style={{ position: "absolute", top: -8, right: 12 }}
                        >
                          {formatHour(week.minHour + i)}
                        </span>
                      </div>
                    ),
                  )}
                </div>
                {week.days.map((day) => (
                  <div key={day.date} style={{ flex: 1, minWidth: 150 }}>
                    <div
                      style={{
                        textAlign: "center",
                        padding: "8px 0",
                        borderBottom: "1px solid #eee",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#666",
                      }}
                    >
                      {new Date(day.timings[0]?.start).toLocaleDateString([], {
                        weekday: "short",
                        day: "numeric",
                      })}
                    </div>
                    {renderDayTimeline(day, week.minHour, false)}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {modal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: 24,
              borderRadius: 12,
              width: "100%",
              maxWidth: 400,
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 20 }}>
              {modal.id ? "Edit Time Entry" : "New Time Entry"}
            </h3>
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <label
                  style={{ display: "block", fontSize: 13, marginBottom: 4 }}
                >
                  Issue Number
                </label>
                <input
                  autoFocus
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid #ddd",
                  }}
                  value={modal.issue}
                  onChange={(e) =>
                    setModal({ ...modal, issue: e.target.value })
                  }
                  placeholder="e.g. 123"
                />
              </div>
              <div>
                <label
                  style={{ display: "block", fontSize: 13, marginBottom: 4 }}
                >
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid #ddd",
                  }}
                  value={modal.start}
                  onChange={(e) =>
                    setModal({ ...modal, start: e.target.value })
                  }
                />
              </div>
              <div>
                <label
                  style={{ display: "block", fontSize: 13, marginBottom: 4 }}
                >
                  End Time
                </label>
                <input
                  type="datetime-local"
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid #ddd",
                  }}
                  value={modal.end}
                  onChange={(e) => setModal({ ...modal, end: e.target.value })}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  justifyContent: "space-between",
                  marginTop: 8,
                }}
              >
                {modal.id ? (
                  <button
                    disabled={saving || deleting}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 6,
                      border: "1px solid #ffcdd2",
                      background: "#ffebee",
                      color: "#c62828",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                    onClick={handleDeleteEntry}
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                ) : (
                  <div />
                )}
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    disabled={saving || deleting}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 6,
                      border: "1px solid #ddd",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={saving || deleting}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 6,
                      border: "none",
                      background: "#1976d2",
                      color: "#fff",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                    onClick={handleSaveEntry}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
