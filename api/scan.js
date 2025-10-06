// api/scan.js — Vercel serverless function (no deps)
export default async function handler(req, res) {
  try {
    const { lat, lng, radius_km = "25", q = "", category = "" } = req.query || {};
    const latN = parseFloat(lat), lngN = parseFloat(lng), rKm = parseFloat(radius_km);
    if (Number.isNaN(latN) || Number.isNaN(lngN)) {
      return res.status(400).json({ error: "lat,lng required" });
    }

    const tasks = [
      googlePlaces({ lat: latN, lng: lngN, radiusKm: rKm, q, category }),
      charityNavigator({ q }),
      propublicaIRS({ q })
    ];

    const settled = await Promise.allSettled(tasks);
    const rows = settled.flatMap(r => r.status === "fulfilled" ? r.value : []);

    const items = dedupe(rows).slice(0, 150);
    res.setHeader('Access-Control-Allow-Origin', '*'); // simple CORS
    return res.json({ results: items, count: items.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "scan_failed" });
  }
}

async function googlePlaces({ lat, lng, radiusKm, q, category }) {
  const KEY = process.env.GMAPS_KEY;
  if (!KEY) return [];
  const keyword = (q || category || "nonprofit").slice(0, 60);
  const meters = Math.min(Math.round(radiusKm * 1000), 50000);
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${meters}&keyword=${encodeURIComponent(keyword)}&key=${KEY}`;
  const data = await (await fetch(url)).json();
  return (data.results || []).map(r => ({
    id: `g_${r.place_id}`,
    name: r.name,
    address: r.vicinity || r.formatted_address || "",
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
    categories: guessCats(r.types),
    website: "",
    donation_url: "",
    verified: false,
    source: "google"
  })).filter(x => isFinite(x.lat) && isFinite(x.lng));
}

async function charityNavigator({ q }) {
  const KEY = process.env.CN_KEY, ID = process.env.CN_ID;
  if (!KEY || !ID || !q) return [];
  const url = `https://api.charitynavigator.org/v2/Organizations?app_id=${ID}&app_key=${KEY}&pageSize=50&search=${encodeURIComponent(q)}`;
  const data = await (await fetch(url)).json();
  return (data || []).map(row => ({
    id: `cn_${row.ein || row.charityNavigatorURL || Math.random().toString(36).slice(2)}`,
    name: row.charityName || row.legalName,
    address: [
      row.mailingAddress?.streetAddress1, row.mailingAddress?.city,
      row.mailingAddress?.stateOrProvince, row.mailingAddress?.postalCode
    ].filter(Boolean).join(", "),
    lat: row.latitude, lng: row.longitude,
    categories: [row.category?.categoryName].filter(Boolean),
    website: row.websiteURL || "",
    donation_url: row.donationUrl || row.websiteURL || "",
    verified: true,
    source: "charitynavigator"
  })).filter(x => isFinite(x.lat) && isFinite(x.lng));
}

async function propublicaIRS({ q }) {
  const KEY = process.env.PP_API_KEY;
  if (!KEY || !q) return [];
  const url = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(q)}`;
  const data = await (await fetch(url, { headers: { "X-API-Key": KEY } })).json();
  return ((data || {}).organizations || []).map(r => ({
    id: `pp_${r.ein}`,
    name: r.name,
    address: [r.city, r.state].filter(Boolean).join(", "),
    lat: NaN, lng: NaN,
    categories: ["Nonprofit"],
    website: "", donation_url: "",
    verified: false,
    source: "propublica"
  })).filter(x => isFinite(x.lat) && isFinite(x.lng));
}

function guessCats(types = []) {
  const set = new Set(types);
  if (set.has("food_bank") || set.has("food")) return ["Food Bank"];
  if (set.has("place_of_worship") || set.has("church")) return ["Community"];
  if (set.has("health") || set.has("doctor") || set.has("hospital")) return ["Health"];
  return ["Nonprofit"];
}
function dedupe(items) {
  const map = new Map();
  for (const x of items) {
    const k = x.id || `${(x.name||"").toLowerCase()}|${x.address?.toLowerCase()||""}`;
    if (!map.has(k)) map.set(k, x);
  }
  return [...map.values()];
}
