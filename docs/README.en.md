# Application Guide

[日本語](./README.md) | **English**

## Overview

Ink Flow Painting is an interactive suminagashi—or Japanese ink marbling—application that lets you experience ink blooming, blending, and drifting across water directly in your browser.

It does not play a prerecorded animation. Instead, the browser calculates the movement of the water and pigment in real time.

![Suminagashi demonstration](./assets/墨流し.gif)

## Modes

### Freehand

Choose black, vermilion, green, or blue ink, then release it onto the water with a mouse or touch input. You can adjust the brush size, ink density, and water-flow strength.

### Color Drift

The active color is selected at random at timed intervals and transitions smoothly into the next color. Because the colors do not switch abruptly, multiple pigments blend together naturally.

### Suminagashi

This mode automatically adds ink drops and **dispersal pulses**, which push existing pigment outward. Small variations in position and timing keep the resulting patterns from repeating exactly.

## Pointer Interaction and Water Flow

- Clicking or dragging adds both new ink and momentum to the water.
- Moving the pointer without pressing does not add ink; it changes only the water flow.
- Faster pointer movement creates a stronger current, carrying existing pigment in the direction of travel.

The flow itself is invisible on an empty area of the canvas. When pigment later reaches that area, it follows the current that was created there.

## How the Ink Blooms

Behind the canvas, the application maintains several computational maps that represent water direction and speed, pressure, pigment color, and pigment density. On every frame, the GPU performs the following steps:

1. Calculate vortices in the water.
2. Correct the pressure so that water does not accumulate unnaturally in one place.
3. Transport pigment along the flow.
4. Blend pigment gradually with neighboring areas to create blooms.
5. Reduce pigment density over time so that the ink fades.
6. Combine the result with warm paper tones and subtle grain before drawing the frame.

Pigment diffusion is designed so that a location cannot become denser than its surrounding pigment without new ink being added or transported into it. This prevents stationary areas from becoming unnaturally darker over time.

## Additional Features

- Pause and resume the simulation
- Clear the water and pigment
- Save the current artwork as a PNG image
- Use keyboard shortcuts to pause or clear the canvas

## System Requirements

The full visual effect requires a WebGL2-capable browser and GPU. A recent version of Chrome, Edge, or Firefox is recommended.

## Source Code

The complete implementation is available in [`source/`](../source/). See [`source/README.md`](../source/README.md) for the original setup notes, or return to the [English project overview](../README.en.md).
