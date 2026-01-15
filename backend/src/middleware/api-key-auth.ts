import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../services/api-keys.js';

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        userId: string;
        scopes: string[];
      };
    }
  }
}

export function createApiKeyMiddleware(apiKeyService: ApiKeyService) {
  return async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const rawKey = authHeader.substring(7);
    
    if (!rawKey.startsWith('bob_')) {
      next();
      return;
    }

    const startTime = Date.now();

    try {
      const apiKey = await apiKeyService.validateKey(rawKey);
      
      if (!apiKey) {
        res.status(401).json({ error: 'Invalid or expired API key' });
        return;
      }

      const rateLimit = await apiKeyService.checkRateLimit(apiKey.id);
      
      res.setHeader('X-RateLimit-Limit', apiKey.rateLimitRequests.toString());
      res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
      res.setHeader('X-RateLimit-Reset', rateLimit.resetAt.toISOString());

      if (!rateLimit.allowed) {
        res.status(429).json({ 
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000)
        });
        return;
      }

      req.apiKey = {
        id: apiKey.id,
        userId: apiKey.userId,
        scopes: apiKey.scopes
      };
      
      req.userId = apiKey.userId;

      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        apiKeyService.logUsage(
          apiKey.id,
          req.path,
          req.method,
          res.statusCode,
          req.ip,
          req.headers['user-agent'],
          responseTime
        ).catch(err => console.error('Failed to log API key usage:', err));
      });

      next();
    } catch (error) {
      console.error('API key validation error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}

export function requireScope(scope: string) {
  return function(req: Request, res: Response, next: NextFunction): void {
    if (!req.apiKey) {
      next();
      return;
    }

    if (!req.apiKey.scopes.includes(scope) && !req.apiKey.scopes.includes('admin')) {
      res.status(403).json({ error: `Insufficient permissions. Required scope: ${scope}` });
      return;
    }

    next();
  };
}
