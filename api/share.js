// POST /api/share   body: the full computed board (route name, stats,
//                    elevation points, stations, weather, place names)
//                    -> { id }
// GET  /api/share?id=xxxx -> the stored board, or 404 if expired/missing
//
// Requires a free Upstash Redis database connected to this project via
// Vercel's Storage Marketplace — see README before deploying.

const { Redis } = require('@upstash/redis');

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const TTL_SECONDS = 60 * 60 * 24 * 21; // shared links last 3 weeks — forecasts are stale long before that anyway
const ID_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/l/i, easier to read aloud

function randomId(len = 8) {
  let out = '';
  for (let i = 0; i < len; i++) out += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!url || !token) {
    res.status(500).json({
      error: 'Storage isn\'t connected yet. In the Vercel dashboard, go to Storage and add an Upstash Redis database — see the README.',
    });
    return;
  }

  const redis = new Redis({ url, token });

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || !Array.isArray(body.stations)) {
      res.status(400).json({ error: 'Nothing to share.' });
      return;
    }

    try {
      let id;
      for (let attempt = 0; attempt < 5; attempt++) {
        id = randomId();
        const existing = await redis.get(`ride:${id}`);
        if (!existing) break;
      }
      await redis.set(`ride:${id}`, JSON.stringify(body), { ex: TTL_SECONDS });
      res.status(200).json({ id });
    } catch (err) {
      res.status(500).json({ error: 'Could not save this forecast for sharing.' });
    }
    return;
  }

  if (req.method === 'GET') {
    const id = (req.query.id || '').toString().trim();
    if (!id) {
      res.status(400).json({ error: 'Missing id.' });
      return;
    }
    try {
      const raw = await redis.get(`ride:${id}`);
      if (!raw) {
        res.status(404).json({ error: 'This shared forecast has expired or was not found.' });
        return;
      }
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      res.status(200).json(data);
    } catch (err) {
      res.status(500).json({ error: 'Could not load this shared forecast.' });
    }
    return;
  }

  res.status(405).json({ error: 'GET or POST only.' });
};
