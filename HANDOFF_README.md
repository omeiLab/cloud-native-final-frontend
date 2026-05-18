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
- Current `.env.local` should set the realtime endpoint explicitly: `VITE_WS_BASE_URL=wss://cets.alanh.uk/ws`.
- If teammate uses a different backend, update `VITE_API_BASE_URL` accordingly. The frontend no longer uses a Vite `/api` proxy.

## Frontend CD

- GitHub Actions workflow: `.github/workflows/frontend-deploy.yml`.
- Deployment target: GitHub Pages.
- Triggers: push to `main` or `master` when `frontend/**` changes, plus manual `workflow_dispatch`.
- Repository variables:
  - `VITE_BASE_PATH` defaults to `/<repo>/` for GitHub Pages project sites. Set it to `/` when using a custom domain or root Pages site.
  - `VITE_API_BASE_URL` defaults to `https://cets.alanh.uk/api/v1` if unset.
  - `VITE_WS_BASE_URL` is optional; set it to `wss://cets.alanh.uk/ws` to match `.env.local`.
