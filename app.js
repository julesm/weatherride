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
  // Every icon is a flat circular "badge" of the same size and position
  // (cx=12, cy=12, r=9) so rows line up no matter which weather type shows.
  // Gradient ids are suffixed with a unique id per render to avoid collisions across rows.
  function iconSvg(category, uid) {
    const g = (name) => `${name}-${uid}`;
    switch (category) {
      case 'sun':
        return `<svg viewBox="0 0 24 24">
          <defs><radialGradient id="${g('sun')}" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#FFE49A"/><stop offset="100%" stop-color="#FFB800"/>
          </radialGradient></defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('sun')})"/>
        </svg>`;
      case 'sun-cloud':
        return `<svg viewBox="0 0 24 24">
          <defs>
            <radialGradient id="${g('sunc')}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#FFE49A"/><stop offset="100%" stop-color="#FFB800"/></radialGradient>
            <linearGradient id="${g('cloudc')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F1F2F4"/><stop offset="100%" stop-color="#C7CCD3"/></linearGradient>
          </defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('sunc')})"/>
          <ellipse cx="13.3" cy="14.3" rx="6.2" ry="4.2" fill="url(#${g('cloudc')})"/>
        </svg>`;
      case 'cloud':
        return `<svg viewBox="0 0 24 24">
          <defs><radialGradient id="${g('cloud')}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#DEE1E5"/><stop offset="100%" stop-color="#AFB5BE"/></radialGradient></defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('cloud')})"/>
        </svg>`;
      case 'fog':
        return `<svg viewBox="0 0 24 24">
          <defs><radialGradient id="${g('fog')}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#DEE1E5"/><stop offset="100%" stop-color="#AFB5BE"/></radialGradient></defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('fog')})"/>
          <g stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="0.85">
            <path d="M7 10h10M6.5 13h11M7.5 16h9"/>
          </g>
        </svg>`;
      case 'rain':
        return `<svg viewBox="0 0 24 24">
          <defs>
            <radialGradient id="${g('rc')}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#8FB9E8"/><stop offset="100%" stop-color="#3E7FC4"/></radialGradient>
          </defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('rc')})"/>
          <g fill="#fff"><path d="M9 11.5c0 1-1.6 1-1.6 0 0-.7.8-1.7.8-1.7s.8 1 .8 1.7Z"/><path d="M13.6 12.6c0 1-1.6 1-1.6 0 0-.7.8-1.7.8-1.7s.8 1 .8 1.7Z"/><path d="M17 11.5c0 1-1.6 1-1.6 0 0-.7.8-1.7.8-1.7s.8 1 .8 1.7Z"/></g>
        </svg>`;
      case 'sleet':
        return `<svg viewBox="0 0 24 24">
          <defs><radialGradient id="${g('sl')}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#8FB9E8"/><stop offset="100%" stop-color="#3E7FC4"/></radialGradient></defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('sl')})"/>
          <path d="M9.3 12.2c0 1-1.6 1-1.6 0 0-.7.8-1.7.8-1.7s.8 1 .8 1.7Z" fill="#fff"/>
          <g stroke="#fff" stroke-width="1.3" stroke-linecap="round"><path d="M14.5 10.5v4.2M13.1 11.5l2.8 2.2M15.9 11.5l-2.8 2.2"/></g>
        </svg>`;
      case 'snow':
        return `<svg viewBox="0 0 24 24">
          <defs><radialGradient id="${g('sn')}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#DCEBFC"/><stop offset="100%" stop-color="#A9C9EE"/></radialGradient></defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('sn')})"/>
          <g stroke="#fff" stroke-width="1.4" stroke-linecap="round">
            <path d="M12 7.5v9M8.4 9.5l7.2 5M15.6 9.5l-7.2 5"/>
          </g>
        </svg>`;
      case 'thunder':
        return `<svg viewBox="0 0 24 24">
          <defs>
            <radialGradient id="${g('th')}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#6E7382"/><stop offset="100%" stop-color="#3B3F4A"/></radialGradient>
            <linearGradient id="${g('tb')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFD666"/><stop offset="100%" stop-color="#F2860B"/></linearGradient>
          </defs>
          <circle cx="12" cy="12" r="9" fill="url(#${g('th')})"/>
          <path d="M13.3 6.8 9 13.4h2.9l-1 4.4 4.6-6.6h-2.8l1-4.4Z" fill="url(#${g('tb')})"/>
        </svg>`;
      default:
        return `<svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" fill="none" stroke="#C3C8D0" stroke-width="1.4"/>
          <path d="M12 16v.01M12 8a2.5 2.5 0 0 1 1.5 4.5c-.7.5-1.5 1-1.5 2" fill="none" stroke="#C3C8D0" stroke-width="1.4" stroke-linecap="round"/>
        </svg>`;
    }
  }

  function icon(category, uid) {
    return iconSvg(category, uid);
  }

  // Small arrow indicating where the wind is blowing TOWARD (met "from" direction + 180°)
  function windArrowSvg(fromDegrees) {
    const toDegrees = (fromDegrees + 180) % 360;
    return `<svg class="wind-arrow" viewBox="0 0 24 24" style="transform: rotate(${toDegrees}deg)">
      <path d="M12 1.5 L19 16 L12 12.2 L5 16 Z" fill="#111111"/>
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
  function renderElevationProfile(points, fromKm, toKm, stations) {
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
    const xFor = (km) => pad + (km / total) * (w - pad * 2);

    const coords = points
      .filter((p) => p.ele !== null && p.ele !== undefined)
      .map((p) => {
        const x = xFor(p.distKm);
        const y = h - pad - ((p.ele - min) / range) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });

    const linePath = `M${coords.join(' L')}`;
    const fillPath = `M${pad},${h} L${coords.join(' L')} L${w - pad},${h} Z`;

    let bandPath = '';
    if (typeof fromKm === 'number' && typeof toKm === 'number' && (fromKm > 0 || toKm < total)) {
      const x1 = xFor(fromKm);
      const x2 = xFor(toKm);
      bandPath = `<rect x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${h}" fill="#e1000f" opacity="0.12"></rect>`;
    }

    let markers = '';
    if (stations && stations.length) {
      markers = stations
        .map((s, i) => {
          const x = xFor(s.targetKm).toFixed(1);
          return `
            <line x1="${x}" y1="17" x2="${x}" y2="${h - 2}" stroke="#111111" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"></line>
            <rect x="${(x - 7).toFixed(1)}" y="2" width="14" height="14" fill="#f2f2ef"></rect>
            <text x="${x}" y="12.5" text-anchor="middle" font-size="10" font-family="Inter, sans-serif" font-weight="600" fill="#111111">${i + 1}</text>
          `;
        })
        .join('');
    }

    profileSvg.innerHTML = `
      ${bandPath}
      <path d="${fillPath}" fill="#e1000f" opacity="0.08" stroke="none"></path>
      <path d="${linePath}" fill="none" stroke="#111111" stroke-width="1.5"></path>
      ${markers}
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

      renderElevationProfile(ride.points, fromKm, toKm, stations);
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
