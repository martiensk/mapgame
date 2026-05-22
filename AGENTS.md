# AGENTS.md

This file defines the authoritative requirements for coding agents working on this repository.

## Product Goal

Build a browser-based 4X/grand-strategy map foundation (CK/EU style) in HTML5.

V1 focuses on map generation, camera navigation, and region interaction. Do not scope creep into full diplomacy/economy/combat systems yet.

## Rendering And Interaction Stack

- Primary renderer: PixiJS.
- Optional use of D3: geometry utilities only (for Voronoi, triangulation, or polygon helpers), not as the primary renderer.
- County polygons must be individually mouse-interactable.

Rationale: PixiJS gives better performance for large interactive maps than full SVG at the target county scale.

## Core V1 Requirements

1. The map must support smooth panning.
2. The map must support smooth zooming in and out.
3. The world must be procedurally generated from a seed.
4. Generation must include both continents and islands.
5. All land must be partitioned into counties.
6. All ocean must be partitioned into sea-zones.
7. Each county must be clickable and hoverable with the mouse.

## Deterministic Generation

- All procedural generation must be deterministic from a single world seed.
- Given the same seed and generation config, county and sea-zone layout must be reproducible.
- Every county and sea-zone must have a stable ID in the generated output.

## World Generation Pipeline (V1)

Implement generation in this order:

1. Create base noise/tectonic field for world mask.
2. Derive land and ocean masks.
3. Detect connected land-masses (continents and islands).
4. Assign target county count per land-mass based on area.
5. Subdivide each land-mass into county polygons.
6. Subdivide ocean into sea-zone polygons.
7. Build adjacency graph (county-county, county-sea-zone, sea-zone-sea-zone).

## County Partitioning Rules

- County count must scale with land-mass size.
- Tiny islands may have one county.
- Large continents must have many counties.
- County shapes should be contiguous polygons with no self-intersections.
- County boundaries should avoid tiny sliver regions where possible.

Use a configurable target density (counties per land area unit) so map scale can be tuned without rewriting the algorithm.

## Sea-Zone Rules

- All ocean tiles/areas must belong to exactly one sea-zone.
- Sea-zones should be contiguous polygons.
- Coastline-adjacent sea-zones must be discoverable from neighboring counties.
- Sea-zones must also have stable IDs and adjacency links.

## Camera Requirements

- Pan: click-drag (or middle-mouse drag) to move camera.
- Zoom: mouse wheel and trackpad pinch where available.
- Enforce min and max zoom levels.
- Zoom should anchor near cursor position where practical.
- Clamp camera to world bounds to prevent losing the map.

## County Interaction Requirements

Each county must support:

- Hover highlight.
- Selection on click.
- A data payload available to UI (id, name placeholder, area, neighbors, land-mass id).

Interaction response must feel immediate at target scale.

## Data Model Requirements

At minimum define structures for:

- World metadata (seed, dimensions, generation parameters).
- County (id, polygon, centroid, area, neighbors, landMassId).
- Sea-zone (id, polygon, area, neighbors, coastalCountyIds).
- Land-mass (id, type=continent|island, area, countyIds).

Use plain serializable data structures so generated worlds can be saved/loaded as JSON.

## Suggested Project Module Boundaries

- `src/generation/random.ts` seedable RNG utilities.
- `src/generation/world.ts` high-level generation pipeline.
- `src/generation/landmass.ts` connected-component and land-mass analysis.
- `src/generation/counties.ts` county partitioning.
- `src/generation/seazones.ts` sea-zone partitioning.
- `src/geometry/*` polygon, adjacency, and spatial helper utilities.
- `src/render/pixiMap.ts` PixiJS scene, layers, and draw pipeline.
- `src/input/cameraController.ts` pan/zoom logic.
- `src/input/regionInteraction.ts` hover/select hit handling.
- `src/state/worldState.ts` authoritative in-memory game map state.

Agents may adjust file names, but must preserve this separation of concerns.

## Performance Targets (V1)

Target profile (desktop browser):

- 600 to 2,000 counties.
- Initial generation under 2.5 seconds at default settings.
- Camera pan/zoom interaction should remain smooth (target 50+ FPS on typical dev hardware).
- Hover/click region detection should feel immediate (target under 30 ms response).

## Milestones

1. M1: Pixi scene boot + pan/zoom camera + placeholder generated shapes.
2. M2: Seeded continent/island generation + county and sea-zone subdivision.
3. M3: County hover/select interaction + region metadata overlays.
4. M4: Adjacency graph validation + serialization/export of world JSON.

## Acceptance Criteria

V1 is complete when all of the following are true:

1. Running with a seed generates a world with visible continents and islands.
2. Land is partitioned into counties and ocean into sea-zones.
3. Camera supports pan and zoom with sensible bounds.
4. Counties can be hovered and clicked reliably with visual feedback.
5. Regenerating with the same seed reproduces the same topology.

## Non-Goals For V1

- No diplomacy, warfare, economy, or character simulation.
- No multiplayer/network sync.
- No final art pipeline.
- No advanced UI polish beyond basic debug overlays.

## Agent Execution Notes

- Prefer incremental commits by milestone.
- Add lightweight debug visualizations for land-masses, county IDs, and sea-zone IDs.
- Write focused tests for deterministic generation and adjacency correctness.
- If performance drops below target, profile before refactoring.
