(() => {
  'use strict';

  // ---------- DOM ----------
  const form = document.getElementById('ride-form');
  const routeUrlInput = document.getElementById('route-url');
  const gpxFileInput = document.getElementById('gpx-file');
  const dateInput = document.getElementById('depart-date');
  const timeInput = document.getElementById('depart-time');
  const speedInput = document.getElementById('speed');
  const rangeFromInput = document.getElementById('range-from');
  const rangeToInput = document.getElementById('range-to');
  const goBtn = document.getElementById('go-btn');
  const formError = document.getElementById('form-error');
  const board = document.getElementById('board');
  const loading = document.getElementById('loading');
  const stationsEl = document.getElementById('stations');
  const routeNameEl = document.getElementById('route-name');
  const statDistance = document.getElementById('stat-distance');
  const statDuration = document.getElementById('stat-duration');
  const statPoints = document.getElementById('stat-points');
  const profileSvg = document.getElementById('elevation-profile');

  let activeSource = 'link';
  let activeRangeMode = 'whole';

  // ---------- Defaults: tomorrow, 09:00 ----------
  (function setDefaults() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
    timeInput.value = '09:00';
  })();

  // ---------- Tabs ----------
  // Source tabs (paste link / upload GPX)
  document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab[data-tab]').forEach((t) => t.classList.remove('is-active'));
      document.querySelectorAll('.tab-panel[data-panel]').forEach((p) => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      const name = tab.dataset.tab;
      document.querySelector(`.tab-panel[data-panel="${name}"]`).classList.add('is-active');
      activeSource = name;
    });
  });

  // Range tabs (whole route / from-to)
  document.querySelectorAll('.tab[data-range-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab[data-range-tab]').forEach((t) => t.classList.remove('is-active'));
      document.querySelectorAll('.tab-panel[data-range-panel]').forEach((p) => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      const name = tab.dataset.rangeTab;
      document.querySelector(`.tab-panel[data-range-panel="${name}"]`).classList.add('is-active');
      activeRangeMode = name;
    });
  });

  // ---------- Helpers ----------
  function haversineKm(a, b) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function extractRouteId(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/routes\/(\d+)/);
    if (match) return match[1];
    if (/^\d+$/.test(trimmed)) return trimmed;
    return null;
  }

  function stationCountFor(totalKm) {
    if (totalKm <= 50) return 3;
    if (totalKm <= 100) return 5;
    if (totalKm <= 150) return 6;
    if (totalKm <= 200) return 7;
    return 8;
  }

  // points: [{lat, lon, ele, distKm}] sorted by distKm, cumulative from 0.
  // fromKm/toKm let you isolate a section of the route instead of the whole thing.
  function pickStations(points, count, fromKm, toKm) {
    const targets = [];
    for (let i = 0; i < count; i++) {
      targets.push(fromKm + ((toKm - fromKm) * i) / (count - 1));
    }
    return targets.map((targetKm) => {
      let best = points[0];
      let bestDiff = Infinity;
      for (const p of points) {
        const diff = Math.abs(p.distKm - targetKm);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = p;
        }
      }
      return { ...best, targetKm };
    });
  }

  // ---------- Colour Swiss-style weather icons ----------
  // Flat geometric shapes with soft gradients — sun=yellow, cloud=grey, rain/snow/sleet tinted blue/white, thunder=amber bolt.
  // Gradient ids are suffixed with a unique id per render to avoid collisions across rows.
  function iconSvg(category, uid) {
    const g = (name) => `${name}-${uid}`;
    switch (category) {
      case 'sun':
        return `<svg viewBox="0 0 24 24">
          <defs><radialGradient id="${g('sun')}" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stop-color="#FFE49A"/><stop offset="100%" stop-color="#FFB800"/>
          </radialGradient></defs>
          <g stroke="#F2A900" stroke-width="1.4" stroke-linecap="round">
            <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.7 4.7l2.1 2.1M17.2 17.2l2.1 2.1M19.3 4.7l-2.1 2.1M6.8 17.2l-2.1 2.1"/>
          </g>
          <circle cx="12" cy="12" r="5.6" fill="url(#${g('sun')})"/>
        </svg>`;
      case 'sun-cloud':
        return `<svg viewBox="0 0 24 24">
          <defs>
            <radialGradient id="${g('sunc')}" cx="35%" cy="35%" r="70%"><stop offset="0%" stop-color="#FFE49A"/><stop offset="100%" stop-color="#FFB800"/></radialGradient>
            <linearGradient id="${g('cloudc')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E7E9ED"/><stop offset="100%" stop-color="#BEC3CB"/></linearGradient>
          </defs>
          <circle cx="9" cy="8" r="4.4" fill="url(#${g('sunc')})"/>
          <path d="M8.5 20.5h8.2a3.6 3.6 0 0 0 .4-7.18A5.1 5.1 0 0 0 7.6 14.9a3.3 3.3 0 0 0 .9 5.6Z" fill="url(#${g('cloudc')})" stroke="#9EA4AD" stroke-width="0.8"/>
        </svg>`;
      case 'cloud':
        return `<svg viewBox="0 0 24 24">
          <defs><linearGradient id="${g('cloud')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E7E9ED"/><stop offset="100%" stop-color="#B3B9C2"/></linearGradient></defs>
          <path d="M6 19h11.5a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7.4 12.1 3.5 3.5 0 0 0 6 19Z" fill="url(#${g('cloud')})" stroke="#9198A2" stroke-width="0.8"/>
        </svg>`;
      case 'fog':
        return `<svg viewBox="0 0 24 24">
          <g stroke="#AFB5BD" stroke-width="1.6" stroke-linecap="round">
            <path d="M4 7.5h16" opacity="0.5"/><path d="M3 11.5h18" opacity="0.75"/><path d="M4 15.5h16"/><path d="M6 19.5h12" opacity="0.6"/>
          </g>
        </svg>`;
      case 'rain':
        return `<svg viewBox="0 0 24 24">
          <defs>
            <linearGradient id="${g('rc')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#DADDE2"/><stop offset="100%" stop-color="#AEB4BD"/></linearGradient>
            <linearGradient id="${g('rd')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6FB3F2"/><stop offset="100%" stop-color="#1E7FE0"/></linearGradient>
          </defs>
          <path d="M5.8 13.8h10.6a3.6 3.6 0 0 0 .5-7.17 5 5 0 0 0-9.6.9 3.2 3.2 0 0 0-1.5 6.27Z" fill="url(#${g('rc')})" stroke="#9198A2" stroke-width="0.8"/>
          <g fill="url(#${g('rd')})"><path d="M8.5 17.5c0 1-1.6 1-1.6 0 0-.7.8-1.7.8-1.7s.8 1 .8 1.7Z"/><path d="M13 18.3c0 1-1.6 1-1.6 0 0-.7.8-1.7.8-1.7s.8 1 .8 1.7Z"/><path d="M17.5 17.5c0 1-1.6 1-1.6 0 0-.7.8-1.7.8-1.7s.8 1 .8 1.7Z"/></g>
        </svg>`;
      case 'sleet':
        return `<svg viewBox="0 0 24 24">
          <defs><linearGradient id="${g('sc')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#DADDE2"/><stop offset="100%" stop-color="#AEB4BD"/></linearGradient></defs>
          <path d="M5.8 13.3h10.6a3.6 3.6 0 0 0 .5-7.17 5 5 0 0 0-9.6.9 3.2 3.2 0 0 0-1.5 6.27Z" fill="url(#${g('sc')})" stroke="#9198A2" stroke-width="0.8"/>
          <path d="M8 17.3c0 .9-1.5.9-1.5 0 0-.65.75-1.6.75-1.6s.75.95.75 1.6Z" fill="#4FA0E8"/>
          <g stroke="#B9DCFF" stroke-width="1.3" stroke-linecap="round"><path d="M12.2 16v3.4M10.8 16.9l2.8 1.6M15 16.9l-2.8 1.6"/></g>
        </svg>`;
      case 'snow':
        return `<svg viewBox="0 0 24 24">
          <defs><linearGradient id="${g('nc')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E7E9ED"/><stop offset="100%" stop-color="#C3C8D0"/></linearGradient></defs>
          <path d="M5.8 12.8h10.6a3.6 3.6 0 0 0 .5-7.17 5 5 0 0 0-9.6.9 3.2 3.2 0 0 0-1.5 6.27Z" fill="url(#${g('nc')})" stroke="#9198A2" stroke-width="0.8"/>
          <g stroke="#8FC4F5" stroke-width="1.3" stroke-linecap="round">
            <path d="M8 16v4M6.3 17.1l3.4 1.8M11.4 17.1 8 18.9"/>
            <path d="M16 16v4M14.3 17.1l3.4 1.8M19.4 17.1 16 18.9"/>
          </g>
        </svg>`;
      case 'thunder':
        return `<svg viewBox="0 0 24 24">
          <defs>
            <linearGradient id="${g('tc')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#C7CBD1"/><stop offset="100%" stop-color="#8D93A0"/></linearGradient>
            <linearGradient id="${g('tb')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFD666"/><stop offset="100%" stop-color="#F2860B"/></linearGradient>
          </defs>
          <path d="M5.8 12.3h10.6a3.6 3.6 0 0 0 .5-7.17 5 5 0 0 0-9.6.9 3.2 3.2 0 0 0-1.5 6.27Z" fill="url(#${g('tc')})" stroke="#767C86" stroke-width="0.8"/>
          <path d="M13.4 14l-3.6 5.4h2.6L11 23l4.6-6.2h-2.7l1-2.8Z" fill="url(#${g('tb')})"/>
        </svg>`;
      default:
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#C3C8D0" stroke-width="1.4"/><path d="M12 16v.01M12 8a2.5 2.5 0 0 1 1.5 4.5c-.7.5-1.5 1-1.5 2" fill="none" stroke="#C3C8D0" stroke-width="1.4" stroke-linecap="round"/></svg>`;
    }
  }

  function icon(category, uid) {
    return iconSvg(category, uid);
  }

  // Small arrow indicating where the wind is blowing TOWARD (met "from" direction + 180°)
  function windArrowSvg(fromDegrees) {
    const toDegrees = (fromDegrees + 180) % 360;
    return `<svg class="wind-arrow" viewBox="0 0 24 24" style="transform: rotate(${toDegrees}deg)">
      <path d="M12 2 L17 14 L12 11 L7 14 Z" fill="#6B6F76"/>
    </svg>`;
  }

  function degToCompass(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  function labelFor(index, count, distKm, isWholeRoute) {
    if (isWholeRoute && index === 0) return 'Start';
    if (isWholeRoute && index === count - 1) return 'Finish';
    return `KM ${Math.round(distKm)}`;
  }

  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function formatArrival(date) {
    const day = WEEKDAYS[date.getDay()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${day} ${hh}:${mm}`;
  }

  function formatDuration(hoursFloat) {
    const totalMinutes = Math.round(hoursFloat * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}min`;
  }

  // ---------- Route sources ----------
  async function loadFromRideWithGPS(text) {
    const id = extractRouteId(text);
    if (!id) {
      throw new Error("Couldn't find a route number in that link. Paste the full RideWithGPS URL, or just the route number.");
    }
    const res = await fetch(`/api/route?id=${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load that route.');

    let cumulative = 0;
    const points = data.points.map((p, i, arr) => {
      if (p.dist !== null) {
        cumulative = p.dist / 1000;
      } else if (i > 0) {
        cumulative += haversineKm(arr[i - 1], p);
      }
      return { lat: p.lat, lon: p.lon, ele: p.ele, distKm: cumulative };
    });

    return { name: data.name, points };
  }

  function loadFromGpx(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        try {
          const xml = new DOMParser().parseFromString(reader.result, 'application/xml');
          if (xml.querySelector('parsererror')) {
            reject(new Error('That file does not look like a valid GPX file.'));
            return;
          }
          const trkpts = Array.from(xml.querySelectorAll('trkpt'));
          const source = trkpts.length ? trkpts : Array.from(xml.querySelectorAll('rtept'));
          if (!source.length) {
            reject(new Error('No track points found in that GPX file.'));
            return;
          }
          let cumulative = 0;
          const points = source.map((node, i) => {
            const lat = parseFloat(node.getAttribute('lat'));
            const lon = parseFloat(node.getAttribute('lon'));
            const eleNode = node.querySelector('ele');
            const ele = eleNode ? parseFloat(eleNode.textContent) : null;
            const point = { lat, lon, ele };
            if (i > 0) {
              const prev = points[i - 1];
              cumulative += haversineKm(prev, point);
            }
            return { ...point, distKm: cumulative };
          });
          const nameNode = xml.querySelector('trk > name, metadata > name');
          resolve({ name: nameNode ? nameNode.textContent : file.name.replace(/\.gpx$/i, ''), points });
        } catch (err) {
          reject(new Error('Could not parse that GPX file.'));
        }
      };
      reader.readAsText(file);
    });
  }

  // ---------- Weather ----------
  async function fetchWeather(stations, departureDate, speedKmh, fromKm) {
    const payload = stations.map((s) => {
      const hours = (s.targetKm - fromKm) / speedKmh;
      const arrival = new Date(departureDate.getTime() + hours * 3600 * 1000);
      return {
        lat: s.lat,
        lon: s.lon,
        km: Math.round(s.targetKm),
        time: arrival.toISOString(),
      };
    });

    const res = await fetch('/api/weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not fetch weather.');
    return data.results;
  }

  // ---------- Place names ----------
  async function fetchPlaceNames(stations) {
    try {
      const res = await fetch('/api/placename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: stations.map((s) => ({ lat: s.lat, lon: s.lon })) }),
      });
      if (!res.ok) return stations.map(() => null);
      const data = await res.json();
      return data.results.map((r) => r.name || null);
    } catch {
      return stations.map(() => null);
    }
  }

  // ---------- Rendering ----------
  function renderElevationProfile(points, fromKm, toKm) {
    const w = 1000, h = 140, pad = 6;
    const eles = points.map((p) => p.ele).filter((e) => e !== null && e !== undefined);
    if (!eles.length) {
      profileSvg.innerHTML = '';
      return;
    }
    const min = Math.min(...eles);
    const max = Math.max(...eles);
    const range = Math.max(max - min, 1);
    const total = points[points.length - 1].distKm || 1;

    const coords = points
      .filter((p) => p.ele !== null && p.ele !== undefined)
      .map((p) => {
        const x = pad + (p.distKm / total) * (w - pad * 2);
        const y = h - pad - ((p.ele - min) / range) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });

    const linePath = `M${coords.join(' L')}`;
    const fillPath = `M${pad},${h} L${coords.join(' L')} L${w - pad},${h} Z`;

    let bandPath = '';
    if (typeof fromKm === 'number' && typeof toKm === 'number' && (fromKm > 0 || toKm < total)) {
      const x1 = pad + (fromKm / total) * (w - pad * 2);
      const x2 = pad + (toKm / total) * (w - pad * 2);
      bandPath = `<rect x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${h}" fill="#e1000f" opacity="0.12"></rect>`;
    }

    profileSvg.innerHTML = `
      ${bandPath}
      <path d="${fillPath}" fill="#e1000f" opacity="0.08" stroke="none"></path>
      <path d="${linePath}" fill="none" stroke="#111111" stroke-width="1.5"></path>
    `;
  }

  function renderStations(stations, weatherResults, isWholeRoute, placeNames) {
    stationsEl.innerHTML = '';
    stations.forEach((s, i) => {
      const w = weatherResults[i];
      const row = document.createElement('div');
      row.className = 'station';

      const arrival = new Date(w.time);
      const timeStr = formatArrival(arrival);
      const kmLabel = labelFor(i, stations.length, s.targetKm, isWholeRoute);
      const place = placeNames && placeNames[i];
      const kmHtml = place
        ? `${kmLabel} <span class="station__place">– ${place}</span>`
        : kmLabel;
      const uid = `${i}-${Math.round(s.targetKm)}`;

      if (!w.weather) {
        row.classList.add('station--error');
        row.innerHTML = `
          <div class="station__index">${String(i + 1).padStart(2, '0')}</div>
          <div class="station__info">
            <span class="station__km">${kmHtml}</span>
            <span class="station__time">${timeStr}</span>
          </div>
          <div class="station__symbol">${icon('unknown', uid)}</div>
          <div class="station__detail"><span class="station__sub">${w.error || 'No data'}</span></div>
        `;
        stationsEl.appendChild(row);
        return;
      }

      const t = w.weather.temperature;
      const wind = w.weather.windSpeed;
      const windDir = w.weather.windDirection;
      const precip = w.weather.precipitation;
      const isWarm = typeof t === 'number' && t >= 20;

      const windHtml = wind !== null
        ? `${windDir !== null ? windArrowSvg(windDir) : ''}${Math.round(wind)} m/s${windDir !== null ? ` ${degToCompass(windDir)}` : ''}`
        : '';

      row.innerHTML = `
        <div class="station__index">${String(i + 1).padStart(2, '0')}</div>
        <div class="station__info">
          <span class="station__km">${kmHtml}</span>
          <span class="station__time">${timeStr}</span>
        </div>
        <div class="station__symbol" title="${w.weather.symbol.label}">${icon(w.weather.symbol.category, uid)}</div>
        <div class="station__detail">
          <span class="station__temp ${isWarm ? 'is-warm' : ''}">${t !== null ? Math.round(t) + '°' : '—'}</span>
          <span class="station__sub">${windHtml}${precip ? ` · ${precip}mm` : ''}</span>
        </div>
      `;
      stationsEl.appendChild(row);
    });
  }

  // ---------- Submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.hidden = true;
    board.hidden = true;

    const speed = Math.round(parseFloat(speedInput.value));
    if (!speed || speed <= 0) {
      showError('Enter a valid average speed.');
      return;
    }
    if (!dateInput.value || !timeInput.value) {
      showError('Choose a departure date and time.');
      return;
    }
    const departureDate = new Date(`${dateInput.value}T${timeInput.value}`);

    goBtn.disabled = true;
    loading.hidden = false;

    try {
      let ride;
      if (activeSource === 'gpx') {
        if (!gpxFileInput.files.length) throw new Error('Choose a GPX file first.');
        ride = await loadFromGpx(gpxFileInput.files[0]);
      } else {
        if (!routeUrlInput.value.trim()) throw new Error('Paste a RideWithGPS link or route number.');
        ride = await loadFromRideWithGPS(routeUrlInput.value);
      }

      if (ride.points.length < 2) {
        throw new Error('That route is too short to plot.');
      }

      const totalKm = ride.points[ride.points.length - 1].distKm;

      let fromKm = 0;
      let toKm = totalKm;
      const isWholeRoute = activeRangeMode === 'whole';

      if (!isWholeRoute) {
        const from = parseFloat(rangeFromInput.value);
        const to = rangeToInput.value ? parseFloat(rangeToInput.value) : totalKm;
        if (Number.isNaN(from) || Number.isNaN(to)) {
          throw new Error('Enter a valid "from" and "to" km for the section.');
        }
        if (from < 0 || to > totalKm + 0.5 || from >= to) {
          throw new Error(`This route is ${totalKm.toFixed(0)}km long — choose a from/to within that range.`);
        }
        fromKm = from;
        toKm = to;
      }

      const segmentKm = toKm - fromKm;
      const count = stationCountFor(segmentKm);
      const stations = pickStations(ride.points, count, fromKm, toKm);

      const [weatherResults, placeNames] = await Promise.all([
        fetchWeather(stations, departureDate, speed, fromKm),
        fetchPlaceNames(stations),
      ]);

      routeNameEl.textContent = ride.name;
      statDistance.textContent = segmentKm.toFixed(0);
      statDuration.textContent = formatDuration(segmentKm / speed);
      statPoints.textContent = String(count);

      renderElevationProfile(ride.points, fromKm, toKm);
      renderStations(stations, weatherResults, isWholeRoute, placeNames);

      loading.hidden = true;
      board.hidden = false;
      board.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      loading.hidden = true;
      showError(err.message || 'Something went wrong. Try again.');
    } finally {
      goBtn.disabled = false;
    }
  });

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }
})();
