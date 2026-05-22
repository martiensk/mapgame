# Mapgame Bootstrap

Browser-based grand strategy map foundation using React, TypeScript, Vite, and PixiJS.

This bootstrap implements M1-ready foundations:

- Seeded procedural world generation (deterministic by seed)
- County and sea-zone placeholder generation
- PixiJS rendering pipeline for region polygons
- Camera drag-pan and wheel zoom
- County hover and click interaction callbacks
- Vitest baseline with deterministic generation tests

## Scripts

- `npm run dev` starts the Vite development server.
- `npm run build` runs type-safe build output.
- `npm run typecheck` runs TypeScript project checking only.
- `npm run test` runs deterministic and smoke tests.
- `npm run test:watch` runs tests in watch mode.
- `npm run lint` runs ESLint.

## Project Structure

- `src/generation` seeded world generation pipeline and region factories
- `src/geometry` polygon and spatial helpers
- `src/render` Pixi scene setup and draw pipeline
- `src/input` camera and region interaction handling
- `src/state` in-memory world state helpers
- `src/types` serializable world contracts

## Determinism

`generateWorld(seed, config)` is deterministic:

- Same seed + same config => same generated topology signature
- Stable IDs are used for counties, sea-zones, and land-masses

## Current Scope

This is a bootstrap foundation. It intentionally does not yet implement full county/sea-zone partition correctness from `AGENTS.md`, but it provides the architecture and interaction baseline to build M2+ quickly.
