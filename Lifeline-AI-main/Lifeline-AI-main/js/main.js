/**
 * LifeLine AI – main.js
 * Dashboard UI controller:
 *   - Sidebar navigation
 *   - Symptom analysis UI
 *   - Map initialisation (Leaflet)
 *   - Hospital cards rendering
 *   - Decision engine display
 *   - Blood availability display
 */

"use strict";

// ── State ──────────────────────────────────────────────
const state = {
  map: null,
  userMarker: null,
  hospitalMarkers: [],
  userLocation: null,
  hospitals: [],
  bloodData: null,
  severity: 5,
  selectedTags: new Set(),
  analysisResult: null,
  activeTab: "symptom",
  currentUser: null,
};

// ── DOM Ready ──────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initSidebar();
  initSeverityDots();
  initSymptomTags();
  initBloodFilters();
  initMap();
  loadBloodData();
  updateTopbarTime();
  setInterval(updateTopbarTime, 30000);
  showTab("symptom");
});

// ── Auth ───────────────────────────────────────────────
function initAuth() {
  const user = JSON.parse(sessionStorage.getItem("lifeline_user") || "null");
  if (!user) {
    // Redirect to login (commented for demo - remove comment for prod)
    // window.location.href = "login.html";
    state.currentUser = { name: "Guest User", role: "Patient", initials: "GU" };
  } else {
    state.currentUser = user;
  }

  // Set user info in sidebar
  const nameEl = document.getElementById("sidebarUserName");
  const roleEl = document.getElementById("sidebarUserRole");
  const initEl = document.getElementById("sidebarAvatarInit");
  const topInitEl = document.getElementById("topbarAvatarInit");

  if (nameEl) nameEl.textContent = state.currentUser.name;
  if (roleEl) roleEl.textContent = state.currentUser.role || "Patient";
  if (initEl) initEl.textContent = state.currentUser.initials || state.currentUser.name[0];
  if (topInitEl) topInitEl.textContent = state.currentUser.initials || state.currentUser.name[0];
}

// ── Sidebar Navigation ─────────────────────────────────
function initSidebar() {
  document.querySelectorAll(".nav-item[data-tab]").forEach((item) => {
    item.addEventListener("click", () => {
      const tab = item.dataset.tab;
      showTab(tab);
    });
  });

  // Mobile sidebar toggle
  const toggleBtn = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  // Logout
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem("lifeline_user");
      window.location.href = "login.html";
    });
  }
}

function showTab(tabName) {
  state.activeTab = tabName;

  // Update nav items
  document.querySelectorAll(".nav-item[data-tab]").forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === tabName);
  });

  // Show/hide panels
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });

  // Lazy-init map when map tab is opened
  if (tabName === "hospitals" && state.map) {
    setTimeout(() => state.map.invalidateSize(), 100);
  }
}

