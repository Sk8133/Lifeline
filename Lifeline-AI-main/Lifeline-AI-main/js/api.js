/**
 * LifeLine AI – api.js
 * Handles all external API calls:
 *   - Browser Geolocation
 *   - OpenStreetMap Overpass API (hospital data)
 *   - Blood data (local JSON)
 */

"use strict";

// ── Constants ──────────────────────────────────────────
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const BLOOD_DATA_PATH = "./data/blood_data.json";
const SEARCH_RADIUS_M = 7000; // 7 km radius

// ── Geolocation ────────────────────────────────────────

/**
 * Get the user's current GPS coordinates.
 * Returns a Promise<{lat, lon}> or throws an error.
 */
async function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by your browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        let message;
        switch (err.code) {
          case err.PERMISSION_DENIED:
            message = "Location permission denied. Please enable location access.";
            break;
          case err.POSITION_UNAVAILABLE:
            message = "Location information is unavailable.";
            break;
          case err.TIMEOUT:
            message = "Location request timed out. Please try again.";
            break;
          default:
            message = "An unknown location error occurred.";
        }
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

/**
 * Reverse geocode coordinates to a human-readable address.
 */
async function reverseGeocode(lat, lon) {
  try {
    const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const response = await fetch(url, {
      headers: { "Accept-Language": "en" },
    });
    if (!response.ok) throw new Error("Reverse geocode failed");
    const data = await response.json();
    return data.display_name || "Your Location";
  } catch {
    return "Your Location";
  }
}

// ── OpenStreetMap Overpass API ─────────────────────────

/**
 * Build an Overpass QL query to find hospitals + clinics near a point.
 */
function buildHospitalQuery(lat, lon, radiusM) {
  return `
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](around:${radiusM},${lat},${lon});
      way["amenity"="hospital"](around:${radiusM},${lat},${lon});
      node["amenity"="clinic"](around:${radiusM},${lat},${lon});
      way["amenity"="clinic"](around:${radiusM},${lat},${lon});
      node["amenity"="doctors"](around:${radiusM},${lat},${lon});
      node["healthcare"="hospital"](around:${radiusM},${lat},${lon});
    );
    out center tags;
  `;
}

/**
 * Fetch hospitals near a coordinate from Overpass API.
 * Returns an array of hospital objects with enriched metadata.
 */
