import { Router, Request, Response } from 'express';
import { LedgerGateway } from '../../db/ledgerGateway';

export function createWalletsRouter(gateway: LedgerGateway): Router {
  const router = Router();

  // Retrieve user consolidated wallet balance & compliance rollup
  router.get('/:userId', async (req: Request, res: Response): Promise<void> => {
    const userId = req.params.userId;
    if (!userId) {
      res.status(400).json({ success: false, error: 'User ID is required.' });
      return;
    }

    const wallet = await gateway.getUserWallet(userId);
    res.json({
      success: true,
      wallet,
    });
  });

  return router;
}
