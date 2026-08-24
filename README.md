# Ride / Weather

Paste a RideWithGPS route (or upload a GPX file), say when you're leaving and
how fast you ride, and get the weather forecast at points spaced out along
your route — not just at your front door.

## Before you deploy — one required edit

yr.no (the weather service) requires every app to identify itself with a
real contact email, or it blocks the requests. Open `api/weather.js`, find
this line near the top, and replace it with your own info:

```js
const USER_AGENT = 'ride-weather-app/1.0 github.com/YOUR-USERNAME (YOUR-EMAIL@example.com)';
```

That's the only thing you need to change. Everything else works as-is.

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
- The number of weather points scales with distance: 3 for routes up to 50 km, up to 8 for rides over 200 km.

## Project structure

```
index.html      the page
style.css       styling
app.js          all the logic — parses the route, picks points, calls the API
api/route.js    fetches a RideWithGPS route (server-side, avoids CORS)
api/weather.js  fetches yr.no forecasts for each point
```

## Limits worth knowing

- Private RideWithGPS routes can't be read this way — use the GPX upload for those.
- Weather forecasts only extend about 9 days out; departures further ahead won't have data yet.
- yr.no is a free public service — be reasonable with how often you hit "Get forecast."
