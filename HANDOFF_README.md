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

- Current `.env.local` should use the full remote API base: `VITE_API_BASE_URL=https://cets.alanh.uk/api/v1`.
- If teammate uses a different backend, update `VITE_API_BASE_URL` accordingly. The frontend no longer uses a Vite `/api` proxy.
