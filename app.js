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

  // ---------- Minimal Swiss-style weather icons ----------
  // Simple geometric strokes, no fills, built to match the ticket/grid look.
  const ICONS = {
    sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>`,
    'sun-cloud': `<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3.2"/><path d="M8 2.5v1.6M8 12v1.6M2.5 8h1.6M12 8h1.6M4.3 4.3l1.1 1.1M10.6 10.6l1.1 1.1M11.7 4.3l-1.1 1.1M5.4 10.6l-1.1 1.1"/><path class="accent" d="M9 20.5h8.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.2 15.4a3.2 3.2 0 0 0 .8 6.1" transform="translate(0,-1)"/></svg>`,
    cloud: `<svg viewBox="0 0 24 24"><path d="M7 19h10.5a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7.5 12.2 3.5 3.5 0 0 0 7 19Z"/></svg>`,
    fog: `<svg viewBox="0 0 24 24"><path d="M4 8h16M4 12h16M6 16h12M8 20h8"/></svg>`,
    rain: `<svg viewBox="0 0 24 24"><path d="M6.5 14.5h10.2a3.6 3.6 0 0 0 .5-7.17A5 5 0 0 0 7.7 8.1a3.2 3.2 0 0 0-1.2 6.4Z"/><path class="accent" d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>`,
    sleet: `<svg viewBox="0 0 24 24"><path d="M6.5 13.5h10.2a3.6 3.6 0 0 0 .5-7.17A5 5 0 0 0 7.7 7.1a3.2 3.2 0 0 0-1.2 6.4Z"/><path class="accent" d="M8 17l-1 2.5M12 17v3M16 17l-1 2.5"/></svg>`,
    snow: `<svg viewBox="0 0 24 24"><path d="M6.5 13h10.2a3.6 3.6 0 0 0 .5-7.17A5 5 0 0 0 7.7 6.6a3.2 3.2 0 0 0-1.2 6.4Z"/><g class="accent"><path d="M9 19v3M9 19l-1.6 1M9 19l1.6 1"/><path d="M15 19v3M15 19l-1.6 1M15 19l1.6 1"/></g></svg>`,
    thunder: `<svg viewBox="0 0 24 24"><path d="M6.5 13h10.2a3.6 3.6 0 0 0 .5-7.17A5 5 0 0 0 7.7 6.6a3.2 3.2 0 0 0-1.2 6.4Z"/><path class="accent" d="M13 15.5l-3 4.5h3l-1.5 3.5" fill="none"/></svg>`,
    unknown: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v.01M12 8a2.5 2.5 0 0 1 1.5 4.5c-.7.5-1.5 1-1.5 2"/></svg>`,
  };

  function icon(category) {
    return ICONS[category] || ICONS.unknown;
  }

  function labelFor(index, count, distKm, isWholeRoute) {
    if (isWholeRoute && index === 0) return 'Start';
    if (isWholeRoute && index === count - 1) return 'Finish';
    return `KM ${Math.round(distKm)}`;
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
  async function fetchWeather(stations, departureDate, speedKmh) {
    const payload = stations.map((s, i) => {
      const hours = s.targetKm / speedKmh;
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

  function yrLink(lat, lon) {
    return `https://www.yr.no/en/search/${lat.toFixed(4)},${lon.toFixed(4)}`;
  }

  function renderStations(stations, weatherResults, isWholeRoute) {
    stationsEl.innerHTML = '';
    stations.forEach((s, i) => {
      const w = weatherResults[i];
      const row = document.createElement('div');
      row.className = 'station';

      const arrival = new Date(w.time);
      const timeStr = arrival.toLocaleString(undefined, {
        weekday: 'short', hour: '2-digit', minute: '2-digit',
      });
      const link = yrLink(s.lat, s.lon);

      if (!w.weather) {
        row.classList.add('station--error');
        row.innerHTML = `
          <div class="station__index">${String(i + 1).padStart(2, '0')}</div>
          <div class="station__info">
            <span class="station__km"><a href="${link}" target="_blank" rel="noopener">${labelFor(i, stations.length, s.targetKm, isWholeRoute)}</a></span>
            <span class="station__time">${timeStr}</span>
          </div>
          <div class="station__symbol">${icon('unknown')}</div>
          <div class="station__detail"><span class="station__sub">${w.error || 'No data'}</span></div>
        `;
        stationsEl.appendChild(row);
        return;
      }

      const t = w.weather.temperature;
      const wind = w.weather.windSpeed;
      const precip = w.weather.precipitation;
      const isWarm = typeof t === 'number' && t >= 20;

      row.innerHTML = `
        <div class="station__index">${String(i + 1).padStart(2, '0')}</div>
        <div class="station__info">
          <span class="station__km"><a href="${link}" target="_blank" rel="noopener" title="See this spot on yr.no">${labelFor(i, stations.length, s.targetKm, isWholeRoute)}</a></span>
          <span class="station__time">${timeStr}</span>
        </div>
        <div class="station__symbol" title="${w.weather.symbol.label}">${icon(w.weather.symbol.category)}</div>
        <div class="station__detail">
          <span class="station__temp ${isWarm ? 'is-warm' : ''}">${t !== null ? Math.round(t) + '°' : '—'}</span>
          <span class="station__sub">${wind !== null ? Math.round(wind) + ' m/s wind' : ''}${precip ? ` · ${precip}mm` : ''}</span>
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

    const speed = parseFloat(speedInput.value);
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

      const weatherResults = await fetchWeather(stations, departureDate, speed);

      routeNameEl.textContent = ride.name;
      statDistance.textContent = segmentKm.toFixed(0);
      statDuration.textContent = (segmentKm / speed).toFixed(1);
      statPoints.textContent = String(count);

      renderElevationProfile(ride.points, fromKm, toKm);
      renderStations(stations, weatherResults, isWholeRoute);

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
