// POST /api/placename
// body: { points: [{ lat, lon }] }
//
// Uses OpenStreetMap's Nominatim reverse-geocoding service to turn each
// coordinate into a place name (village/town/city). Nominatim is free but
// asks that requests carry an identifying User-Agent — same courtesy as
// yr.no. See README before deploying.

const USER_AGENT = 'ride-weather-app/1.0 github.com/YOUR-USERNAME (YOUR-EMAIL@example.com)';

function pickName(address, displayName) {
  if (!address) return displayName ? displayName.split(',')[0].trim() : null;
  return (
    address.village ||
    address.town ||
    address.city ||
    address.hamlet ||
    address.suburb ||
    address.municipality ||
    address.county ||
    (displayName ? displayName.split(',')[0].trim() : null)
  );
}

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=13&addressdetails=1`;
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) return null;
  const json = await r.json();
  return pickName(json.address, json.display_name);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const points = Array.isArray(body?.points) ? body.points : [];
  if (!points.length) {
    res.status(400).json({ error: 'No points supplied.' });
    return;
  }

  try {
    const results = await Promise.all(
      points.map(async (p) => {
        try {
          const name = await reverseGeocode(p.lat, p.lon);
          return { lat: p.lat, lon: p.lon, name };
        } catch {
          return { lat: p.lat, lon: p.lon, name: null };
        }
      })
    );
    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Could not reach the place-name service.' });
  }
};
