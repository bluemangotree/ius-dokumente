// Einstieg: Die OAuth-Bibliothek nimmt /mcp (nur mit gültigem Token) und ihre Endpunkte
// (/oauth/token, /oauth/register, /.well-known/…) an, alles andere geht an app().
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { app } from './app.js';
import { mcp } from './mcp.js';

// Je Adresse (Origin) ein Anbieter, weil die Ressource-URL in der Bibliothek fest ist
// und jede Instanz unter ihrer eigenen Adresse läuft.
const anbieter = new Map();

function fuer(origin) {
  if (!anbieter.has(origin)) {
    anbieter.set(origin, new OAuthProvider({
      apiRoute: '/mcp',
      apiHandler: { fetch: (request, env, ctx) => mcp(request, env, ctx.props) },
      defaultHandler: { fetch: (request, env) => app(request, env) },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['dokumente'],
      resourceMetadata: { resource: `${origin}/mcp`, resource_name: 'Dokumente' },
      accessTokenTTL: 3600,
      refreshTokenTTL: 90 * 86400,
    }));
  }
  return anbieter.get(origin);
}

export default {
  fetch(request, env, ctx) {
    return fuer(new URL(request.url).origin).fetch(request, env, ctx);
  },
};
