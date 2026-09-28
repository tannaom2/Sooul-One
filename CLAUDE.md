@AGENTS.md

## Testing

The full plan and coverage map are in docs/QA.md.

- `npm test`: unit and integration tests (Vitest, `tests/**/*.test.ts`). They touch no database. Run before every change is called done.
- `npm run typecheck` and `npm run lint`: they must stay clean (lint has 8 known warnings in the admin product form).
- `npm run demo:start`, then `npm run test:qa`: the QA suite (Playwright, `tests/qa/*.spec.ts`), covering concurrency, security, UI data binding and failure modes against the **demo server and demo database only**. Global setup refuses to run unless the server on :3000 is the demo, and teardown deletes every fixture. Options: `QA_USERS=20` (racing shoppers), `QA_KEEP=1` (keep fixtures), `QA_BASE_URL`.
- `npm run test:e2e`: the checkout E2E, meant for CI's fresh database. Don't run it locally: it writes to whatever database `.env.local` points at, which is the real store.

Rules:
- Never point a test that writes at the real database (`neondb`). Write only through `demoClient` (scripts/demo/lib.ts), which refuses any database not named `*_demo`.
- New schema: diff against the demo database and apply with `npm run demo:migrate`. Pushing to main migrates Render's database (render.yaml runs `prisma migrate deploy`), so ask first.
- A new business rule gets a pure-function test. A new money path also gets a line in `tests/quote-invariants.test.ts` if it changes the total.
- UI tests assert both ways: the live value is there, and no fallback, placeholder or unbound value is (see `LEAK_PATTERN` in tests/qa/fixtures.ts).
- A failing test that reveals an application bug gets a diagnostic report ([Module], [Test ID], [Cause], [Expected vs Actual]) and approval before the application code is changed.
