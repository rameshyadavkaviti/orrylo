# Orrylo UI-01 — Orbital Noir foundations

Status: isolated implementation proposal; not a production theme activation.

## Authority and boundaries

The Orbital Noir v1.0 palette and visual direction are recorded in PR #29's proposed addition to `docs/SOURCE_OF_TRUTH.md`. Until that change is merged, it is a reviewed design proposal rather than current-main canonical text. Existing canonical wallet-first policy governs the interactive builder. Do not change wallet authentication or any issuer, reward, payment, or ledger behavior in UI-01.

## Foundation token contract

The additive CSS file `web/styles/orbital-noir.tokens.css` defines namespaced `--on-*` custom properties. They are deliberately not imported by the root layout and do not override existing global CSS.

Token layers:
- primitives: approved reference palette;
- semantics: canvas, surfaces, borders, text, focus, accent;
- layout: 4px spacing scale and rounded panel primitives;
- motion: restrained transitions and reduced-motion overrides.

## UI-01 acceptance criteria

1. Exact reference palette values match PR #29.
2. Namespaced variables avoid collisions with the existing light-theme globals.
3. No change to runtime page rendering, routes, wallet flow, financial or on-chain operations.
4. Typography, spacing, focus and motion tokens support accessible future components.
5. Future activation must be a separate reviewed PR, after contrast tests and responsive checks.
6. No mockup values, fake balances, or invented issuer state enter production UI.

## Handoff to Full-stack

The current homepage advertises anonymous interactive building, while canonical product policy requires Albedo authentication from the start of that flow. Full-stack owns reconciling behavior and copy in a separate branch. UI-01 neither resolves nor masks this conflict.

The reference image named in PR #29 has no verified repository asset path. Do not substitute a generated image or claim pixel parity without the approved image handoff.
