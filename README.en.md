# Ink Flow Painting

## Live Demo

**[Open the artwork on GitHub Pages](https://tsurumakishunta.github.io/Inkflowpainting/)**

The GitHub Pages edition is rebuilt and deployed automatically whenever the `main` branch is updated. On smartphones, the adjustment panel starts collapsed to preserve canvas space, while Pause, Clear, and Save remain visible at the top.

[日本語](./README.md) | **English**

Ink Flow Painting is an interactive web application that recreates ink blooming, blending, drifting across water, and gradually fading as it disperses.

![Suminagashi demonstration](./docs/assets/墨流し.gif)

## Features

- A freehand mode for painting with black, vermilion, green, or blue ink
- A **Color Drift** mode in which the active color changes gradually
- A **Suminagashi** mode that automatically layers ink drops and dispersal effects
- Clicking or dragging releases ink, while moving the pointer without pressing only stirs the water
- Water movement responds to both pointer direction and speed
- Natural-looking blooms and fading created through pigment diffusion and dissipation
- Adjustable brush size, ink density, water flow, and drop interval
- Pause, clear, and PNG export controls

## Using the App on a Smartphone

The app starts in **Freehand** mode. On narrow smartphone screens, the mode controls, color palette, and sliders start collapsed to leave more room for the canvas.

- Tap **調整 (Adjust)** in the lower-right corner to open the settings panel from the bottom.
- **停止 (Pause)**, **清める (Clear)**, and **保存 (Save)** remain visible at the top.
- Close the panel with **閉じる (Close)** or by tapping outside it.
- The layout adapts to portrait and landscape orientations and respects safe areas around notches and home indicators.

## Project Structure

```text
Inkflowpainting/
├─ docs/         Application guides and the demonstration GIF
├─ source/       Web application source code
├─ README.md     Japanese project overview
├─ README.en.md  English project overview
└─ LICENSE
```

See the [Application Guide](./docs/README.en.md) for a detailed explanation of the controls and simulation.

## Running Locally

Install Node.js 22.13 or later, then run:

```bash
cd source
npm install
npm run dev
```

To create a production build and run the automated tests:

```bash
npm run build
npm test
```

## Core Technologies

- React / Next.js
- TypeScript
- WebGL2
- GPU shader-based fluid and pigment simulation
- Vinext / Vite
