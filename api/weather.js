// POST /api/weather
// body: { points: [{ lat, lon, label, time }] }  time = ISO string
//
// yr.no (MET Norway) requires a real identifying User-Agent header or it
// returns 403. Replace the contact email below with your own before you
// deploy — see README.

const USER_AGENT = 'ride-weather-app/1.0 github.com/julesm(julesmataly@gmail.com)';

// category maps to a custom SVG icon rendered client-side (see app.js `icon()`)
const SYMBOLS = {
  clearsky: { category: 'sun', label: 'Clear sky' },
  fair: { category: 'sun-cloud', label: 'Fair' },
  partlycloudy: { category: 'sun-cloud', label: 'Partly cloudy' },
  cloudy: { category: 'cloud', label: 'Cloudy' },
  fog: { category: 'fog', label: 'Fog' },
  lightrain: { category: 'rain', label: 'Light rain' },
  rain: { category: 'rain', label: 'Rain' },
  heavyrain: { category: 'rain', label: 'Heavy rain' },
  lightrainshowers: { category: 'rain', label: 'Light showers' },
  rainshowers: { category: 'rain', label: 'Rain showers' },
  heavyrainshowers: { category: 'rain', label: 'Heavy showers' },
  lightsleet: { category: 'sleet', label: 'Light sleet' },
  sleet: { category: 'sleet', label: 'Sleet' },
  heavysleet: { category: 'sleet', label: 'Heavy sleet' },
  lightsnow: { category: 'snow', label: 'Light snow' },
  snow: { category: 'snow', label: 'Snow' },
  heavysnow: { category: 'snow', label: 'Heavy snow' },
  lightsnowshowers: { category: 'snow', label: 'Light snow showers' },
  snowshowers: { category: 'snow', label: 'Snow showers' },
  rainandthunder: { category: 'thunder', label: 'Thunder & rain' },
  rainshowersandthunder: { category: 'thunder', label: 'Thunder showers' },
  thunderstorm: { category: 'thunder', label: 'Thunderstorm' },
};

function symbolFor(code) {
  if (!code) return { category: 'unknown', label: 'No data' };
  const base = code.replace(/_(day|night|polartwilight)$/, '');
  return SYMBOLS[base] || { category: 'unknown', label: base };
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
