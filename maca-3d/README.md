# MAÇA — 3D walkthrough

A procedural three.js reconstruction of the MAÇA matcha bar interior (from the VIA renders):
walnut cabinetry with lit display niches, rough stone counter, olive ceiling, arched plaster
wall with posters, glass facade and a rooftop terrace with umbrellas and bamboo planters.

- `index.html` + `scene.js` — interactive scene. Plays the walkthrough; click **Explore freely** to orbit.
  Serve the folder with any static server (`npx serve maca-3d`) and open it in a browser.
- `record.mjs` — renders the walkthrough frame by frame in headless Chromium and encodes
  `out/maca-walkthrough.mp4` with ffmpeg (`npm install`, then `node maca-3d/record.mjs`).
  `STILLS=0,7.5,24 node maca-3d/record.mjs` renders preview stills instead.
