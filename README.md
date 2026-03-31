# Shortr — URL Shortener con Analytics

Shortr es un acortador de URLs profesional, self-hosted, con panel de analytics integrado. Construido con Node.js, SQLite y Vanilla JS. No requiere base de datos externa ni servicios de terceros.

## Caracteristicas

- Acortar URLs con alias personalizado y fecha de expiracion
- Panel de analytics con grafica de clicks por dia (ultimos 30 dias)
- Autenticacion JWT (panel admin protegido)
- Rate limiting en todos los endpoints
- Hash SHA-256 de IPs para privacidad
- Tracking de referrers y user agents
- Dark theme moderno y responsive
- Docker listo para produccion
- SQLite embebido — zero dependencias externas

## Instalacion

### Opcion 1: Docker (recomendado)

```bash
# 1. Clonar el repositorio
git clone https://github.com/Quesillo27/shortr.git
cd shortr

# 2. Editar variables en docker-compose.yml
#    Cambia JWT_SECRET, ADMIN_PASSWORD y BASE_URL

# 3. Levantar
docker-compose up -d

# 4. Acceder en http://localhost:3000
```

### Opcion 2: npm (produccion)

```bash
git clone https://github.com/Quesillo27/shortr.git
cd shortr
npm install --omit=dev

# Variables de entorno requeridas:
export JWT_SECRET=tu-secreto-seguro
export ADMIN_PASSWORD=tu-password

# Opcionales:
export ADMIN_USER=admin         # default: admin
export PORT=3000                # default: 3000
export BASE_URL=https://tu.dominio.com

npm start
```

### Opcion 3: Desarrollo local

```bash
git clone https://github.com/Quesillo27/shortr.git
cd shortr
npm install

JWT_SECRET=dev-secret ADMIN_PASSWORD=admin123 npm run dev
```

## Variables de entorno

| Variable | Requerida | Default | Descripcion |
|---|---|---|---|
| `JWT_SECRET` | Si | — | Secreto para firmar tokens JWT. Debe ser largo y aleatorio. |
| `ADMIN_PASSWORD` | Si | — | Contrasena del usuario administrador. |
| `ADMIN_USER` | No | `admin` | Nombre de usuario del administrador. |
| `PORT` | No | `3000` | Puerto en el que escucha el servidor. |
| `BASE_URL` | No | `http://localhost:3000` | URL base publica para construir URLs cortas. |
| `ALLOWED_ORIGINS` | No | `*` | Origenes CORS permitidos, separados por coma. |

## Endpoints API

### Autenticacion

```bash
# Login — obtener token JWT
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"tu-password"}'
# Respuesta: { "token": "eyJ...", "expiresIn": 86400, "username": "admin" }
```

### Links

```bash
# Crear link corto
curl -X POST http://localhost:3000/api/links \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://ejemplo.com/url-larga", "alias":"mi-link"}'

# Crear con expiracion
curl -X POST http://localhost:3000/api/links \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://ejemplo.com", "expiresAt":"2025-12-31T23:59:59Z"}'

# Listar todos los links
curl http://localhost:3000/api/links \
  -H 'Authorization: Bearer <token>'

# Eliminar link
curl -X DELETE http://localhost:3000/api/links/1 \
  -H 'Authorization: Bearer <token>'
```

### Analytics

```bash
# Estadisticas globales
curl http://localhost:3000/api/analytics/summary \
  -H 'Authorization: Bearer <token>'

# Analytics de un link especifico
curl http://localhost:3000/api/analytics/mi-link \
  -H 'Authorization: Bearer <token>'
```

### Redirect

```bash
# Acceder al link corto (redirige automaticamente)
curl -L http://localhost:3000/mi-link
```

## Arquitectura

```
shortr/
├── server.js              # Entry point — Express, auth, redirect
├── backend/
│   ├── db/
│   │   └── database.js    # SQLite (better-sqlite3) — schema idempotente
│   ├── routes/
│   │   ├── links.js       # CRUD de links
│   │   └── analytics.js   # Stats globales y por link
│   └── middleware/
│       ├── auth.js        # Verificacion JWT
│       └── rateLimit.js   # Rate limiting (login, API, redirects)
└── public/
    └── index.html         # SPA completo — login + dashboard + analytics
```

### Base de datos (SQLite)

- `links` — almacena el codigo corto, URL original, fecha de creacion y expiracion
- `clicks` — registra cada click con IP hasheada, user agent y referrer

La DB se almacena en `/data/shortr.db` (Docker) o `./data/shortr.db` (local).

## Seguridad

- Contrasenas nunca se almacenan — solo se comparan con `timingSafeEqual`
- IPs se hashean con SHA-256 antes de persistir (privacidad por diseno)
- Rate limiting en login (10 req/15min) y API (100 req/15min)
- Tokens JWT con expiracion de 24h
- Validacion estricta de URLs y alias en el backend

## Licencia

MIT
