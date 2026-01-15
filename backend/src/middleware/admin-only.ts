import { Request, Response, NextFunction } from 'express';
import { getUserPathsService } from '../services/user-paths.js';

export function isProductionMode(): boolean {
  return process.env.NODE_ENV === 'production' || 
         process.env.BOB_MODE === 'server' ||
         process.env.REQUIRE_AUTH === 'true';
}

export function adminOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isProductionMode()) {
    const isAdmin = req.apiKey?.scopes?.includes('admin') || 
                   req.headers['x-admin-key'] === process.env.BOB_ADMIN_KEY;
    
    if (!isAdmin) {
      res.status(403).json({ 
        error: 'This endpoint is disabled in production mode',
        hint: 'Use BOB_MODE=desktop for local development'
      });
      return;
    }
  }
  
  next();
}

export function disableInProductionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isProductionMode()) {
    res.status(403).json({ 
      error: 'This endpoint is disabled in production mode',
      hint: 'Use BOB_MODE=desktop for local development'
    });
    return;
  }
  
  next();
}

export function restrictToUserPathsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const userPathsService = getUserPathsService();
  
  if (userPathsService.isDesktopMode()) {
    next();
    return;
  }
  
  const requestedPath = (req.query.path as string) || (req.body?.path as string);
  
  if (!requestedPath) {
    next();
    return;
  }
  
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  
  if (!userPathsService.validateUserAccess(userId, requestedPath)) {
    res.status(403).json({ 
      error: 'Access denied to this path',
      hint: 'You can only access files within your user directory'
    });
    return;
  }
  
  next();
}
