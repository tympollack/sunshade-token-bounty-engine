import { Router, Request, Response } from 'express';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response): void => {
    res.json({
      status: 'ok',
      service: 'sunshade-token-bounty-engine',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
