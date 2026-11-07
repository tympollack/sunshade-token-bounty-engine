import dotenv from 'dotenv';
import { createApp } from './api/app';

dotenv.config();

// Export All Core Types
export * from './types';

// Export Constants
export * from './core/constants';

// Export Pure Domain Engines
export * from './core/pricingEngine';
export * from './core/capacityGovernor';
export * from './core/proofValidator';
export * from './core/exchangeService';

// Export Database & Gateway
export * from './db/supabaseClient';
export * from './db/ledgerGateway';

// Export API App Factory & Client SDK
export * from './api/app';
export * from './client/bountyEngineClient';

// Server bootstrap when run directly
if (require.main === module) {
  const port = process.env.PORT || 4000;
  const app = createApp();

  app.listen(port, () => {
    console.log(`[SunShade Token Bounty Engine] Server listening on port ${port}`);
  });
}