async function fetchNearbyHospitals(lat, lon) {
  const query = buildHospitalQuery(lat, lon, SEARCH_RADIUS_M);

  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.elements || data.elements.length === 0) {
    return [];
  }

  // Normalize and enrich each hospital element
  const hospitals = data.elements
    .map((el) => {
      // Get coordinates (node vs way/relation differ)
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (!elLat || !elLon) return null;

      const tags = el.tags || {};
      const name =
        tags.name ||
        tags["name:en"] ||
        tags.official_name ||
        (tags.amenity === "clinic" ? "Medical Clinic" : "Hospital");

      const distance = haversineDistance(lat, lon, elLat, elLon);
      const simulated = simulateHospitalMetrics(el.id, distance);

      return {
        id: String(el.id),
        name,
        lat: elLat,
        lon: elLon,
        distance, // km
        type: tags.amenity || tags.healthcare || "hospital",
        phone: tags.phone || tags["contact:phone"] || null,
        website: tags.website || tags["contact:website"] || null,
        emergency: tags.emergency === "yes" || tags.amenity === "hospital",
        beds: tags.beds ? parseInt(tags.beds) : null,
        operator: tags.operator || tags.brand || null,
        address: buildAddress(tags),
        // Simulated real-time metrics
        waitTimeMin: simulated.waitTime,
        availability: simulated.availability,
        doctorsOnDuty: simulated.doctors,
        score: simulated.score,
        lastUpdated: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  // Sort by composite score (distance + wait time)
  hospitals.sort((a, b) => a.score - b.score);

  return hospitals;
}

/**
 * Build a readable address string from OSM tags.
 */
function buildAddress(tags) {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"],
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// ── Distance Calculation ───────────────────────────────

/**
 * Haversine formula — great-circle distance between two lat/lon pairs.
 * Returns distance in kilometres.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// ── Simulated Hospital Metrics ─────────────────────────

/**
 * Deterministically simulate real-time hospital metrics
 * based on hospital ID and distance to produce realistic variation.
 */
function simulateHospitalMetrics(id, distanceKm) {
  // Use ID as a seed for deterministic but varied values
  const seed = hashCode(String(id));
  const r = seededRandom(seed);

  const baseWait = Math.round(5 + r() * 55); // 5–60 min
  const distancePenalty = Math.round(distanceKm * 2);
  const waitTime = Math.min(baseWait + distancePenalty, 90);

  const availabilities = ["Available", "Moderate", "Busy", "Critical"];
  const availIdx = Math.min(
    Math.floor(r() * 4 + (waitTime > 45 ? 1 : 0)),
    3
  );
  const availability = availabilities[availIdx];

  const doctors = Math.round(2 + r() * 18); // 2–20 doctors

  // Composite score: lower = better
  // Weight: distance (50%) + wait time (50%)
  const score = distanceKm * 10 + waitTime * 0.5;

  return { waitTime, availability, doctors, score };
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 4294967296;
  };
}

// ── Blood Data ─────────────────────────────────────────

/**
 * Fetch blood availability data from local JSON.
 */
async function fetchBloodData() {
  const response = await fetch(BLOOD_DATA_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load blood data: ${response.status}`);
  }
  return await response.json();
}

// ── Symptom Analysis ───────────────────────────────────

/**
 * Analyse symptom text and return a structured triage result.
 * This uses keyword matching with severity scoring.
 */
function analyzeSymptoms(symptomText, severityLevel) {
  const text = symptomText.toLowerCase();

  const emergencyKeywords = [
    { words: ["chest pain", "chest pressure", "heart attack"], condition: "Possible Cardiac Event", urgency: "CRITICAL", dept: "Cardiology / Emergency" },
    { words: ["stroke", "face drooping", "arm weakness", "sudden numbness", "slurred speech"], condition: "Possible Stroke", urgency: "CRITICAL", dept: "Neurology / Emergency" },
    { words: ["can't breathe", "cannot breathe", "difficulty breathing", "shortness of breath", "not breathing"], condition: "Respiratory Emergency", urgency: "CRITICAL", dept: "Pulmonology / Emergency" },
    { words: ["severe bleeding", "bleeding heavily", "won't stop bleeding"], condition: "Hemorrhage Risk", urgency: "CRITICAL", dept: "Emergency / Surgery" },
    { words: ["unconscious", "passed out", "unresponsive", "fainted"], condition: "Loss of Consciousness", urgency: "CRITICAL", dept: "Emergency / ICU" },
    { words: ["seizure", "convulsion", "fitting"], condition: "Seizure Activity", urgency: "HIGH", dept: "Neurology / Emergency" },
    { words: ["severe head", "head injury", "head trauma"], condition: "Head Trauma", urgency: "HIGH", dept: "Neurology / Emergency" },
    { words: ["high fever", "very high temperature", "fever of"], condition: "High Fever", urgency: "HIGH", dept: "General Medicine / Emergency" },
    { words: ["severe abdominal", "stomach pain severe", "appendix"], condition: "Acute Abdominal Pain", urgency: "HIGH", dept: "General Surgery / Emergency" },
    { words: ["allergic reaction", "anaphylaxis", "throat swelling", "tongue swelling"], condition: "Anaphylactic Reaction", urgency: "CRITICAL", dept: "Emergency / Allergy" },
    { words: ["broken bone", "fracture", "bone injury"], condition: "Bone Fracture", urgency: "MODERATE", dept: "Orthopedics" },
    { words: ["deep cut", "deep wound", "laceration", "gash"], condition: "Laceration / Wound", urgency: "MODERATE", dept: "Emergency / Surgery" },
    { words: ["burn", "scalded", "burning skin"], condition: "Burn Injury", urgency: "MODERATE", dept: "Burns / Dermatology" },
    { words: ["fever", "temperature", "hot"], condition: "Fever", urgency: "LOW", dept: "General Medicine" },
    { words: ["headache", "migraine", "head pain"], condition: "Headache / Migraine", urgency: "LOW", dept: "General Medicine / Neurology" },
    { words: ["vomiting", "nausea", "throwing up"], condition: "Nausea / Vomiting", urgency: "LOW", dept: "General Medicine / Gastroenterology" },
    { words: ["diarrhea", "loose stools", "stomach upset"], condition: "Gastrointestinal Issue", urgency: "LOW", dept: "Gastroenterology" },
    { words: ["cough", "cold", "runny nose", "sore throat"], condition: "Upper Respiratory Infection", urgency: "LOW", dept: "General Medicine / ENT" },
    { words: ["back pain", "lower back", "spine pain"], condition: "Back Pain", urgency: "LOW", dept: "Orthopedics / General Medicine" },
    { words: ["rash", "skin irritation", "itching", "hives"], condition: "Skin Condition", urgency: "LOW", dept: "Dermatology" },
    { words: ["dizziness", "dizzy", "lightheaded", "vertigo"], condition: "Dizziness / Vertigo", urgency: "MODERATE", dept: "Neurology / General Medicine" },
    { words: ["eye pain", "eye injury", "vision loss", "blurry vision"], condition: "Eye Emergency", urgency: "HIGH", dept: "Ophthalmology / Emergency" },
  ];

  let bestMatch = null;
  let bestScore = 0;

  for (const entry of emergencyKeywords) {
    for (const keyword of entry.words) {
      if (text.includes(keyword)) {
        const score = keyword.length; // longer = more specific
        if (score > bestScore) {
          bestScore = score;
          bestMatch = entry;
        }
      }
    }
  }

  // Override urgency based on severity slider
  let urgency = bestMatch?.urgency || "UNKNOWN";
  if (severityLevel >= 8 && urgency !== "CRITICAL") urgency = "HIGH";
  if (severityLevel >= 9) urgency = "CRITICAL";

  const condition = bestMatch?.condition || "General Medical Concern";
  const dept = bestMatch?.dept || "General Medicine / Emergency";

  const recommendations = getRecommendations(urgency, condition);

  return {
    condition,
    urgency,
    department: dept,
    recommendations,
    severityLevel,
    analyzed: true,
    timestamp: new Date().toLocaleTimeString(),
  };
}

function getRecommendations(urgency, condition) {
  const base = {
    CRITICAL: [
      "⚠️ Seek emergency care IMMEDIATELY — call 108 or go to the nearest ER.",
      "Do not drive yourself — ask someone or call an ambulance.",
      "Inform hospital staff about symptoms on arrival.",
    ],
    HIGH: [
      "🔴 Go to the nearest hospital emergency department now.",
      "Avoid eating or drinking until evaluated by a doctor.",
      "Monitor symptoms closely during transport.",
    ],
    MODERATE: [
      "🟡 Visit an urgent care center or emergency department within 2–4 hours.",
      "Keep a record of symptom onset time and severity.",
      "Take any relevant medications only if previously prescribed.",
    ],
    LOW: [
      "🟢 Schedule a visit with your primary care physician.",
      "Rest and stay hydrated.",
      "Monitor symptoms; seek emergency care if condition worsens.",
    ],
    UNKNOWN: [
      "Consult a medical professional for evaluation.",
      "Describe all symptoms clearly when you arrive.",
    ],
  };
  return base[urgency] || base.UNKNOWN;
}

// ── Decision Engine ────────────────────────────────────

/**
 * Rank hospitals and return the best recommendation with explanation.
 */
function rankHospitals(hospitals, symptoms) {
  if (!hospitals.length) return null;

  // Score: lower is better
  // Formula: (distance_km * 10) + (waitTime * 0.5) + (availability_penalty)
  const availPenalty = { Available: 0, Moderate: 5, Busy: 15, Critical: 30 };

  const ranked = hospitals.map((h) => {
    const distScore = h.distance * 10;
    const waitScore = h.waitTimeMin * 0.5;
    const availScore = availPenalty[h.availability] ?? 10;
    const totalScore = distScore + waitScore + availScore;

    return { ...h, totalScore };
  });

  ranked.sort((a, b) => a.totalScore - b.totalScore);

  const best = ranked[0];
  const reasons = [];

  if (best.distance === Math.min(...hospitals.map((h) => h.distance))) {
    reasons.push("closest hospital");
  }
  if (best.waitTimeMin === Math.min(...hospitals.map((h) => h.waitTimeMin))) {
    reasons.push("shortest wait time");
  }
  if (best.availability === "Available") {
    reasons.push("full bed availability");
  }

  const explanation =
    reasons.length
      ? `Recommended because it has the ${reasons.join(", ")}.`
      : `Best composite score based on distance (${best.distance} km) and wait time (${best.waitTimeMin} min).`;

  return {
    best,
    ranked,
    explanation,
    scoreBreakdown: ranked.map((h) => ({
      id: h.id,
      name: h.name,
      totalScore: h.totalScore,
      distScore: (h.distance * 10).toFixed(1),
      waitScore: (h.waitTimeMin * 0.5).toFixed(1),
      pct: 0, // filled in by UI
    })),
  };
}

// ── Exports (module-like namespace) ───────────────────
window.LifelineAPI = {
  getUserLocation,
  reverseGeocode,
  fetchNearbyHospitals,
  fetchBloodData,
  analyzeSymptoms,
  rankHospitals,
  haversineDistance,
};
