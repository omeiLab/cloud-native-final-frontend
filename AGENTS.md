@/Users/nekomaido/.codex/RTK.md

# CETS Project State

Last scanned: 2026-05-18 Asia/Taipei

## Purpose

This repository is a handoff package for CETS, a corporate event ticketing system.
It contains a React frontend and a FastAPI backend snapshot with tests and API
contract documentation.

## Top-Level Layout

- `frontend/`: Vite + React + Ant Design application.
- `backend/`: FastAPI application source plus backend tests.
- `frontend-api.md`: API contract reference.
- `frontend-api-remote-report.md`: remote API compatibility/report notes.
- `DESIGN.md`: root design direction.
- `frontend/DESIGN_SYSTEM.md`: frontend implementation design rules.
- `HANDOFF_README.md`: teammate handoff and local frontend run notes.
- `skills-lock.json`: local skill metadata.

## Working Rules

- Use `rtk` before shell commands in this workspace.
- Prefer `rg` / `rg --files` for scanning.
- Do not revert existing user changes unless explicitly asked.
- Generated folders such as `frontend/node_modules/`, `frontend/dist/`, and test
  output should not be committed.

## Frontend Overview

- Framework: React 18, React Router v6, Vite 5.
- UI: Ant Design 5, Recharts for admin charts, ZXing + QRCode for verification.
- Main entry: `frontend/src/main.jsx`.
- App routes and role gates: `frontend/src/App.jsx`.
- API client: `frontend/src/api/client.js`.
- Auth state: `frontend/src/context/AuthContext.jsx`.
- Notification state and WebSocket handling: `frontend/src/context/NotificationContext.jsx`.
- Shared labels: `frontend/src/utils/labels.js`.
- Public media helpers: `frontend/src/assets/media.js`.

### Frontend Routes

- `/`: event list, `EventsList.jsx`.
- `/login`: login entry, `LoginPage.jsx`.
- `/auth/callback`, `/auth/oidc/callback`, `/oidc/callback`: OIDC callback.
- `/events/:eventId`: event detail and registration.
- `/me`: employee-only profile, registrations, and tickets.
- `/notifications`: authenticated notification center.
- `/admin`: `ADMIN` and `ADMIN_VIEWER` console.
- `/verify`: verifier-only QR scanner.
- `/api-explorer`: API smoke/debug page.

### Frontend API Configuration

- `VITE_API_BASE_URL` is used as-is. The frontend does not append `/api/v1`.
- Local handoff default is expected to be `https://cets.alanh.uk/api/v1`.
- `VITE_WS_BASE_URL` may be set explicitly; otherwise it is derived from the API
  host as `/ws`.
- The API client normalizes success payloads into `{ success, data }`.
- Access tokens are held in memory; refresh tokens use session/local storage
  fallback. 401 responses attempt refresh unless the request is an auth refresh
  or OIDC endpoint.

## Backend Overview

- Framework: FastAPI.
- App factory: `backend/app/main.py`.
- Runtime settings: `backend/app/config.py`.
- Mounted API prefix: `/api/v1` for HTTP APIs; WebSocket endpoint is `/ws`.
- Backend folder contains source and tests only; no dependency manifest was found
  in this handoff snapshot.

### Backend Modules

- `auth`: OIDC authorize URL/callback, refresh, logout, current user, and
  backend compatibility endpoints for dependents.
- `event`: employee event list/detail and admin event/session/ticket type CRUD.
- `registration`: create, cancel, forfeit, and list my registrations.
- `lottery`: lottery execution/replay logic and admin manual lottery path.
- `ticket`: confirm winning registration, issue ticket, QR payload, verify ticket.
- `admin`: dashboard, event registrations, site employee counts, sync/async
  export, cancel event, manual lottery.
- `notification`: notification list/read APIs and WebSocket delivery.
- `core`: DB/Redis lifecycle, scheduler, middleware, rate limit, security,
  audit, metrics, logging, QR signing, object storage.
- `shared`: cross-module references, enums, pagination models.

### Backend Roles And Statuses

- Roles: `EMPLOYEE`, `ADMIN`, `ADMIN_VIEWER`, `VERIFIER`, `DEPENDENT`.
- Sites: `HSINCHU`, `TAINAN`, `TAICHUNG`, `TAIPEI`, `OVERSEAS`.
- Event statuses: `DRAFT`, `PUBLISHED`, `CANCELLED`.
- Session statuses include registration, lottery, ongoing, finalized, and closed
  states.
- Registration statuses include `REGISTERED`, `IN_LOTTERY`, `WON`, `LOST`,
  `WAITLISTED`, `CONFIRMED`, `FORFEITED`, `EXPIRED`, and `USED`.
- Ticket statuses: `ISSUED`, `USED`, `REVOKED`.

## Important API Shape

- `GET /auth/me`, `POST /auth/refresh`, `POST /auth/logout`.
- `GET /auth/oidc/authorize-url`, `POST /auth/oidc/callback`.
- `GET /events`, `GET /events/{event_id}`.
- `POST /registrations`, `DELETE /registrations/{registration_id}`,
  `POST /registrations/{registration_id}/forfeit`.
