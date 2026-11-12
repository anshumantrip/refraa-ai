import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { sessionSecurity, authRoutes } from './auth.js';
import { companyRoutes } from './companies.js';
import { onboardingRoutes } from './onboarding.js';
import { createMailer } from './mail.js';
import { HttpError } from './http.js';
import { jobRoutes } from './jobs.js';
import { recruitingDashboardRoutes } from './recruiting-dashboard.js';

export function createApp(config, mailer = createMailer(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.proxy || false);
  app.use(helmet({
    strictTransportSecurity: config.production ? undefined : false,
    contentSecurityPolicy: { directives: {
      upgradeInsecureRequests: config.production ? [] : null,
      imgSrc: ["'self'", 'https:', 'data:'], formAction: ["'self'"]
    } },
    referrerPolicy: { policy: 'no-referrer' }
  }));
  const security = sessionSecurity(config);
  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(security.csrf);
  api.use('/organizations/:id/jobs', security.requireUser, express.json({ limit: '128kb' }), jobRoutes());
  api.use('/organizations/:id/recruiting-dashboard', security.requireUser, recruitingDashboardRoutes());
  api.use(express.json({ limit: '16kb' }));
  api.get('/health', (req, res) => res.json({ status: 'ok' }));
  api.use('/auth', authRoutes(config, mailer, security));
  api.use('/companies', security.requireUser, companyRoutes(config));
  api.use('/onboarding', security.requireUser, onboardingRoutes(config, mailer));
  api.use((req, res) => res.status(404).json({ message: 'API endpoint not found.' }));
  app.use('/api', api);

  const dist = path.resolve('dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.get('/{*route}', (req, res) => res.sendFile(path.join(dist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message, code: error.code });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Request body is too large.' });
    console.error('Unhandled request error:', error.name, error.code || '');
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  });
  return app;
}
