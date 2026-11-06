# Agent Note: Device simulation needs a state producer, not supplied directive fixtures

Status: implemented

## Problem

V20 modules exist but fifteen have no production consumer. The old vertical test calls collection without asserting a device block, then asserts a string in its own fixture. The production collector reads an upstream `deviceDirectives` field with no producer. Passing kernel tests therefore does not establish delivery. Bridge events also share the global configuration bucket and can cross chat boundaries.

## Decision

`config/device-runtime.js` owns a versioned, opt-in chat-scoped simulation state. Settings dispatch validates explicit actions into existing kernels. The collector reads this local state, independent of a LonSha snapshot; both the host hook and WeChat use the same collector. Prompt collection is read-only. Offline NPC advancement runs at the existing generation-start hook; review explicitly drains its local queue. The settings section captures a session token and refuses stale callbacks, including after confirmation dialogs.

The simulation is not encryption, a real terminal, hardware telemetry, or physical secure erase. The UI says so. A confirmed wipe removes only the simulator's sensitive modules and prevents their resurrection until explicit reset. It does not erase real chat or album storage. Dark-domain dossier contents and authentication credentials never enter bridge events or public prompts.

Bridge event queues use `device_holographic_events_v1` in chatMetadata, not global `lonsha_bridge_v1`. Old global events lack a reliable chat identity and are not imported. Existing global bridge configuration remains unchanged. Cross-project delivery is not established by a persisted queue; the absent LonSha receiver remains an open acceptance gap.

## Existing-note audit

The proposed architecture v11 note documents the same historical zero-consumption failure class but does not define this runtime. It remains a separate, partially overlapping process proposal; no old decision is superseded. Earlier product completion claims are not evidence for runtime acceptance.

## Alternatives considered

- Merely import all kernels into the arbitrator: minimal diff, but produces no state or user operation and repeats the original false completion.
- Keep accepting upstream prebuilt directive strings: preserves the prior shape, but no producer exists and device state belongs to the phone, not the upstream memory snapshot.
- Automatically infer damage, secrets or voice spoofing from prose: immersive but fabricates facts and cannot establish consent or provenance. Explicit simulation operations remain the source.

## Testing

Production collection/hook tests cover fourteen kernel families, elapsed NPC evolution, JSON hydration, chat switching, refused writes, bad inputs, confirmed wipe boundaries and bounded logs: 22 passing tests. Related historical suites: 43 passing tests. Keys, imports, syntax, dead exports and session-writeback gates pass individually. The notification ordering export now reaches the existing away-review UI via a callback instead of creating a circular import.

A Chromium fixture exercised actual settings controls at 320/390/768/1280 widths: UI action through state to production collector, stale-session refusal, no page errors or horizontal overflow. This is a browser fixture, not a live SillyTavern acceptance test. Full repository checks and LonSha's full V20 producer/consumer closure remain unverified.

## Consequences

State survives JSON serialization and remains isolated without caching an old chat. The action table is shared by UI and dispatch, but the JSON editor is an advanced interface rather than a polished per-feature UI. Logs are bounded; priority arbitration can omit lower-priority facts and enforces character rather than token budgets. The repair does not justify claiming all 36 planned capabilities complete.