- `GET /me/registrations`, `GET /me/tickets`, `GET /me/tickets/{ticket_id}/qr`.
- `POST /registrations/{registration_id}/confirm`.
- `POST /verify/ticket`.
- `GET /notifications`, `GET /notifications/unread-count`,
  `POST /notifications/{notification_id}/read`,
  `POST /notifications/mark-all-read`.
- `GET /admin/events`, `GET /admin/events/{event_id}`,
  `POST /admin/events`, `PATCH /admin/events/{event_id}`,
  `POST /admin/events/{event_id}/publish`.
- `POST /admin/events/{event_id}/sessions`,
  `POST /admin/sessions/{session_id}/ticket-types`,
  `PATCH /admin/sessions/{session_id}`.
- `POST /admin/events/{event_id}/cancel`.
- `POST /admin/sessions/{session_id}/run-lottery`.
- `GET /admin/events/{event_id}/dashboard`,
  `GET /admin/events/{event_id}/registrations`,
  `GET /admin/sites/employee-count`.
- `GET /admin/events/{event_id}/export`,
  `POST /admin/events/{event_id}/export/async`,
  `GET /admin/events/{event_id}/export/tasks/{task_id}`,
  `GET /admin/events/{event_id}/export/tasks/{task_id}/download`.

## Current Frontend Decisions

### Admin Event Create/Edit

- The admin create/edit form is in `frontend/src/pages/AdminConsolePage.jsx`.
- Adult ticket and child ticket restriction controls remain visible in the UI.
- Adult/child restriction controls are UI-only. They must not be included in
  create/update event API payloads.
- Do not show in-app explanatory text saying those fields are not sent to the
  backend unless the user asks for that copy.
- Event create/update payloads should send backend-supported fields only:
  title, description, cover image URL, allowed sites, sessions, and ticket type
  quotas.
- If an older event description still contains a hidden eligibility marker, strip
  that marker before displaying or saving the description. Do not parse it back
  into active UI state.
- Loading an existing event for edit should preserve per-session adult quota,
  child ticket toggle, and child quota.

### Employee Registration

- Employee event detail and registration are in `frontend/src/pages/EventDetail.jsx`.
- Each employee registration submit should create exactly one registration.
- Do not loop over displayed ticket count / people count to submit multiple
  registrations.
- Registration payload should remain `{ session_id, ticket_type_id }`.
- The backend `as_dependent_id` compatibility field should be omitted by the
  current frontend.
- The UI may show ticket quota/count information, but this display must not
  imply multiple backend submissions.

### Dependents Compatibility

- Backend still exposes `/me/dependents` compatibility endpoints and accepts
  `as_dependent_id` for older flows.
- Current frontend has no dependents API wrapper and should not use those
  endpoints for the registration flow.
- Adult/child handling is based on ticket type naming/audience display, not
  dependent CRUD.

## Public Assets

- Page-level background assets are centralized in `frontend/public/backgrounds/`:
  `background-light.webp` and `background-dark.webp`.
- `frontend/src/styles/App.css` references backgrounds with
  `/backgrounds/background-light.webp` and `/backgrounds/background-dark.webp`.
- `frontend/public/image/` is for event cover images, avatars, and logo assets.
- `frontend/src/assets/media.js` maps event images, avatars, and logo paths.

## Styling And Design

- Global design tokens live in `frontend/src/styles/index.css`.
- App-level background lives in `frontend/src/styles/App.css`.
- Page-specific styles live under `frontend/src/styles/*.css`.
- Current visual direction is task-focused Ant Design UI with custom TSMC/CETS
  theme details, not a landing-page style shell.
- Keep background images at the page layer only; do not place them inside cards,
  tables, forms, or modals.

## Verification Commands

Frontend:

```bash
cd frontend
npm install
npm run dev
npm run build
npm test -- --run
npm run test:e2e
```

Backend:

```bash
pytest backend/tests/unit
pytest backend/tests/integration
pytest backend/tests/e2e
```

Backend test dependency setup is not described by a manifest in this handoff
snapshot. Confirm the Python environment before running backend tests.

## Latest Verification Snapshot

- `cd frontend && npm run build` passes. The former large-chunk advisory is
  cleared after splitting Ant Design icons into a separate vendor chunk; Vite
  still prints its upstream CJS Node API deprecation notice.
- `cd frontend && npm test -- --run` passes.
- React Doctor diff scan now scores 100/100 with no remaining issues. The former
  large-component, sequential-flow, and chart chunking findings were resolved in
  the current frontend changes.
- Backend tests were scanned but not run successfully in this desktop shell:
  `pytest` is not available in the current PATH. Install/activate the backend
  Python test environment before running them.

## Current Handoff Work

The latest committed cleanup already contains the admin/event-detail behavior
changes:

- `frontend/src/pages/AdminConsolePage.jsx`: admin restriction fields stay
  UI-only, edit mode preserves session ticket quotas, and the admin page was
  split into controller/form/dashboard subcomponents for React Doctor.
- `frontend/src/pages/EventDetail.jsx`: employee registration submits exactly one
  registration request and only displays ticket quota/count information.

At the time of this scan, the remaining uncommitted local changes are expected
to include:

- `AGENTS.md`: this project state document.
- `frontend/vite.config.js`: Ant Design icons are split into their own vendor
  chunk and the chunk warning threshold is aligned to the current vendor size.
