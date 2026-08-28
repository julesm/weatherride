// POST /api/weather
// body: { points: [{ lat, lon, label, time }] }  time = ISO string
//
// yr.no (MET Norway) requires a real identifying User-Agent header or it
// returns 403. Replace the contact email below with your own before you
// deploy — see README.

const USER_AGENT = 'ride-weather-app/1.0 github.com/julesm (julesmataly@gmail.com)';

// Human-readable labels for alt text / tooltips, keyed by the base symbol
// code (day/night/polartwilight suffix stripped). The actual icon shown to
// the user is the real symbol_code SVG in /icons — see app.js.
const LABELS = {
  clearsky: 'Clear sky',
  fair: 'Fair',
  partlycloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  lightrain: 'Light rain',
  lightrainandthunder: 'Light rain & thunder',
  rain: 'Rain',
  rainandthunder: 'Rain & thunder',
  heavyrain: 'Heavy rain',
  heavyrainandthunder: 'Heavy rain & thunder',
  lightrainshowers: 'Light rain showers',
  lightrainshowersandthunder: 'Light rain showers & thunder',
  rainshowers: 'Rain showers',
  rainshowersandthunder: 'Rain showers & thunder',
  heavyrainshowers: 'Heavy rain showers',
  heavyrainshowersandthunder: 'Heavy rain showers & thunder',
  lightsleet: 'Light sleet',
  lightsleetandthunder: 'Light sleet & thunder',
  sleet: 'Sleet',
  sleetandthunder: 'Sleet & thunder',
  heavysleet: 'Heavy sleet',
  heavysleetandthunder: 'Heavy sleet & thunder',
  lightsleetshowers: 'Light sleet showers',
  sleetshowers: 'Sleet showers',
  sleetshowersandthunder: 'Sleet showers & thunder',
  heavysleetshowers: 'Heavy sleet showers',
  heavysleetshowersandthunder: 'Heavy sleet showers & thunder',
  lightssleetshowersandthunder: 'Light sleet showers & thunder',
  lightsnow: 'Light snow',
  lightsnowandthunder: 'Light snow & thunder',
  snow: 'Snow',
  snowandthunder: 'Snow & thunder',
  heavysnow: 'Heavy snow',
  heavysnowandthunder: 'Heavy snow & thunder',
  lightsnowshowers: 'Light snow showers',
  lightssnowshowersandthunder: 'Light snow showers & thunder',
  snowshowers: 'Snow showers',
  snowshowersandthunder: 'Snow showers & thunder',
  heavysnowshowers: 'Heavy snow showers',
  heavysnowshowersandthunder: 'Heavy snow showers & thunder',
};

function symbolFor(code) {
  if (!code) return { code: null, label: 'No data' };
  const base = code.replace(/_(day|night|polartwilight)$/, '');
  return { code, label: LABELS[base] || base };
}

function nearestEntry(timeseries, targetIso) {
  const target = new Date(targetIso).getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const entry of timeseries) {
    const diff = Math.abs(new Date(entry.time).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return best;
}

async function fetchPointWeather(lat, lon, iso) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) {
    throw new Error(`yr.no returned ${r.status}`);
  }
  const json = await r.json();
  const timeseries = json.properties?.timeseries || [];
  const entry = nearestEntry(timeseries, iso);
  if (!entry) return null;

  const instant = entry.data?.instant?.details || {};
  const next1 = entry.data?.next_1_hours;
  const next6 = entry.data?.next_6_hours;
  const summaryBlock = next1 || next6;
  const symbolCode = summaryBlock?.summary?.symbol_code || null;
  const precipitation =
    summaryBlock?.details?.precipitation_amount ?? null;

  return {
    forecastTime: entry.time,
    temperature: instant.air_temperature ?? null,
    windSpeed: instant.wind_speed ?? null,
    windDirection: instant.wind_from_direction ?? null,
    humidity: instant.relative_humidity ?? null,
    precipitation,
    symbol: symbolFor(symbolCode),
  };
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
          const weather = await fetchPointWeather(p.lat, p.lon, p.time);
          return { ...p, weather, error: null };
        } catch (err) {
          return { ...p, weather: null, error: 'Forecast unavailable for this point.' };
        }
      })
    );
    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Could not reach yr.no. Try again in a moment.' });
  }
};
