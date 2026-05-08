# Shortr - URL Shortener con Analytics y RBAC

Shortr es un acortador de URLs self-hosted con panel administrativo, captura de analytics enriquecidos y control de acceso por roles/permisos.

## Caracteristicas principales

- Acortamiento de URLs con alias personalizado y expiracion
- Campanas con estado, color, meta de clicks e insights
- Analytics por link/campana con desglose por pais, dispositivo, navegador y hora
- Captura de fuentes UTM (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`)
- Referrer host normalizado y conteo de visitantes unicos aproximados
- Multiusuario con RBAC (admin/editor/viewer) y permisos adicionales
- Hardening basico: headers de seguridad, rate limits por tipo de endpoint, JWT con issuer/audience
- Endpoint administrativo para limpiar datos y dejar el sistema listo para reutilizar conservando solo el admin que ejecuta la accion

## Requisitos

- Node.js 18+
- Variables de entorno configuradas (ver abajo)

## Variables de entorno

| Variable | Requerida | Default | Descripcion |
|---|---|---|---|
| `JWT_SECRET` | Si | - | Secreto para firmar JWT |
| `ADMIN_USER` | Solo bootstrap | `admin` | Usuario admin inicial si no existen usuarios |
| `ADMIN_PASSWORD` | Solo bootstrap | - | Password admin inicial (minimo 8) si no existen usuarios |
| `JWT_EXPIRES_IN` | No | `12h` | Expiracion del token |
| `JWT_ISSUER` | No | `shortr` | Issuer JWT |
| `JWT_AUDIENCE` | No | `shortr-admin` | Audience JWT |
| `PORT` | No | `3000` | Puerto de la aplicacion |
| `BASE_URL` | No | `http://localhost:3000` | URL publica base para links cortos |
| `ALLOWED_ORIGINS` | No | vacio | Lista de origenes CORS separados por coma |
| `RATE_LIMIT_API_MAX` | No | `180` | Max requests API por ventana |
| `RATE_LIMIT_LOGIN_MAX` | No | `12` | Max intentos login por ventana |
| `RATE_LIMIT_REDIRECT_MAX` | No | `200` | Max redirects por minuto |
| `RATE_LIMIT_USERS_MAX` | No | `60` | Max operaciones usuarios por ventana |
| `RATE_LIMIT_ANALYTICS_MAX` | No | `120` | Max consultas analytics por ventana |

## Roles y permisos

### Roles base

- `admin`: control total
- `editor`: gestion de campanas/links + lectura analytics
- `viewer`: solo lectura de dashboard/campanas/links/analytics

### Permisos (granulares)

- `dashboard:view`
- `campaigns:read`, `campaigns:write`, `campaigns:delete`
- `links:read`, `links:write`, `links:toggle`, `links:delete`
- `analytics:read`
- `users:read`, `users:write`, `users:delete`, `users:permissions`

## Endpoints principales

### Auth

- `POST /api/auth/login`

### Links

- `POST /api/links`
- `GET /api/links`
- `PATCH /api/links/:id/toggle`
- `DELETE /api/links/:id`

### Campanas

- `GET /api/campaigns`
- `POST /api/campaigns`
- `PATCH /api/campaigns/:id`
- `DELETE /api/campaigns/:id`

### Analytics

- `GET /api/analytics/summary`
- `GET /api/analytics/:code`
- `GET /api/analytics/campaign/:id?period=7|30|90|all`

### Usuarios y permisos

- `GET /api/users/meta`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `PATCH /api/users/:id/password`
- `DELETE /api/users/:id`

### Operacion

- `GET /health`
- `POST /api/admin/reset-data` (requiere rol `admin` y body `{ "confirm": "RESET" }`)

## Desarrollo local

```bash
npm install
JWT_SECRET=dev-secret ADMIN_PASSWORD=admin123 npm run dev
```

## Docker

El `docker-compose.yml` incluye volumen persistente para SQLite y `healthcheck` sobre `/health`.

## Base de datos

- Local: `./data/shortr.db`
- Docker/produccion: `/data/shortr.db`

Tablas principales:

- `users`
- `campaigns`
- `links`
- `clicks`

Todas las migraciones aplican de forma idempotente en arranque.
