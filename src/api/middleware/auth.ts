import { Request, Response, NextFunction } from 'express';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow health endpoint unauthenticated
  if (req.path === '/api/v1/health') {
    return next();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const expectedKey = process.env.ENGINE_API_KEY || (isProduction ? undefined : 'sunshade-test-api-key');

  if (!expectedKey) {
    res.status(500).json({
      success: false,
      error: 'Server Misconfiguration: ENGINE_API_KEY environment variable is not configured.',
    });
    return;
  }
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === 'string') {
    token = apiKeyHeader.trim();
  }

  if (!token || token !== expectedKey) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing or invalid token bounty engine API key.',
    });
    return;
  }

  next();
}
