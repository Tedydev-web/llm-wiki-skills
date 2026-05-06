/**
 * index.ts — API router aggregator
 *
 * Mounts all route groups under /api prefix.
 * Receives runtime dependencies (redis, auth, mcpTokenDb) from server.ts.
 */

import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { AuthContextEnv } from './middleware/auth.js';
import { buildMeRouter } from './routes/me.js';
import { buildWorkspacesRouter } from './routes/workspaces.js';
import { buildMembersRouter } from './routes/members.js';
import { buildMaterialsRouter } from './routes/materials.js';
import { buildNotesRouter } from './routes/notes.js';
import { buildTokensRouter } from './routes/tokens.js';
import { buildHealthRouter } from './routes/health.js';
import { openapiSpec } from './openapi.js';

export function buildApiRouter(redis: Redis, redisUrl: string): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // Health (no /api prefix — top-level)
  app.route('/', buildHealthRouter());

  // OpenAPI spec + Swagger UI
  app.get('/openapi.json', (c) => c.json(openapiSpec));
  app.get('/docs', (c) =>
    c.html(`<!DOCTYPE html>
<html>
<head>
  <title>wiki-team API</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset] });
</script>
</body>
</html>`),
  );

  // API routes (all under /api)
  app.route('/api', buildMeRouter());
  app.route('/api', buildWorkspacesRouter());
  app.route('/api', buildMembersRouter());
  app.route('/api', buildMaterialsRouter(redisUrl));
  app.route('/api', buildNotesRouter());
  app.route('/api', buildTokensRouter(redis));

  return app;
}
