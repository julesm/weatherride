// /api/route?id=12345
// Fetches a public RideWithGPS route server-side (browsers can't call
// ridewithgps.com directly due to CORS) and returns a slim point list.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const id = (req.query.id || '').toString().trim();

  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Missing or invalid route id.' });
    return;
  }

  try {
    const upstream = await fetch(`https://ridewithgps.com/routes/${id}.json`, {
      headers: { 'User-Agent': 'ride-weather-app (personal project)' },
    });

    if (upstream.status === 404) {
      res.status(404).json({ error: 'No route found with that id. Check the link and try again.' });
      return;
    }
    if (!upstream.ok) {
      res.status(502).json({ error: 'RideWithGPS did not return the route. It may be private.' });
      return;
    }

    const data = await upstream.json();
    const route = data.route || data;
    const rawPoints = route.track_points || [];

    if (!rawPoints.length) {
      res.status(422).json({ error: 'That route has no track points to work with.' });
      return;
    }

    const points = rawPoints
      .filter((p) => typeof p.x === 'number' && typeof p.y === 'number')
      .map((p) => ({
        lat: p.y,
        lon: p.x,
        ele: typeof p.e === 'number' ? p.e : null,
        dist: typeof p.d === 'number' ? p.d : null, // meters from start
      }));

    res.status(200).json({
      name: route.name || `Route ${id}`,
      points,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not reach RideWithGPS. Try again in a moment.' });
  }
};
