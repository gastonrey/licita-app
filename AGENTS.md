# Licita Project Guidelines

## Product context

Licita is an agent-native public procurement intelligence product for professional teams. It indexes TED and, when enabled, PLACSP data to expose evidence-backed intelligence about tenders, buyers, suppliers, opportunities, and renewal signals through REST and MCP.

Primary users:

- Procurement and business-development professionals evaluating public-sector opportunities.
- AI-agent and integration developers consuming the REST/MCP surfaces.
- The operator monitoring acquisition, usage, revenue, and data quality.

The primary product outcome is helping a professional decide where to focus procurement activity next. Human-facing UX must lead with that decision value; protocol, payment, and implementation details are secondary.

## Engineering conventions

- Runtime: Node.js 20+, TypeScript, ESM, Fastify, PostgreSQL, raw SQL, and Zod validation.
- Public web surfaces live in `src/web/`; API routes live in `src/api/routes/`; payments live in `src/pay/`; migrations live in `migrations/`; tests live in `test/`.
- Preserve REST envelopes, MCP contracts, provenance, and explicit nulls. Never fabricate data.
- Validate untrusted input at the route boundary and enforce authorization server-side.
- Migrations are additive and replay-safe. Never modify production secrets or unrelated tooling files.
- Keep the public discovery surfaces stable: `/llms.txt`, `/openapi.json`, `/v1/pricing`, `/docs`, `/mcp`, the MCP server card, use-case/data routes, and `/robots.txt`.

## Commands

```bash
npm test
npm run test:integration
npm run test:api-smoke
npm run typecheck
npm run build
```

Local services:

```bash
docker compose up --build -d
docker compose logs -f app
```

## Definition of done

- The user, primary job, decision, scope, and acceptance scenarios are explicit.
- Tests are written before implementation for new behavior (strict TDD).
- `npm test`, relevant integration/smoke tests, typecheck, and build pass.
- Error, empty, loading, success, and disabled states are covered.
- Security, privacy, authorization, and data-retention implications are reviewed.
- Public API, MCP, discovery, and provenance contracts have regression coverage.
- Documentation, deployment, and rollback notes are updated when applicable.
- No UI is considered complete without browser evidence or an explicit `Needs verification` decision.

## UI/UX quality

For every UI task, load these skills before implementation:

- `frontend-design`
- `product-design`
- `web-design-guidelines`

Before coding, define:

- user and job-to-be-done;
- decision the screen supports;
- information hierarchy and progressive disclosure;
- visual direction, tokens, typography, and signature element;
- primary action and success criterion;
- default, hover, focus, active, disabled, loading, empty, error, and success states;
- responsive behavior and mobile information priorities.

Implementation requirements:

- Use semantic HTML and keyboard-accessible controls.
- Provide visible `:focus-visible` states, labels, actionable errors, and `aria-live` for async updates.
- Use explicit URL state for shareable tabs, filters, pagination, and views.
- Use `Intl.DateTimeFormat` and `Intl.NumberFormat` for dates and numbers.
- Render in a real browser at desktop and mobile sizes.
- Test the primary interaction, form success/error, empty state, loading state, and keyboard path.
- Critique the rendered result, fix the highest-impact UX/UI issues, and render again.

Never equate “the page renders” or “the tests pass” with finished UX. If a browser verifier is unavailable, report `Needs verification` and do not invent PASS.

## Security and privacy

- Never commit credentials, tokens, private keys, `.env` files, or production secrets.
- Demo leads are personal data: collect only what is necessary, document access and retention, and protect operator views.
- Public capture endpoints require input validation and rate limiting.
- Operator metrics and lead data require server-side authorization.
- Keep payment proofs, wallet addresses, and provider details out of public logs and UI unless intentionally exposed.

## Delivery

- Run the full verification commands before commit.
- For UI changes, attach browser/render evidence and accessibility findings.
- Review the exact diff and ensure migrations are included in the deploy artifact.
- Production deployment is performed through `.github/workflows/deploy.yml` after verification and approval.
- Roll back by reverting the application commit and redeploying; additive migrations must remain compatible with the previous application version.
