import type { Router } from 'express';
import { registerBetaAccessMiddleware } from './setup/betaAccessMiddleware.js';
import { registerCspReportRoute } from './setup/cspReportRoute.js';
import { registerDebugRoutes } from './setup/debugRoutes.js';
import { registerDocsRoutes } from './setup/docsRoutes.js';
import { registerHealthRoutes } from './setup/healthRoutes.js';
import { registerInternalRoutes } from './setup/internalRoutes.js';
import { registerMetricsRoutes } from './setup/metricsRoutes.js';
import { registerOverlayRoutes } from './setup/overlayRoutes.js';
import { registerRouterMounts } from './setup/routerMounts.js';

export function setupRoutes(app: Router) {
  registerHealthRoutes(app);
  registerMetricsRoutes(app);
  registerDocsRoutes(app);
  registerCspReportRoute(app);
  registerOverlayRoutes(app);
  registerInternalRoutes(app);
  registerDebugRoutes(app);
  registerBetaAccessMiddleware(app);
  registerRouterMounts(app);
}
