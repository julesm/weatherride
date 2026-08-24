(() => {
  'use strict';

  // ---------- DOM ----------
  const form = document.getElementById('ride-form');
  const routeUrlInput = document.getElementById('route-url');
  const gpxFileInput = document.getElementById('gpx-file');
  const dateInput = document.getElementById('depart-date');
  const timeInput = document.getElementById('depart-time');
  const speedInput = document.getElementById('speed');
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
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      const name = tab.dataset.tab;
      document.querySelector(`.tab-panel[data-panel="${name}"]`).classList.add('is-active');
      activeSource = name;
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

  // points: [{lat, lon, ele, distKm}] sorted by distKm, cumulative from 0
  function pickStations(points, count) {
    const total = points[points.length - 1].distKm;
    const targets = [];
    for (let i = 0; i < count; i++) {
      targets.push((total * i) / (count - 1));
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

  function labelFor(index, count, distKm) {
    if (index === 0) return 'Start';
    if (index === count - 1) return 'Finish';
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
  function renderElevationProfile(points) {
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

    profileSvg.innerHTML = `
      <path d="${fillPath}" fill="#e1000f" opacity="0.08" stroke="none"></path>
      <path d="${linePath}" fill="none" stroke="#111111" stroke-width="1.5"></path>
    `;
  }

  function renderStations(stations, weatherResults) {
    stationsEl.innerHTML = '';
    stations.forEach((s, i) => {
      const w = weatherResults[i];
      const row = document.createElement('div');
      row.className = 'station';

      const arrival = new Date(w.time);
      const timeStr = arrival.toLocaleString(undefined, {
        weekday: 'short', hour: '2-digit', minute: '2-digit',
      });

      if (!w.weather) {
        row.classList.add('station--error');
        row.innerHTML = `
          <div class="station__index">${String(i + 1).padStart(2, '0')}</div>
          <div class="station__info">
            <span class="station__km">${labelFor(i, stations.length, s.targetKm)}</span>
            <span class="station__time">${timeStr}</span>
          </div>
          <div class="station__symbol">—</div>
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
          <span class="station__km">${labelFor(i, stations.length, s.targetKm)}</span>
          <span class="station__time">${timeStr}</span>
        </div>
        <div class="station__symbol" title="${w.weather.symbol.label}">${w.weather.symbol.icon}</div>
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
      const count = stationCountFor(totalKm);
      const stations = pickStations(ride.points, count);

      const weatherResults = await fetchWeather(stations, departureDate, speed);

      routeNameEl.textContent = ride.name;
      statDistance.textContent = totalKm.toFixed(0);
      statDuration.textContent = (totalKm / speed).toFixed(1);
      statPoints.textContent = String(count);

      renderElevationProfile(ride.points);
      renderStations(stations, weatherResults);

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
