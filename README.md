# Ride / Weather

Paste a RideWithGPS route (or upload a GPX file), say when you're leaving and
how fast you ride, and get the weather forecast at points spaced out along
your route — not just at your front door.

## Before you deploy — required edits

**1. yr.no needs a real contact email.** Open `api/weather.js`, find this line near the top, and replace it with your own info:

```js
const USER_AGENT = 'ride-weather-app/1.0 github.com/YOUR-USERNAME (YOUR-EMAIL@example.com)';
```

**2. So does the place-name lookup.** Open `api/placename.js` and make the same edit — it uses OpenStreetMap's Nominatim service, which has the same courtesy requirement:

```js
const USER_AGENT = 'ride-weather-app/1.0 github.com/YOUR-USERNAME (YOUR-EMAIL@example.com)';
```

**3. Connect a free database for shareable links.** Sharing a forecast needs somewhere to store it — this uses Upstash Redis, connected through Vercel's Storage tab, free at this scale. Do this *after* your first deploy (steps below), then redeploy once:

1. In your Vercel project, open the **Storage** tab.
2. Click **Create Database** (or **Browse Marketplace**) and choose **Upstash** → **Redis**.
3. Follow the prompts to create a free database and connect it to this project — Vercel handles the credentials automatically, nothing to copy/paste.
4. Redeploy the project (Vercel usually prompts you to; if not, go to **Deployments** and redeploy the latest one) so the new connection takes effect.

Without this step, everything else works — you just won't get a "Copy link to share" button.

**4. (Optional) Point the footer link at your repo.** In `index.html`, find `href="https://github.com/YOUR-USERNAME/ride-weather"` and swap in your own repo URL once you've created it — or delete that line if you'd rather not link it.

## How to put this on the internet (free, ~10 minutes)

You don't need to install anything on your computer for this path.

### 1. Put the code on GitHub
1. Go to [github.com](https://github.com) and create a free account if you don't have one.
2. Click the **+** in the top right → **New repository**. Name it `ride-weather`, keep it Public, click **Create repository**.
3. On the next page click **uploading an existing file**.
4. Drag every file and folder from this project (including the `api` folder) into the upload box.
5. Scroll down and click **Commit changes**.

### 2. Deploy it with Vercel
1. Go to [vercel.com](https://vercel.com) and sign up — choose **Continue with GitHub**, it's the easiest.
2. Click **Add New** → **Project**.
3. Find your `ride-weather` repository in the list and click **Import**.
4. Leave all the settings as they are and click **Deploy**.
5. After about a minute you'll get a live link like `ride-weather-yourname.vercel.app` — that's your site.

Any time you want to change something, edit the file on GitHub (or re-upload
it) and Vercel will automatically redeploy the site with your change.

## Using it

- **Paste link**: works with a full RideWithGPS URL (`ridewithgps.com/routes/12345678`) or just the number. The route must be public.
- **Upload GPX**: works with a GPX file exported from Strava, Komoot, Garmin Connect, or anywhere else — handy for private routes.
- Departure defaults to tomorrow at 9:00, average speed defaults to 24 km/h — both editable.
- **Whole route vs a section**: by default you get points across the entire route. Switch to "From km / to km" to isolate part of a longer route — useful for multi-day tours where one big file covers the whole trip but you only want today's section. The departure time you enter applies to the start of whatever section you selected (km X on that day), not the start of the whole route.
- The number of weather points scales with the length of the section you're looking at: 3 for up to 50 km, up to 8 for over 200 km.
- **Sharing**: after any search — pasted link or GPX upload — a "Copy link to share with your group →" button appears. It saves the computed forecast (not the route file itself) to a small database, so anyone who opens the link sees the exact same board instantly, no recomputation, no account needed on their end. Links last about 3 weeks, which is longer than any forecast stays accurate anyway. Requires the Upstash Redis setup above.

## Project structure

```
index.html         the page
style.css           styling
app.js              all the logic — parses the route, picks points, calls the API
api/route.js        fetches a RideWithGPS route (server-side, avoids CORS)
api/weather.js       fetches yr.no forecasts for each point
api/placename.js     looks up a place name for each point (OpenStreetMap)
api/share.js         stores/retrieves shared forecasts (Upstash Redis)
LICENSE             MIT license
```

## Limits worth knowing

- Private RideWithGPS routes can't be read this way — use the GPX upload for those.
- Weather forecasts only extend about 9 days out; departures further ahead won't have data yet.
- yr.no and OpenStreetMap are free public services — be reasonable with how often you hit "Get forecast."
- Place names come from OpenStreetMap and aren't always perfectly precise in very rural areas — you'll sometimes get the nearest village rather than the exact spot.
