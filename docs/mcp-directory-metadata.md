# Licita — MCP distribution quick-wins · ready-to-submit assets

Prepared metadata for listing **Licita** (public procurement intelligence MCP server) in the
major MCP directories. Live instance: `https://eutenders.duckdns.org/mcp`.

This file is the canonical source for every listing. After a listing is created, note it as
done (check the box) so we track which directories have he server.

---

## The single source of truth for all listings

| Field | Value |
|---|---|
| Server name | `licita` |
| Title | Public procurement intelligence for AI agents |
| Description | EU (TED) and Spanish (PLACSP) tenders, renewal signals, company opportunities and buyer activity. Pay per call with USDC via x402, or prepaid bundles. Every finding carries evidence, confidence and provenance. |
| MCP endpoint | `https://eutenders.duckdns.org/mcp` |
| Transport | `streamable-http` |
| Registration manifest | `server.json` (MCP registry v0.1.1) + `/.well-known/mcp/server-card.json` (static card) |
| Repository | `https://github.com/gastonrey/licita-app` |
| License | MIT |
| Tools (11) | `search_tenders`, `get_tender`, `get_company`, `get_company_awards`, `get_company_opportunities`, `get_buyer_history`, `get_renewals`, `get_pricing`, `research`, `billing_get_balance`, `billing_purchase_credits` |
| Categories / tags | business, data, search; procurement, tenders, eu, spain, contracts, ai, business-intelligence |
| Payment | x402 + USDC (Base); free discovery calls; prepaid credit bundles $5/$10/$25 |
| Maintainer GitHub | `gastonrey` |

---

## 1. awesome-mcp-servers — PR entry (ready to paste)

Repo: `https://github.com/punkpeye/awesome-mcp-servers` (or `appcypher/awesome-mcp-servers` /
`punkpeye/awesome-mcp-servers`). Add **one line** under the appropriate category (e.g.
*Data & Databases* or *Business*), matching the existing list format:

```md
- [Licita](https://eutenders.duckdns.org/mcp) - Public procurement intelligence for AI agents: EU (TED) and Spanish (PLACSP) tenders, renewal signals, company opportunities and buyer activity. Pay per call with USDC via x402 or prepaid bundles.
```

**PR title:** `Add Licita — public procurement intelligence MCP server`

**PR body:**

```md
Adds [Licita](https://github.com/gastonrey/licita-app), an agent-native public procurement
intelligence server.

- MCP (streamable-HTTP): https://eutenders.duckdns.org/mcp
- 11 tools: search_tenders, get_tender, get_company, get_company_awards,
  get_company_opportunities, get_buyer_history, get_renewals, get_pricing, research,
  billing_get_balance, billing_purchase_credits
- Data: EU (TED) award notices + Spanish (PLACSP) contracts; every finding carries
  evidence, confidence and provenance.
- Payments: x402 + USDC (Base), free discovery, prepaid bundles.
- MIT licensed. Registry manifest: server.json; static card at /.well-known/mcp/server-card.json
```

---

## 2. mcp.so — submission metadata

URL to submit: `https://mcp.so/submit` (or add via the "Publish" flow).

- **Name:** Licita
- **Server URL:** `https://eutenders.duckdns.org/mcp`
- **Description:** (use the single source of truth above)
- **Tags:** procurement, tenders, eu, spain, contracts, ai, business-intelligence
- **License:** MIT
- **Homepage/GitHub:** https://github.com/gastonrey/licita-app

---

## 3. Smithery — submission metadata

URL: `https://smithery.ai` → "Add server".

- **Server URL / repo:** https://github.com/gastonrey/licita-app (Smithery can pull from the
  repo; ensure `server.json` + README are discoverable at the root, which they are).
- **Runtime connection:** use the **remote streamable-http** URL
  `https://eutenders.duckdns.org/mcp`.
- **Description:** use the single source of truth.

---

## 4. Glama — submission metadata

The `glama.json` at the repo root is now populated (this is the Glama `server.json` schema
addendum). For the Glama badge/card, point Glama at either:
- the GitHub repo `https://github.com/gastonrey/licita-app`, or
- the live server URL `https://eutenders.duckdns.org/mcp`.

Glama crawls `server.json` and `glama.json` from the repo. Keep both in sync.

---

## Status

- [ ] mcp.so — submitted
- [ ] Smithery — submitted
- [ ] Glama — submitted
- [ ] awesome-mcp-servers — PR opened/merged
