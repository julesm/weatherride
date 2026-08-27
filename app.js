(() => {
  'use strict';

  // ---------- DOM ----------
  const form = document.getElementById('ride-form');
  const routeUrlInput = document.getElementById('route-url');
  const gpxFileInput = document.getElementById('gpx-file');
  const gpxDropzone = document.getElementById('gpx-dropzone');
  const gpxDropzoneLabel = document.getElementById('gpx-dropzone-label');
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
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const shareErrorEl = document.getElementById('share-error');
  const copyLinkLabel = document.getElementById('copy-link-label');

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

  // ---------- GPX dropzone ----------
  function updateDropzoneLabel() {
    if (gpxFileInput.files && gpxFileInput.files.length) {
      gpxDropzoneLabel.textContent = gpxFileInput.files[0].name;
      gpxDropzone.classList.add('has-file');
    } else {
      gpxDropzoneLabel.textContent = 'Drag a GPX file here, or click to browse';
      gpxDropzone.classList.remove('has-file');
    }
  }

  gpxFileInput.addEventListener('change', updateDropzoneLabel);

  ['dragenter', 'dragover'].forEach((evt) => {
    gpxDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      gpxDropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'dragend'].forEach((evt) => {
    gpxDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      gpxDropzone.classList.remove('is-dragover');
    });
  });

  gpxDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    gpxDropzone.classList.remove('is-dragover');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) {
      gpxFileInput.files = files;
      updateDropzoneLabel();
    }
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

  // ---------- Terrain-aware pacing ----------
  // A rough, clearly-approximate model of how grade affects cycling speed —
  // not physics, just a curve calibrated against typical average speeds at
  // various gradients. Used to redistribute the ride's total time (which
  // still comes out to exactly segmentKm / avgSpeed overall) unevenly across
  // the route, so a climb takes proportionally longer than a descent instead
  // of everything being paced identically.
  function relativeSpeedForGrade(grade) {
    if (grade >= 0) {
      return 1 / (1 + 8 * grade + 220 * grade * grade);
    }
    const down = -grade;
    return 1 + Math.min(0.65, 9 * down); // descents help a lot, but capped — nobody free-falls forever
  }

  // Returns { hoursAtKm(km) } — hours elapsed since fromKm, terrain-weighted,
  // guaranteed to sum to exactly totalHours at toKm. Falls back to plain
  // uniform pacing if there isn't enough elevation data to work with.
  function buildPaceSchedule(points, fromKm, toKm, totalHours) {
    const seg = points.filter(
      (p) => p.distKm >= fromKm - 0.001 && p.distKm <= toKm + 0.001 && p.ele !== null && p.ele !== undefined
    );

    if (seg.length < 2 || toKm <= fromKm) {
      const span = toKm - fromKm || 1;
      return {
        hoursAtKm(km) {
          const clamped = Math.min(Math.max(km, fromKm), toKm);
          return totalHours * ((clamped - fromKm) / span);
        },
      };
    }

    const cum = [{ distKm: seg[0].distKm, relHours: 0 }];
    let relTotal = 0;
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      const distKmSeg = b.distKm - a.distKm;
      if (distKmSeg <= 0) {
        cum.push({ distKm: b.distKm, relHours: relTotal });
        continue;
      }
      const grade = (b.ele - a.ele) / (distKmSeg * 1000);
      const relSpeed = relativeSpeedForGrade(grade);
      relTotal += distKmSeg / Math.max(relSpeed, 0.05);
      cum.push({ distKm: b.distKm, relHours: relTotal });
    }

    const scale = relTotal > 0 ? totalHours / relTotal : 0;

    function hoursAtKm(km) {
      const clamped = Math.min(Math.max(km, cum[0].distKm), cum[cum.length - 1].distKm);
      let lo = cum[0];
      let hi = cum[cum.length - 1];
      for (let i = 1; i < cum.length; i++) {
        if (cum[i].distKm >= clamped) {
          hi = cum[i];
          lo = cum[i - 1];
          break;
        }
      }
      const span = hi.distKm - lo.distKm;
      const t = span > 0 ? (clamped - lo.distKm) / span : 0;
      return (lo.relHours + t * (hi.relHours - lo.relHours)) * scale;
    }

    return { hoursAtKm };
  }

  // Elevation gain between two distances, or null if there's no usable
  // elevation data in that range (rather than misleadingly showing 0).
  function climbingBetweenKm(points, kmStart, kmEnd) {
    const seg = points.filter(
      (p) => p.distKm >= kmStart - 0.001 && p.distKm <= kmEnd + 0.001 && p.ele !== null && p.ele !== undefined
    );
    if (seg.length < 2) return null;
    let gain = 0;
    for (let i = 1; i < seg.length; i++) {
      const delta = seg[i].ele - seg[i - 1].ele;
      if (delta > 0) gain += delta;
    }
    return Math.round(gain);
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
          let prevPoint = null;
          const points = [];
          for (const node of source) {
            const lat = parseFloat(node.getAttribute('lat'));
            const lon = parseFloat(node.getAttribute('lon'));
            if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
            const eleNode = node.querySelector('ele');
            const ele = eleNode ? parseFloat(eleNode.textContent) : null;
            const point = { lat, lon, ele: Number.isNaN(ele) ? null : ele };
            if (prevPoint) {
              cumulative += haversineKm(prevPoint, point);
            }
            prevPoint = point;
            points.push({ ...point, distKm: cumulative });
          }
          if (points.length < 2) {
            reject(new Error('Could not find enough valid coordinates in that GPX file.'));
            return;
          }
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
  async function fetchWeather(stations, departureDate) {
    const payload = stations.map((s) => {
      const arrival = new Date(departureDate.getTime() + s.hoursFromStart * 3600 * 1000);
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
    // Match the viewBox to the actual rendered pixel width so that text and
    // markers are a real, legible physical size on any screen — a fixed
    // 1000-unit viewBox squashes to ~3px text on a narrow phone.
    const measuredWidth = profileSvg.clientWidth || 1000;
    const w = Math.max(measuredWidth, 280);
    const h = 140, pad = 6;
    profileSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);

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
      <path d="${linePath}" fill="none" stroke="#5A5D63" stroke-width="1.5"></path>
      ${markers}
    `;
  }

  function renderStations(stations, weatherResults, isWholeRoute, placeNames, elevationSource) {
    stationsEl.innerHTML = '';
    stations.forEach((s, i) => {
      const w = weatherResults[i];
      const row = document.createElement('div');
      row.className = 'station';

      const arrival = new Date(w.time);
      const timeStr = formatArrival(arrival);
      const kmLabel = labelFor(i, stations.length, s.targetKm, isWholeRoute);
      const place = placeNames && placeNames[i];
      const indexHtml = `<span class="station__index">${String(i + 1).padStart(2, '0')}</span>`;
      const kmHtml = place
        ? `${indexHtml}${kmLabel} <span class="station__place">– ${place}</span>`
        : `${indexHtml}${kmLabel}`;
      const uid = `${i}-${Math.round(s.targetKm)}`;

      const appendConnector = () => {
        if (i >= stations.length - 1) return;
        const next = stations[i + 1];
        const distBetween = next.targetKm - s.targetKm;
        const climb = elevationSource ? climbingBetweenKm(elevationSource, s.targetKm, next.targetKm) : null;
        const hoursBetween =
          typeof next.hoursFromStart === 'number' && typeof s.hoursFromStart === 'number'
            ? Math.max(0, next.hoursFromStart - s.hoursFromStart)
            : null;

        const link = document.createElement('div');
        link.className = 'station-link';
        link.innerHTML = `
          <span>${distBetween.toFixed(0)} km</span>
          ${climb !== null ? `<span>↗ ${climb} m</span>` : ''}
          ${hoursBetween !== null ? `<span>${formatDuration(hoursBetween)}</span>` : ''}
        `;
        stationsEl.appendChild(link);
      };

      if (!w.weather) {
        row.classList.add('station--error');
        row.innerHTML = `
          <div class="station__info">
            <span class="station__km">${kmHtml}</span>
            <span class="station__time">${timeStr}</span>
          </div>
          <div class="station__symbol">${icon('unknown', uid)}</div>
          <div class="station__detail"><span class="station__sub">${w.error || 'No data'}</span></div>
        `;
        stationsEl.appendChild(row);
        appendConnector();
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
      appendConnector();
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

      // Terrain-adjusted pacing: total time still equals segmentKm / speed
      // exactly, but a climb eats a bigger share of it than a flat stretch.
      const totalHours = segmentKm / speed;
      const paceSchedule = buildPaceSchedule(ride.points, fromKm, toKm, totalHours);
      stations.forEach((s) => {
        s.hoursFromStart = paceSchedule.hoursAtKm(s.targetKm);
      });

      const [weatherResults, placeNames] = await Promise.all([
        fetchWeather(stations, departureDate),
        fetchPlaceNames(stations),
      ]);

      routeNameEl.textContent = ride.name;
      statDistance.textContent = segmentKm.toFixed(0);
      statDuration.textContent = formatDuration(segmentKm / speed);
      statPoints.textContent = String(count);

      loading.hidden = true;
      board.hidden = false;

      const elevationPoints = downsampleElevation(ride.points);
      renderElevationProfile(elevationPoints, fromKm, toKm, stations);
      lastProfileArgs = [elevationPoints, fromKm, toKm, stations];
      renderStations(stations, weatherResults, isWholeRoute, placeNames, ride.points);

      // Save the computed result so it can be shared with a link — works
      // for GPX uploads too, since we're storing the result, not the source.
      await saveAndShowShareLink({
        routeName: ride.name,
        segmentKm,
        durationHours: segmentKm / speed,
        pointCount: count,
        fromKm,
        toKm,
        isWholeRoute,
        elevationPoints,
        stations,
        weatherResults,
        placeNames,
      });

      board.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      loading.hidden = true;
      showError(err.message || 'Something went wrong. Try again.');
    } finally {
      goBtn.disabled = false;
    }
  });

  let lastProfileArgs = null;

  window.addEventListener('resize', () => {
    if (!lastProfileArgs || board.hidden) return;
    clearTimeout(window.__profileResizeTimer);
    window.__profileResizeTimer = setTimeout(() => {
      renderElevationProfile(...lastProfileArgs);
    }, 150);
  });

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  // ---------- Shareable links ----------
  // We store the *computed result* (not just the source), so this works
  // for GPX uploads too, not just pasted links.
  function downsampleElevation(points, maxPoints = 300) {
    if (points.length <= maxPoints) {
      return points.map((p) => ({ distKm: p.distKm, ele: p.ele }));
    }
    const stride = Math.ceil(points.length / maxPoints);
    const out = [];
    for (let i = 0; i < points.length; i += stride) {
      out.push({ distKm: points[i].distKm, ele: points[i].ele });
    }
    const last = points[points.length - 1];
    if (!out.length || out[out.length - 1].distKm !== last.distKm) {
      out.push({ distKm: last.distKm, ele: last.ele });
    }
    return out;
  }

  async function saveAndShowShareLink(payload) {
    shareErrorEl.hidden = true;
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        // Server didn't return JSON at all — usually means the request
        // never reached our function (e.g. api/share.js missing from the
        // deploy, or a platform-level error page came back instead).
        shareErrorEl.textContent = `Sharing failed: server returned ${res.status} ${res.statusText || ''} instead of a valid response. Check that api/share.js was uploaded and deployed.`;
        shareErrorEl.hidden = false;
        copyLinkBtn.hidden = true;
        return;
      }

      if (!res.ok || !data.id) {
        shareErrorEl.textContent = `Sharing failed: ${data.error || `server returned ${res.status}`}`;
        shareErrorEl.hidden = false;
        copyLinkBtn.hidden = true;
        return;
      }

      const shareUrl = `${window.location.origin}${window.location.pathname}?ride=${data.id}`;
      history.replaceState(null, '', shareUrl);
      copyLinkBtn.hidden = false;
    } catch (err) {
      shareErrorEl.textContent = `Sharing failed: ${err.message || 'could not reach the server.'}`;
      shareErrorEl.hidden = false;
      copyLinkBtn.hidden = true;
    }
  }

  copyLinkBtn.addEventListener('click', async () => {
    const url = window.location.href;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const original = copyLinkLabel.textContent;
      copyLinkLabel.textContent = 'Copied!';
      setTimeout(() => { copyLinkLabel.textContent = original; }, 1600);
    } catch {
      copyLinkLabel.textContent = 'Could not copy — copy it from the address bar';
    }
  });

  function renderFromShared(data) {
    routeNameEl.textContent = data.routeName || '—';
    statDistance.textContent = Number(data.segmentKm || 0).toFixed(0);
    statDuration.textContent = formatDuration(data.durationHours || 0);
    statPoints.textContent = String(data.pointCount || (data.stations || []).length);

    loading.hidden = true;
    board.hidden = false;

    renderElevationProfile(data.elevationPoints || [], data.fromKm, data.toKm, data.stations);
    lastProfileArgs = [data.elevationPoints || [], data.fromKm, data.toKm, data.stations];
    renderStations(data.stations || [], data.weatherResults || [], data.isWholeRoute, data.placeNames || [], data.elevationPoints || []);

    copyLinkBtn.hidden = false;
    board.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // If the page was opened with a shared link, load and show it directly —
  // no route fetching or weather calls needed, it's all cached already.
  async function initFromSharedLink() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('ride');
    if (!id) return;

    loading.hidden = false;
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'This shared forecast could not be found.');
      renderFromShared(data);
    } catch (err) {
      loading.hidden = true;
      showError(err.message || 'This shared forecast could not be loaded — it may have expired.');
    }
  }

  initFromSharedLink();
})();
