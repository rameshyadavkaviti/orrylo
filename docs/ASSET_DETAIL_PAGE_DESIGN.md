# Approved Asset Detail Page — Orbital Noir v1.0

**Decision:** Owner-approved visual and product-experience direction, 2026-10-12. **Implementation:** Not approved by this document. **Priority:** Deferred relative to the first genuine customer token issuance in Testnet MVP Lite (see draft PR #42).  
**Primary reference:** The owner-supplied Asset Detail Page concept image in the 2026-10-12 Product Architect conversation. This repository documentation does **not** embed the image; implementation handoffs must supply the original approved image, not reconstruct its exact pixels from prose.

## 1. Context and hierarchy

This screen is a **project-owned asset detail and management page**, not a detached token factory. The asset identity is the visual focal point: project / asset name and code, optional approved orbital artwork, network and status chips, and concise actions. The experience reinforces creative ownership and the longer **Create → Publish → Manage → Grow** lifecycle.

Use **Orbital Noir v1.0** proposed in draft PR #29 (not yet merged at the time of this document): near-black/navy canvas; layered indigo glass-like panels; restrained electric blue, ultraviolet, and occasional cyan; consistent left navigation and top utilities on desktop, with responsive alternatives; legible hierarchy and intentional spacing. Reuse actual approved logo assets, not generated stand-ins. If PR #29 changes, reconcile this document before styling work; this document does not preempt its design-system approval.

The reference's planet/orbital centerpiece, glow, navigation, project title/status chips, card layout, timeline, progress tracker and network-status footer are visual **concepts**, not requirements to invent corresponding data. Avoid excessive glow; preserve accessible contrast, keyboard navigation, focus states, reduced-motion behavior, small screens, error/loading/empty states and long Stellar addresses.

## 2. Required information architecture

| Section | Intended content | MVP Lite truthful minimum | Future / conditional scope |
| --- | --- | --- | --- |
| Asset identity and project presentation | Project name, asset code, description, network, design imagery, profile link | Actual project data and canonical asset code; distinguish draft from issued | Rich branding, public profile and shareable pages only once actually published |
| Stellar network, issuer and authorization | Exact issuer address, issuer type, network, trustline/authorization explanation and explorer URL | Show verified network, selected issuer and **Shared Issuer is Orrylo-controlled** when known; label unverified state | Dedicated Issuer controls, advanced authority management |
| Supply and distribution | Selected initial supply, truly issued quantity, optional maximum / remaining figures | Show reviewed requested amount separately from ledger-confirmed issued amount; no assumed fixed cap or remaining supply | Verified holder distribution and supply charts where sound ledger indexing and policy exist |
| Metadata and discoverability | TOML, logo, links, publication state and explorer discoverability | Project-stored vs published vs on-chain discoverable states explicitly differentiated | Editing/publishing workflow and availability/status badges backed by evidence |
| Activity and recent events | Issuance attempt/result and verified events | Real audited request/submission/confirmed/failure timestamps; no fabricated holder or market activity | Indexed activity trends, user/asset analytics and enriched timeline |
| Progress and next steps | Configuration, issuing, publishing, sharing stages | Show genuine next actionable stage and independently verified completed stages | Complete Create → Publish → Manage → Grow tracker |
| Network information and explorer links | Testnet badge, asset explorer, transaction links, sync information | Clearly visible correct **Stellar Testnet**, transaction hash and explorer deep link only when verified | Live ledger height, latency, network health only if sourced and monitored |
| Editing and sharing actions | Manage metadata, navigate project, share verified asset page | Editing only for implemented, authorized operations; share only a real accessible URL | Advanced metadata editing, analytics, governance, ownership transfer |

## 3. Data/state truth and semantic conflicts

1. The supplied screenshot uses example project **My Stellar Project (MSP)**, issuer abbreviation, holder count **124**, issuance metrics **1,000,000 / 500,000**, events, charts, network ledger/close time, published badges and metadata. These are illustrative **mock values**, not known chain or application facts. Never seed or ship as live values.
2. **Requested initial supply is not maximum lifetime supply.** Shared Issuer does not confer user-exclusive fixed supply or owner-managed mint authority. Do not show a **Total Supply / Remaining Supply** cap or 50%-issued visualization unless an explicit approved policy and independently validated definitions support it; alternatives: `Initial amount requested`, `Confirmed amount issued`, or `Not available`.
3. `On-chain Confirmed` is allowed only after an independently verified correct ledger outcome, not draft save, wallet approval, local signed envelope, submission, or merely a hash. `Published`, `Metadata Published` and `Discoverable` are separate claims with their own proof. No explorer link before real known target identity/hash.
4. Issuer address must be full and copyable; visual truncation is allowed with an accessible full-value reveal. Shared Issuer remains explicitly operated by Orrylo; do not imply a customer's possession of issuer keys. Dedicated Issuer info appears only for actual supported assets.
5. Authorization flags and trustline status are distinct: do not infer active issuer authorization from a screenshot's `Trustlines enabled` label. Show accurate Stellar facts and clearly mark awaiting trustline, unauthorized, pending, failed and confirmed conditions.
6. User-visible activity belongs to the current authorized project. Do not expose private project details through publicly shared pages. Do not leak secret keys; `Wallet & Keys` in screenshot is navigation inspiration only, not authorization for an issuer key management screen.
7. Always identify network (Testnet vs Mainnet), project/app-managed data vs verified chain data, unavailable future capabilities vs actual actions. Failed/ambiguous issuance stays pending investigation until authoritative reconciliation; never optimistically claim success.

## 4. Bounded implementation staging and ownership

**Stage A — No implementation now.** Product Architect records this owner-approved concept and obtains design review. Existing PR #29 remains the Orbital Noir visual-spec source; PR #42 remains the urgent scope correction. Do not block MVP Lite on this page or on illustrative dashboard metrics.

**Stage B — UI/UX Design Engineer (after a separate start authorization):** Prepare a responsive asset-detail visual specification and component inventory against current application routes/styles, using the **original owner image**. Define layout across desktop/tablet/mobile, states (draft, intent saved, submitted, confirmed, ambiguous, failed, unpublished), accessibility, no-data placeholders, design tokens and an explicit mapping from displayed field to authoritative source. Deliver design assets/spec on an isolated draft PR only, not functional app changes.

**Stage C — Full-stack Product Engineer (after separate implementation authorization and verified Lite backend state):** Implement a minimal read-only asset detail page using approved layout primitives and existing project/issuance records. Expose only backed fields with network-aware explorer links; honest unavailable placeholders; restricted editing/sharing when functionality actually exists. Do not build mock charts, holder-count services, wallet key tools, signer integrations or additional issuer permissions. Independent Security/Enablement review of ownership, data provenance, status mapping, links and privacy before merge.

**Stage D — Future product iterations:** Metadata edit/publish, authenticated management, public sharing, asset activity indexing/holder analytics, advanced supply metrics, live network health and premium features, each separately approved based on real infrastructure.

## 5. Conflicts and dependencies requiring review

- **Draft PR #29 vs this specification:** #29 is the pending Orbital Noir base; this page refines a distinct screen without rewriting global tokens. Resolve branch/merge order before implementation; do not treat unmerged PR #29 as current main.
- **Draft PR #40 (project-first positioning):** complementary premium founder experience; it does not authorize fabricated progress or user-specific financial claims.
- **Draft PR #42 (Testnet MVP Lite):** first genuine customer Testnet issuance remains P0. This visual concept must not become an issuance-deployment gate.
- **Merged PR #39:** browser-only initial-supply preview does not yet persist an issuance request. Supply/status cards must never imply it does.
- **Open PR #32:** unresolved ledger-evidence and retry findings block confident `Confirmed` status until independently remediated.
- Account/trustline controls, metadata publication mechanism, availability of authoritative analytics and precise edit permissions still require separate verified interfaces/decisions.

## 6. Review/acceptance for design specification

- Matches original owner-provided image's hierarchy and premium orbital look while staying within approved Orbital Noir rules.
- Each rendered value and badge has an explicit data source and lifecycle predicate.
- `Issued`, `Saved`, `On-chain confirmed`, `Published`, and `Discoverable` cannot be conflated.
- Asset identity and issuer separation are accurate; no Shared Issuer supply cap is invented.
- No signing, account changes, RYLO economics modifications, premature MVP work, or production UI implementation is authorized here.
