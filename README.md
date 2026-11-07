# @sunshade/token-bounty-engine

SunShade Sovereign Token Economy: 1.2M/Wk Ledger, Verifiable Proof Minting, Anti-Chore Protection & Closed-Loop Exchange API.

---

## 🏛️ System Architecture

The **Token Bounty Engine** provides the central fintech and ledger authority across the SunShade Systems ecosystem (Tracker, Hub UI, Cozy, Valerie, Makerverse, Critterverse, etc.).

- **1,200,000 Tokens / 20-Hour Week**: Calibrated to 60,000 tokens/hour (1,000 tokens/minute).
- **1-Billion Token Prestige Cap**: 20-year career ceiling with automated overflow redirection to community scholarship & bounty pools.
- **Proof-of-Artifact Verifier**: Rejects fake chores; mandates commit SHAs, PR URLs, ZKP attestations, or AI telemetry logs.
- **Closed-Loop Compliance (SEC/FinCEN)**: Zero P2P token transfers; tokens exist solely as work rebates or platform utility sinks.
- **1.25x Utility Conversion**: Instant 25% bonus when converting vested work-rebates to in-app utility credits.
- **Revenue-Gated PayPal Waterfall**: Fiat redemptions gated strictly behind realized B2B customer escrow reserves and IRS $599 1099-NEC tax compliance.

---

## 🚀 Quick Start

### Installation
```bash
npm install @sunshade/token-bounty-engine
```

### Starting the Engine Service
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

---

## 📡 REST API Endpoints

All authenticated requests require `Authorization: Bearer <ENGINE_API_KEY>` or `x-api-key: <ENGINE_API_KEY>`.

### 1. `GET /api/v1/health`
Health check and version information (public).

### 2. `GET /api/v1/bounties/quote`
Query real-time dynamic pricing for an item:
```http
GET /api/v1/bounties/quote?bounty_hours=2.0&created_at=2026-10-01T00:00:00Z
```

### 3. `POST /api/v1/bounties/claim`
Enforces the 20-hour weekly sovereign cap and optional 10h flex time-bank before a contributor claims a task:
```json
{
  "claimantUserId": "usr-123",
  "newTaskHours": 4.0,
  "existingWeeklyHours": 18.0,
  "flexBankHoursAvailable": 5.0
}
```

### 4. `POST /api/v1/mint/efficiency`
Mint verified efficiency yield with dual-stream routing:
- **Upkeep Stream**: 3,000 tokens (0.05 hrs) to the ecosystem upkeep pool.
- **Personal Bounty**: 12,000 tokens baseline (0.20 hrs) $\times$ neglect multiplier to claimant.
```json
{
  "item": {
    "id": "task-42",
    "status": "complete",
    "project_ledger_mode": "audited_production",
    "metadata": {
      "commit_sha": "a1b2c3d4e5f67890",
      "bounty_hours": 0.20
    },
    "assignee_id": "usr-123"
  }
}
```

### 5. `POST /api/v1/exchange/utility`
Convert vested work-rebates to utility tokens with 1.25x bonus:
```json
{
  "userId": "usr-123",
  "rebateTokens": 100000
}
```
*Credits 125,000 utility tokens.*

### 6. `POST /api/v1/exchange/burn`
Burn utility tokens for ecosystem services (Makerverse listing fees, Cozy decorations, etc.):
```json
{
  "userId": "usr-123",
  "amount": 25000,
  "serviceName": "makerverse_asset_mint",
  "referenceId": "asset-99"
}
```

### 7. `GET /api/v1/wallets/:userId`
Consolidated wallet balance, career prestige cap, and tax compliance status.

### 8. `POST /api/v1/escrow/waterfall`
Calculate monthly B2B revenue waterfall for PayPal cash-out requests.

---

## 💻 Client SDK Usage

Any project can initialize the `BountyEngineClient`:

```typescript
import { BountyEngineClient } from '@sunshade/token-bounty-engine';

const client = new BountyEngineClient({
  baseUrl: process.env.BOUNTY_ENGINE_URL || 'https://bounty.sunshade.icu',
  apiKey: process.env.ENGINE_API_KEY,
});

// Quote bounty
const { quote } = await client.getQuote({ bounty_hours: 1.5 });

// Check capacity
const { capacity } = await client.claimBounty({
  claimantUserId: 'user-uuid',
  newTaskHours: 2.0,
  existingWeeklyHours: 15.0,
});

// Mint verified task
const result = await client.mintEfficiencyYield({
  item: completedWorkItem,
});
```
