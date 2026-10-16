# Approved Public Project / Asset Page — Orbital Noir

**Owner approval:** 2026-10-12 — visual direction only.  
**Surface:** Public project page at `orrylo.com/p/<slug>`.  
**Reference:** Owner-provided NOVA Public Project Page concept image in the 2026-10-12 Product Architect conversation. The original image is the primary visual reference; it is not embedded or independently hosted by this document. Future agents must receive the original image in their handoff.  
**Implementation status:** Not authorized. **Priority:** Future design delivery, not a prerequisite to Testnet MVP Lite.

## 1. Relationship to canonical architecture and approved designs

- Preserve the invariant **Project Identity ≠ Public URL ≠ Metadata Hosting** in `docs/SOURCE_OF_TRUTH.md` §§2.1–2.2 and its `/p/<slug>` publication route in §15.2. The public page derives from the managed Project Profile; it is not a second independent system of record. A slug is not a project ID or the `stellar.toml` host.
- This approved **public storytelling/publication surface** is distinct from the **private authenticated Asset Management Dashboard** documented in proposed `docs/ASSET_DETAIL_PAGE_DESIGN.md` (draft PR #44): the private view owns editable management actions and protected data; the public view exposes only deliberately published project information and independently defensible Stellar evidence.
- Preserve Orbital Noir v1.0 from draft PR #29: premium near-black navy, electric-blue and violet with restrained cyan accents, selective glow, glass-card composition, consistent Orrylo branding, responsive typography/navigation, accessibility, and reduced-motion support. The image refines the existing approved NOVA free-template reference in Source of Truth §15.2; it does not cancel that general template or require NOVA-specific branding or copy.
- The broader product lifecycle remains **Create → Publish → Manage → Grow**. Asset creation supports the project, not vice versa. Public identity, storytelling, the creator's sense of ownership, community and social sharing drive the page's emotional hierarchy.
- Draft PR #42's **Testnet MVP Lite — first genuine customer Shared Issuer issuance** remains the immediate P0 delivery goal. No public-page work may be introduced as an issuance/deployment gate, and this approval adds no code or execution authorization.

## 2. Approved composition and UX character

The owner's concept depicts a compact global Orrylo top navigation, atmospheric deep-space/planetary header, project emblem and banner, visually prominent project title, tagline, summary and category labels, project/network/status facts, well-spaced About panel, secondary token facts and compelling purpose/vision and roadmap narrative. The right column holds project/app or community calls to action, creator identity (when publicly disclosed), useful external links and recent activity; related projects and footer provide ecosystem context.

Implement the composition responsively with semantic landmarks, logical reading/focus order, accessible contrast, text scaling, image alternatives, legible asset/account IDs, keyboard access and safe reduced-motion behavior. On mobile stack narrative before secondary actions; do not overwhelm the first screen with token-market information or depend on massive animation.

Use genuine project-specific imagery or a neutral visual fallback. The depicted NOVA emblem, celestial hero, author portrait and other asset marks are *illustrative*, not provided as reusable licensed production content by the visual approval. No assumed image or social-account ownership.

## 3. Public data and capability map

| Section | Source/predicate for any real public display | MVP Lite minimal status | Follow-on features |
| --- | --- | --- | --- |
| Navigation, identity, hero / overview | Orrylo brand + expressly published Project Profile name, description, category, artwork | Optional truthful public profile when a real published route exists; not required for first successful Testnet issuance | Rich responsive hero/template customization |
| Project and creator identities | Application-managed public profile; creator consent/permission and public data policy | Never expose wallet/session/private owner account as automatic public identity | Verified creator profile, branded contact and community links |
| Status, network, category and project stage | Explicit application publication state; correct Testnet/Mainnet; configured project category and tracked stage | Only supported actual states; `Active` cannot substitute for ledger-confirmed issuance | Lifecycle milestone/roadmap visualization based on supplied or recorded project data |
| About, purpose, characteristics and roadmap | Publicly chosen profile content, clearly project-authored statements rather than Orrylo verified endorsements | Basic description where deliberately published | Rich storytelling sections, editable roadmap and media |
| Asset details, issuer and supply | Canonical Stellar network + asset-code/issuer identity, verified ledger evidence; application-entered claims clearly labeled | Verified issuer type (Shared Issuer is **Orrylo-controlled**), asset/network and confirmed initial issued amount where available | Holder analytics, actual supply tracking and advanced governed asset properties |
| `Fixed supply`, max/current supply, minting/clawback controls | Explicit approved issuer policy and authoritative chain evidence, never inferred from a Shared Issuer label | Omit unsupported supply cap/fixed-mint claims | Accurate supply controls only for actual applicable tiers and policies |
| Quick links / wallet actions | Valid user-supplied public URLs, existing route, real asset identity, wallet/network-specific trustline capability | Correct Stellar Testnet explorer/asset link when confirmed; hide unusable wallet/add-asset actions | Add-to-wallet, app, verified social links and richer launch CTAs |
| Recent activity | Audited public project event with visibility consent, or independently verified Stellar transaction | Optional issuance/confirmed event with truthful timestamp, else no activity | Indexed public activity feed and externally sourced metadata updates |
| Share and discovery / related projects | Real published canonical public URL; public project listing policy | Enable share only if publicly accessible; avoid dead URL and fabricated discovery | Related projects carousel and recommendation/discovery service |
| Footer and platform links | Actual Orrylo public destinations | Real, navigable app links | Additional ecosystem navigation |

## 4. Explicit mockup limits and status semantics

- The concept's **NOVA** token/project, creator identity, sample supply (1,000,000 vs 500,000), `Fixed supply`, `Active` badge, project stages, events, related projects, visuals, wallet and app buttons are **not verified live data**, not implementation evidence and not compulsory seeded product examples.
- **Requested initial amount ≠ maximum lifetime supply ≠ independently confirmed issued amount.** Shared Issuer is controlled by Orrylo; do not imply per-customer immutable fixed mint cap, key custody or sole mint authority without an approved enforcement mechanism. `Decimals 7` describes classic Stellar asset amount precision, not a new customer-configurable asset property.
- Distinguish `Project saved`, `Public page published`, `Metadata/TOML published`, `Transaction submitted`, `Asset issuance confirmed on Testnet` and `Discoverable on explorer` as separate predicates. Neither a signed request nor a transaction hash proves ledger confirmation. Do not show `Verified` or `On Stellar` as a blanket attestation beyond the precise known fact.
- `Add to wallet` must not imply a trustline has been created or an asset received; actions require real supported wallet/network behavior and user consent. `Visit app` and external URLs require validated real destinations with safe external navigation.
- Public creator information, URLs and events must be intentionally published with authorization. Never disclose private dashboards, access tokens, wallet session identifiers, non-public addresses, signing material or internal audit details through `/p/<slug>`.
- Loading/unpublished/not-found/unverified/ambiguous-ledger states must use honest neutral UI, not green success badges, example charts, made-up ledger timings or automatic retries.

## 5. Bounded agent handoff and sequencing

**Current phase — documentation only (Product Architect):** Record concept approval in this isolated draft PR; do not change application code, infrastructure or active Testnet MVP Lite work. Retain screenshot as original chat reference and pass it to the future agent.

**Future UI/UX Design Engineer task — only after separately authorized:** Inspect actual current app routes and Orbital Noir tokens, PRs #29/#40/#44/#42 and canonical §15.2. Produce a responsive public project page spec/component map using the owner-provided NOVA screenshot; separate public from private states and specify data provenance, permission/visibility rules, empty/error/mobile and accessibility states. Draft design/documentation PR only, no code.

**Future Full-stack Product Engineer task — only after separate authorization and prioritization:** Implement a minimum project-driven `/p/<slug>` view from approved public Project Profile fields; resolve slug/publication lifecycle and auth boundary; render only source-backed Stellar facts with Testnet-safe explorer links; prevent private data leaks; hide unsupported CTAs/metrics. No mock static NOVA site hard-coded as customer output. Request independent Security review for route/publication auth, XSS/URL safety, issuer truth, caching/privacy and external links.

**Later product work:** Creator pages, project discovery, editable roadmap, app CTAs, community integrations, rich metadata publication, public activity feeds, related projects, social sharing and advanced analytics each require their own evidence/policy/approval.

## 6. Compatibility and open considerations

- **Canonical §15.2:** already chooses NOVA visual direction, `orrylo.com/p/<slug>` and Project Profile-backed data; this document clarifies the new detailed approved composition without changing those decisions.
- **Draft PR #29:** global Orbital Noir identity remains in review and supplies design tokens if approved; no premature merge assumption.
- **Draft PR #44:** private asset dashboard specification is a separate authenticated route/use case, not the public page.
- **Draft PR #40:** project-first positioning is consistent but still draft; no audience-based exclusion or financial promise.
- **Draft PR #42 / open PR #32 / merged PR #39:** first customer Testnet issuance remains P0; ledger proof bugs block confirmation claims and the existing selected supply is only browser-preview where unimplemented.
- **Open details:** public profile publication approval workflow, privacy controls, slug mutation/redirect rules, image hosting, exact fields, final TOML publishing, creator verification, roadmaps, activity indexes, discovery rules and safe wallet actions; these are not silently decided by a mockup.

**Design acceptance:** The original approved visual hierarchy and Orbital Noir character are preserved, every displayed real fact has a named source/predicate, no user private data leaks, public and private routes are distinct, and no extra feature becomes a precondition for the first Testnet token.
