import express, { Express } from 'express';
import cors from 'cors';
import { apiKeyAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { LedgerGateway } from '../db/ledgerGateway';
import { createMintRouter } from './routes/mint';
import { createBountiesRouter } from './routes/bounties';
import { createExchangeRouter } from './routes/exchange';
import { createWalletsRouter } from './routes/wallets';
import { createEscrowRouter } from './routes/escrow';
import { createHealthRouter } from './routes/health';

export interface CreateAppOptions {
  gateway?: LedgerGateway;
  skipAuth?: boolean;
}

export function createApp(options?: CreateAppOptions): Express {
  const app = express();
  const gateway = options?.gateway || new LedgerGateway();

  app.use(cors());
  app.use(express.json());

  // Health route is mounted first (public, no auth)
  app.use('/api/v1', createHealthRouter());

  // Authentication guard
  if (!options?.skipAuth) {
    app.use(apiKeyAuth);
  }

  // Mounted API routes
  app.use('/api/v1/mint', createMintRouter(gateway));
  app.use('/api/v1/bounties', createBountiesRouter());
  app.use('/api/v1/exchange', createExchangeRouter(gateway));
  app.use('/api/v1/wallets', createWalletsRouter(gateway));
  app.use('/api/v1/escrow', createEscrowRouter(gateway));

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
