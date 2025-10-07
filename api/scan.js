// wtn-scanner/api/scan.js — Free scanner using OpenStreetMap Overpass (no keys)
const OVERPASS = "https://overpass-api.de/api/interpreter";
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method==="OPTIONS") return res.status(204).end();

  const { lat, lng, radius_km="25" } = req.query || {};
  const la = parseFloat(lat), lo = parseFloat(lng), rKm = Math.max(1, Math.min(50, parseFloat(radius_km)||25));
  if (!isFinite(la)||!isFinite(lo)) return res.status(400).json({error:"lat,lng required"});

  const r = Math.round(rKm*1000);
  const q = `
    [out:json][timeout:25];
    (
      node[amenity=food_bank](around:${r},${la},${lo});
      node[social_facility=shelter](around:${r},${la},${lo});
      node[office=charity](around:${r},${la},${lo});
      node[amenity~"clinic|hospital|doctors"](around:${r},${la},${lo});
      node[amenity~"animal_shelter|veterinary"](around:${r},${la},${lo});
      way[office=charity](around:${r},${la},${lo});
      relation[office=charity](around:${r},${la},${lo});
    );
    out center tags 200;
  `;
  try {
    const data = await fetch(OVERPASS, {
      method:"POST",
      headers:{ "content-type":"application/x-www-form-urlencoded; charset=UTF-8",
                "user-agent":"WhatTheNeed-Scanner/1.0" },
      body:new URLSearchParams({data:q})
    }).then(r=>r.json());

    const items = (data.elements||[]).map(el => {
      const t = el.tags||{};
      const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
      const line1 = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
      const line2 = [t["addr:city"], t["addr:state"], t["addr:postcode"]].filter(Boolean).join(", ");
      const addr = t["addr:full"] || [line1, line2].filter(Boolean).join(line1 && line2 ? ", " : "");
      return {
        id:`osm_${el.type}_${el.id}`,
        name: t.name || t.operator || "Unknown organization",
        address: addr || "",
        lat, lng,
        categories: guessCats(t),
        website: t.website || t["contact:website"] || t.url || "",
        donation_url: t.website || "",
        verified:false, source:"osm"
      };
    }).filter(x=>isFinite(x.lat)&&isFinite(x.lng));

    res.json({ results: dedupe(items).slice(0,150), count: items.length, source:"overpass", radius_km:rKm });
  } catch (e) {
    console.error(e); res.status(500).json({error:"scan_failed"});
  }
}
function guessCats(t){
  const n=(t.name||"").toLowerCase();
  const has=(k,v)=>t[k]===v;
  const out=[];
  if (has("amenity","food_bank")||/soup|pantry/.test(n)) out.push("Food Bank");
  if (t.social_facility==="shelter"||/shelter|homeless/.test(n)) out.push("Shelter");
  if (/clinic|hospital|doctor/.test(t.amenity||"")) out.push("Health");
  if (/animal_shelter|veterinary/.test(t.amenity||"")) out.push("Animals");
  if (has("office","charity")||has("amenity","community_centre")) out.push("Nonprofit");
  return out.length?out:["Nonprofit"];
}
function dedupe(arr){
  const m=new Map();
  for (const x of arr){ const k=`${(x.name||"").toLowerCase()}|${(x.address||"").toLowerCase()}`; if(!m.has(k)) m.set(k,x); }
  return [...m.values()];
}
