# Frontend Handoff Package

This folder is prepared for teammate handoff and GitHub upload.

## Included

- `frontend/` - full frontend source for development/debugging
- `frontend-api-remote-report.md` - required remote API report
- `frontend-api.md` - API contract reference

## Excluded on purpose

- `frontend/node_modules/`
- `frontend/dist/`
- `frontend/test-results/`

These are generated artifacts and should not be committed.

## Run locally

1. Open terminal in `frontend/`
2. Install dependencies:
   - `npm install`
3. Start development server:
   - `npm run dev`
4. Open:
   - `http://localhost:5173/`

## Notes

- Current `.env.local` uses `/api/v1` with Vite proxy (`vite.config.js`) targeting `https://cets.alanh.uk`.
- If teammate uses different backend, update `.env.local` accordingly.
