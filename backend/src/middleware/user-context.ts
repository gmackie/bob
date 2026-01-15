import { Request, Response, NextFunction } from 'express';
import { DEFAULT_USER_ID } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function getUserId(req: Request): string {
  if (req.userId) {
    return req.userId;
  }

  if (req.user && typeof req.user === 'object' && 'id' in req.user) {
    return String(req.user.id);
  }

  const headerUserId = req.headers['x-user-id'];
  if (headerUserId && typeof headerUserId === 'string') {
    return headerUserId;
  }

  return DEFAULT_USER_ID;
}

export function userContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.userId = getUserId(req);
  next();
}

export function requireUserId(req: Request, res: Response, next: NextFunction): void {
  const userId = getUserId(req);
  
  if (userId === DEFAULT_USER_ID && process.env.REQUIRE_AUTH === 'true') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  
  req.userId = userId;
  next();
}