// ── Top Bar Time ───────────────────────────────────────
function updateTopbarTime() {
  const el = document.getElementById("topbarTime");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Severity Dots ──────────────────────────────────────
function initSeverityDots() {
  const dots = document.querySelectorAll(".severity-dot");
  dots.forEach((dot, idx) => {
    dot.addEventListener("click", () => {
      state.severity = idx + 1;
      updateSeverityDots();
    });
  });
  updateSeverityDots();
}

function updateSeverityDots() {
  document.querySelectorAll(".severity-dot").forEach((dot, idx) => {
    dot.className = "severity-dot";
    if (idx < state.severity) {
      dot.classList.add(`active-${idx + 1}`);
    }
  });
  const label = document.getElementById("severityLabel");
  if (label) {
    const levels = ["", "Very Mild", "Mild", "Mild", "Moderate", "Moderate",
                    "Moderate", "Severe", "Severe", "Critical", "Emergency"];
    label.textContent = `Severity: ${levels[state.severity]} (${state.severity}/10)`;
  }
}

// ── Symptom Tags ───────────────────────────────────────
function initSymptomTags() {
  document.querySelectorAll(".symptom-tag").forEach((tag) => {
    tag.addEventListener("click", () => {
      const val = tag.dataset.symptom;
      if (state.selectedTags.has(val)) {
        state.selectedTags.delete(val);
        tag.classList.remove("selected");
      } else {
        state.selectedTags.add(val);
        tag.classList.add("selected");
        // Append to textarea
        const ta = document.getElementById("symptomInput");
        if (ta) {
          const existing = ta.value.trim();
          ta.value = existing ? `${existing}, ${val}` : val;
        }
      }
    });
  });
}

// ── Symptom Analysis ───────────────────────────────────
function analyzeSymptoms() {
  const ta = document.getElementById("symptomInput");
  const text = ta?.value.trim();

  if (!text) {
    showToast("Please describe your symptoms first.", "warning");
    return;
  }

  const btn = document.getElementById("analyzeBtn");
  setButtonLoading(btn, true, "Analyzing...");

  // Simulate a brief processing delay for UX
  setTimeout(() => {
    try {
      const result = window.LifelineAPI.analyzeSymptoms(text, state.severity);
      state.analysisResult = result;
      renderAnalysisResult(result);
      setButtonLoading(btn, false, "Analyze Symptoms");

      // Auto-switch to hospitals tab and trigger fetch
      if (result.urgency === "CRITICAL" || result.urgency === "HIGH") {
        showToast(`⚠️ ${result.urgency} condition detected — finding nearest hospitals...`, "danger");
        setTimeout(() => {
          showTab("hospitals");
          fetchAndDisplayHospitals();
        }, 1200);
      }
    } catch (err) {
      setButtonLoading(btn, false, "Analyze Symptoms");
      showToast("Analysis failed. Please try again.", "error");
      console.error(err);
    }
  }, 800);
}

function renderAnalysisResult(result) {
  const container = document.getElementById("analysisResult");
  if (!container) return;

  const urgencyColors = {
    CRITICAL: "#ff3b5c",
    HIGH: "#ff8c00",
    MODERATE: "#ffb347",
    LOW: "#00e5a0",
    UNKNOWN: "#8899bb",
  };
  const color = urgencyColors[result.urgency] || "#8899bb";

  container.innerHTML = `
    <div class="analysis-box animate-fade-in-up">
      <div class="analysis-header">
        <div class="analysis-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44L5 11H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2l.04-.06A2.5 2.5 0 0 1 9.5 2z"/>
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44L19 11h2a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-2l-.04-.06A2.5 2.5 0 0 0 14.5 2z"/>
          </svg>
          AI Triage Analysis
        </div>
        <span class="badge" style="background:${color}20;color:${color};border-color:${color}40;">
          ${result.urgency}
        </span>
      </div>
      <div class="analysis-content">
        <p><strong style="color:var(--text-primary)">Possible Condition:</strong> ${result.condition}</p>
        <p style="margin-top:6px"><strong style="color:var(--text-primary)">Recommended Department:</strong> ${result.department}</p>
        <p style="margin-top:12px;font-size:0.82rem;color:var(--text-muted)">Analyzed at ${result.timestamp} · Severity ${result.severityLevel}/10</p>
      </div>
      <div class="analysis-tags">
        ${result.recommendations.map(r => `<span class="analysis-tag">${r}</span>`).join("")}
      </div>
    </div>
  `;

  container.classList.add("show");
}

// ── Map Initialisation ─────────────────────────────────
function initMap() {
  // Default center: India (will update when location is obtained)
  state.map = L.map("map", {
    center: [20.5937, 78.9629],
    zoom: 5,
    zoomControl: true,
  });

  // OpenStreetMap tile layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.map);

  // Custom CSS for dark map tiles
  const mapEl = document.getElementById("map");
  if (mapEl) {
    mapEl.style.filter = "brightness(0.85) contrast(1.1) saturate(0.9)";
  }
}

// ── Fetch & Display Hospitals ──────────────────────────
async function fetchAndDisplayHospitals() {
  const listEl = document.getElementById("hospitalList");
  const statusEl = document.getElementById("hospitalStatus");
  const badgeEl = document.getElementById("mapBadge");

  setHospitalListLoading(listEl);
  if (statusEl) statusEl.textContent = "Getting location...";
  if (badgeEl) badgeEl.textContent = "Locating...";

  try {
    // Get user location
    const location = await window.LifelineAPI.getUserLocation();
    state.userLocation = location;

    // Reverse geocode for display
    const address = await window.LifelineAPI.reverseGeocode(location.lat, location.lon);

    // Update map center
    state.map.setView([location.lat, location.lon], 14);

    // Add user marker
    if (state.userMarker) state.map.removeLayer(state.userMarker);
    state.userMarker = L.marker([location.lat, location.lon], {
      icon: createUserIcon(),
    })
      .addTo(state.map)
      .bindPopup(
        `<strong>📍 Your Location</strong><br><small>${address}</small>`
      )
      .openPopup();

    if (statusEl) statusEl.textContent = "Fetching nearby hospitals...";
    if (badgeEl) badgeEl.textContent = "Searching...";

    // Fetch hospitals from Overpass
    const hospitals = await window.LifelineAPI.fetchNearbyHospitals(
      location.lat,
      location.lon
    );

    state.hospitals = hospitals;

    // Clear old markers
    state.hospitalMarkers.forEach((m) => state.map.removeLayer(m));
    state.hospitalMarkers = [];

    if (hospitals.length === 0) {
      if (listEl)
        listEl.innerHTML = `
          <div class="loading-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.3">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <p>No hospitals found within 7 km.</p>
            <p style="font-size:0.75rem">Try enabling location access or moving to a different area.</p>
          </div>`;
      if (statusEl) statusEl.textContent = "No hospitals found";
      if (badgeEl) badgeEl.textContent = "0 hospitals";
      return;
    }

    // Add hospital markers
    hospitals.forEach((h, i) => {
      const marker = L.marker([h.lat, h.lon], {
        icon: createHospitalIcon(h, i === 0),
      })
        .addTo(state.map)
        .bindPopup(createHospitalPopup(h));

      state.hospitalMarkers.push(marker);
    });

    // Fit bounds to show all
    const bounds = L.latLngBounds([
      [location.lat, location.lon],
      ...hospitals.map((h) => [h.lat, h.lon]),
    ]);
    state.map.fitBounds(bounds, { padding: [40, 40] });

    // Render hospital cards
    renderHospitalCards(hospitals, listEl);

    // Run decision engine
    const decision = window.LifelineAPI.rankHospitals(hospitals, state.analysisResult);
    renderDecision(decision);

    if (statusEl) statusEl.textContent = `${hospitals.length} hospitals found`;
    if (badgeEl) badgeEl.textContent = `${hospitals.length} hospitals nearby`;

    showToast(`Found ${hospitals.length} hospitals near you!`, "success");
  } catch (err) {
    console.error("Hospital fetch error:", err);
    if (listEl)
      listEl.innerHTML = `
        <div class="loading-state">
          <p style="color:var(--accent-emergency)">${err.message}</p>
          <button class="btn btn-ghost" style="margin-top:12px" onclick="fetchAndDisplayHospitals()">
            Try Again
          </button>
        </div>`;
    if (statusEl) statusEl.textContent = "Error fetching hospitals";
    if (badgeEl) badgeEl.textContent = "Error";
    showToast(err.message, "error");
  }
}

// ── Custom Leaflet Icons ───────────────────────────────
function createUserIcon() {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:18px;height:18px;
        background:#00b7ff;
        border:3px solid white;
        border-radius:50%;
        box-shadow:0 0 0 4px rgba(0,183,255,0.3),0 2px 8px rgba(0,0,0,0.4);
        position:relative;
      ">
        <div style="
          position:absolute;
          top:50%;left:50%;
          transform:translate(-50%,-50%);
          width:28px;height:28px;
          border-radius:50%;
          background:rgba(0,183,255,0.2);
          animation:ripple 1.5s ease-out infinite;
        "></div>
      </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function createHospitalIcon(hospital, isBest) {
  const color = isBest ? "#00e5a0" : getAvailabilityColor(hospital.availability);
  return L.divIcon({
    className: "",
    html: `
      <div style="
        display:flex;flex-direction:column;align-items:center;
      ">
        <div style="
          width:30px;height:30px;
          background:${color};
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          box-shadow:0 2px 12px rgba(0,0,0,0.4);
          display:flex;align-items:center;justify-content:center;
          border:2px solid rgba(255,255,255,0.8);
        ">
          <span style="
            transform:rotate(45deg);
            color:#000;
            font-size:12px;
            font-weight:900;
            line-height:1;
          ">+</span>
        </div>
      </div>`,
    iconSize: [30, 36],
    iconAnchor: [15, 36],
    popupAnchor: [0, -36],
  });
}

function getAvailabilityColor(availability) {
  const colors = {
    Available: "#00e5a0",
    Moderate: "#ffb347",
    Busy: "#ff8c00",
    Critical: "#ff3b5c",
  };
  return colors[availability] || "#8899bb";
}

function createHospitalPopup(h) {
  return `
    <div style="font-family:'DM Sans',sans-serif;min-width:180px;padding:4px">
      <div style="font-weight:700;font-size:0.9rem;margin-bottom:4px">${h.name}</div>
      <div style="font-size:0.75rem;color:#666;margin-bottom:8px">${h.address || h.type}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="background:#e8f5ff;color:#0066cc;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600">${h.distance} km</span>
        <span style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600">~${h.waitTimeMin} min</span>
        <span style="background:${h.availability === "Available" ? "#e8f5e9" : "#fff3e0"};
                     color:${h.availability === "Available" ? "#2e7d32" : "#e65100"};
                     padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600">${h.availability}</span>
      </div>
      ${h.phone ? `<div style="font-size:0.72rem;color:#444">📞 ${h.phone}</div>` : ""}
    </div>`;
}

// ── Hospital Cards ─────────────────────────────────────
function renderHospitalCards(hospitals, container) {
  if (!container) return;

  container.innerHTML = "";
  container.className = "hospitals-list stagger-list";

  hospitals.slice(0, 8).forEach((h, i) => {
    const card = document.createElement("div");
    card.className = `hospital-card${i === 0 ? " best-pick" : ""}`;
    card.innerHTML = `
      <div class="hospital-card-top">
        <div>
          <div class="hospital-name">${h.name}</div>
          <div class="hospital-type">${capitalizeFirst(h.type)} ${h.emergency ? "· 🚨 Emergency" : ""}</div>
        </div>
        <div class="hospital-dist">
          ${h.distance} km
          <span>${estimateDriveTime(h.distance)}</span>
        </div>
      </div>
      <div class="hospital-meta">
        <div class="hospital-meta-item">
          <span class="pulse-dot ${getWaitDotColor(h.waitTimeMin)}"></span>
          ~${h.waitTimeMin} min wait
        </div>
        <div class="hospital-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          ${h.doctorsOnDuty} doctors
        </div>
        <span class="badge ${getAvailabilityBadge(h.availability)}">${h.availability}</span>
      </div>
      ${h.address ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px">${h.address}</div>` : ""}
    `;

    card.addEventListener("click", () => {
      state.map.setView([h.lat, h.lon], 17);
      state.hospitalMarkers[i]?.openPopup();
      showTab("hospitals");
    });

    container.appendChild(card);
  });
}

function setHospitalListLoading(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Finding hospitals near you...</p>
      <p style="font-size:0.72rem;color:var(--text-muted)">Accessing OpenStreetMap data</p>
    </div>`;
}

function getWaitDotColor(mins) {
  if (mins <= 20) return "green";
  if (mins <= 45) return "yellow";
  return "red";
}

function getAvailabilityBadge(av) {
  const map = { Available: "badge-success", Moderate: "badge-warning", Busy: "badge-warning", Critical: "badge-danger" };
  return map[av] || "badge-info";
}

function estimateDriveTime(km) {
  const mins = Math.round((km / 30) * 60); // avg 30 km/h urban
  if (mins < 2) return "< 2 min drive";
  return `~${mins} min drive`;
}

function capitalizeFirst(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

// ── Decision Engine Display ────────────────────────────
function renderDecision(decision) {
  const container = document.getElementById("decisionResult");
  const emptyEl = document.getElementById("decisionEmpty");
  if (!container) return;

  if (!decision) {
    container.classList.remove("show");
    if (emptyEl) emptyEl.style.display = "flex";
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  const { best, ranked, explanation } = decision;

  // Normalise scores for display (0-100%)
  const maxScore = Math.max(...ranked.map(r => r.totalScore));
  const scoresHtml = ranked
    .slice(0, 5)
    .map((h) => {
      const pct = Math.round((1 - h.totalScore / (maxScore * 1.2)) * 100);
      return `
        <div class="decision-score-card">
          <div class="decision-score-name">${h.name}</div>
          <div class="decision-score-bar">
            <div class="decision-score-fill" style="width:${pct}%"></div>
          </div>
          <div class="decision-score-value" style="color:${pct > 70 ? 'var(--accent-success)' : pct > 40 ? 'var(--accent-warning)' : 'var(--text-secondary)'}">
            ${pct}% match
          </div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px">
            ${h.distance} km · ~${h.waitTimeMin} min wait · ${h.availability}
          </div>
        </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="decision-winner animate-fade-in-up">
      <div class="decision-winner-badge">🏆</div>
      <div>
        <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent-success);margin-bottom:4px">Best Recommendation</div>
        <div class="decision-winner-name">${best.name}</div>
        <div class="decision-winner-reason">👉 ${explanation}</div>
        <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
          <span class="badge badge-info">${best.distance} km away</span>
          <span class="badge badge-success">~${best.waitTimeMin} min wait</span>
          <span class="badge ${getAvailabilityBadge(best.availability)}">${best.availability}</span>
          ${best.emergency ? '<span class="badge badge-danger">Emergency Dept.</span>' : ""}
        </div>
        ${best.phone ? `<div style="margin-top:12px;font-size:0.82rem;color:var(--text-secondary)">📞 ${best.phone}</div>` : ""}
      </div>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:0.78rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:12px">All Hospitals — Ranked</div>
      <div class="decision-scores progress-animate">
        ${scoresHtml}
      </div>
    </div>`;

  container.classList.add("show");
}

// ── Blood Data ─────────────────────────────────────────
async function loadBloodData() {
  try {
    const data = await window.LifelineAPI.fetchBloodData();
    state.bloodData = data;
    renderBloodData(data, "all");
  } catch (err) {
    console.error("Blood data error:", err);
    const el = document.getElementById("bloodGrid");
    if (el) el.innerHTML = `<p style="color:var(--text-muted);padding:20px">Failed to load blood data.</p>`;
  }
}

function renderBloodData(data, filterType) {
  const container = document.getElementById("bloodGrid");
  if (!container) return;

  container.innerHTML = "";
  container.className = "blood-grid stagger-list";

  // Aggregate blood totals across all hospitals
  const totals = {};
  data.bloodTypes.forEach((t) => {
    totals[t] = { units: 0, hospitals: 0, status: "unavailable" };
  });

  data.hospitals.forEach((h) => {
    h.blood_inventory.forEach((entry) => {
      if (!totals[entry.type]) return;
      totals[entry.type].units += entry.units;
      if (entry.units > 0) totals[entry.type].hospitals++;
      // Escalate status
      if (entry.status === "available") totals[entry.type].status = "available";
      else if (entry.status === "low" && totals[entry.type].status !== "available")
        totals[entry.type].status = "low";
    });
  });

  const types = filterType === "all"
    ? data.bloodTypes
    : data.bloodTypes.filter((t) => t.startsWith(filterType));

  types.forEach((type) => {
    const info = totals[type];
    const maxUnits = 200;
    const pct = Math.min((info.units / maxUnits) * 100, 100);
    const barClass = pct > 50 ? "high" : pct > 20 ? "medium" : "low";

    const card = document.createElement("div");
    card.className = "blood-type-card hover-lift";
    card.innerHTML = `
      <div class="blood-type-header">
        <div class="blood-type-name">${type}</div>
        <div class="blood-type-units">
          <strong>${info.units}</strong> units
        </div>
      </div>
      <div class="blood-bar">
        <div class="blood-bar-fill ${barClass}" style="width:${pct}%"></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span class="badge ${
          info.status === "available" ? "badge-success" :
          info.status === "low" ? "badge-warning" : "badge-danger"
        }">${info.status === "available" ? "Available" : info.status === "low" ? "Low Stock" : "Unavailable"}</span>
        <div class="blood-hospitals">Available at <span>${info.hospitals}</span> hospital${info.hospitals !== 1 ? "s" : ""}</div>
      </div>
      <div style="margin-top:10px;font-size:0.72rem;color:var(--text-muted)">
        Compatible donors: ${(data.compatibility?.[type] || []).join(", ") || "N/A"}
      </div>`;

    container.appendChild(card);
  });
}

function initBloodFilters() {
  document.querySelectorAll(".blood-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".blood-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (state.bloodData) {
        renderBloodData(state.bloodData, btn.dataset.filter);
      }
    });
  });
}

// ── Utility: Toast Notification ───────────────────────
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const colors = {
    success: "var(--accent-success)",
    error: "var(--accent-emergency)",
    danger: "var(--accent-emergency)",
    warning: "var(--accent-warning)",
    info: "var(--accent-primary)",
  };
  const color = colors[type] || colors.info;

  const toast = document.createElement("div");
  toast.style.cssText = `
    background: rgba(5,11,24,0.95);
    border: 1px solid ${color}40;
    border-left: 3px solid ${color};
    border-radius: 10px;
    padding: 12px 18px;
    font-size: 0.85rem;
    color: var(--text-primary);
    backdrop-filter: blur(20px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    animation: fadeInRight 0.3s ease forwards;
    max-width: 320px;
    word-wrap: break-word;
    cursor: pointer;
  `;
  toast.textContent = message;

  toast.addEventListener("click", () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "fadeIn 0.3s ease reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Utility: Button Loading State ─────────────────────
function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="spinner"></span> ${label}`
    : label;
}

// ── Expose global handlers ─────────────────────────────
window.analyzeSymptoms = analyzeSymptoms;
window.fetchAndDisplayHospitals = fetchAndDisplayHospitals;
window.showTab = showTab;
