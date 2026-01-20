import type { Router } from 'express';
import express from 'express';
import swaggerUiDist from 'swagger-ui-dist';
import { getOpenApiDocument } from '../../openapi/index.js';

const swaggerUiAssetPath = swaggerUiDist.getAbsoluteFSPath();

const docsHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MemAlerts API Docs</title>
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script src="/docs/swagger-ui-standalone-preset.js"></script>
    <script src="/docs/docs-ui.js"></script>
  </body>
</html>`;

const docsUiScript = `window.ui = SwaggerUIBundle({
  url: '/docs/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  displayRequestDuration: true,
  persistAuthorization: true,
  withCredentials: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'StandaloneLayout',
  requestInterceptor: function (req) {
    req.credentials = 'include';
    return req;
  }
});`;

export function registerDocsRoutes(app: Router) {
  app.get('/docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(docsHtml);
  });

  app.get('/docs/docs-ui.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(docsUiScript);
  });

  app.get('/docs/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(getOpenApiDocument());
  });

  app.use('/docs', express.static(swaggerUiAssetPath, { index: false }));
}
