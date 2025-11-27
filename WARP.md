# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common commands

### Setup
- Install dependencies: `npm install`

### Run and develop
- Start the API in watch mode (recommended for development): `npm run dev`
- Start the API without watch (production-style): `npm start`
- The HTTP server listens on `PORT` (defaults to `3000`) via `src/server.js`.

### Linting and formatting
- Lint the codebase: `npm run lint`
- Lint and auto-fix: `npm run lint:fix`
- Format with Prettier: `npm run format`
- Check formatting only: `npm run format:check`

### Tests
- Run the full Jest test suite: `npm test`
- Run a single test file: `npm test -- tests/app.test.js`
- Run tests in watch mode: `npm test -- --watch`

### Database and Drizzle ORM
- Generate Drizzle SQL migrations from the schema in `src/models/*.js`: `npm run db:generate`
- Apply pending migrations to the database configured by `DATABASE_URL`: `npm run db:migrate`
- Open Drizzle Studio for inspecting the schema and data: `npm run db:studio`
- Drizzle configuration lives in `drizzle.config.js`, and generated files go to the `drizzle/` directory.

### Docker helpers
- Development via Docker: `npm run dev:docker`
- Production via Docker: `npm run prod:docker`
- These commands delegate to shell scripts under `scripts/` (see `package.json`). Inspect or create `scripts/dev.sh` and `scripts/prod.sh` as needed before relying on them.

## Architecture overview

### Entry points and HTTP server
- `src/index.js` is the main entry point used by `npm start` and `npm run dev`. It loads environment variables via `dotenv` and then imports `src/server.js`.
- `src/server.js` imports the Express app from `src/app.js` and calls `app.listen(PORT)`, logging a simple startup message including the bound port.
- `src/app.js` constructs the Express application, wires up middleware, and mounts routes. It defines:
  - `GET /` for a simple "Hello from Acquisitions!" text response.
  - `GET /health` returning a JSON health payload with `status`, `timestamp`, and `uptime`.
  - `GET /api` returning a JSON message that the API is running.
  - A catch-all 404 handler returning `{ error: 'Route not found' }` for unknown routes.

### Module path aliases
- This project uses Node `imports` aliases configured in `package.json` to simplify imports:
  - `#src/*` → `./src/*`
  - `#config/*` → `./src/config/*`
  - `#controllers/*` → `./src/controllers/*`
  - `#middleware/*` → `./src/middleware/*`
  - `#models/*` → `./src/models/*`
  - `#routes/*` → `./src/routes/*`
  - `#services/*` → `./src/services/*`
  - `#utils/*` → `./src/utils/*`
  - `#validations/*` → `./src/validations/*`
- Prefer these aliases when importing within the codebase, including tests (for example, tests import the app via `#src/app.js`).

### HTTP routing, controllers, and services
- Routes live under `src/routes/` and are thin Express routers that delegate to controllers:
  - `src/routes/auth.routes.js` exposes authentication endpoints under `/api/auth` (e.g. `/sign-up`, `/sign-in`, `/sign-out`).
  - `src/routes/users.routes.js` exposes user management endpoints under `/api/users`.
- Controllers live under `src/controllers/` and handle request validation, logging, and mapping to service calls:
  - `src/controllers/auth.controller.js` implements `signup`, `signIn`, and `signOut` using Zod schemas, services from `src/services/auth.service.js`, JWT utilities, and cookie helpers.
  - `src/controllers/users.controller.js` implements `fetchAllUsers`, `fetchUserById`, `updateUserById`, and `deleteUserById`, performing both validation and authorization checks (for example, enforcing role-based access and preventing users from updating fields they should not control).
- Business logic and database access are encapsulated in services under `src/services/`:
  - `src/services/auth.service.js` handles password hashing and verification with `bcrypt`, user creation, and user authentication against the database.
  - `src/services/users.service.js` handles listing users, fetching a user by ID, updating a user (including email uniqueness checks and timestamp updates), and deleting users.
- This separation allows controllers to remain HTTP-focused while services encapsulate the data access and core logic.

### Data model and persistence
- The `users` table is defined with Drizzle ORM in `src/models/user.model.js` using `pgTable` and Postgres column types.
- Fields include `id`, `name`, `email` (unique), `password`, `role`, and timestamp columns `created_at` and `updated_at` (both defaulting to `now()`).
- `src/config/database.js` configures the Drizzle database client using the Neon serverless driver:
  - Uses `DATABASE_URL` from the environment.
  - In development (`NODE_ENV === 'development'`), overrides some Neon client behavior to use a local Neon endpoint.
  - Exports both the raw `sql` client and the `db` Drizzle instance used throughout services.
- `drizzle.config.js` points Drizzle Kit to the schema in `src/models/*.js` and outputs SQL migrations into the `drizzle/` directory. Generated migrations (for example `drizzle/0000_*.sql`) are applied by `npm run db:migrate`.

### Security, authentication, and authorization
- JWT handling is centralized in `src/utils/jwt.js`:
  - Exposes `jwttoken.sign` and `jwttoken.verify`.
  - Uses `JWT_SECRET` from the environment, falling back to a default string if not set (this is suitable only for non-production use).
  - Tokens default to a one-day expiration (`1d`).
- Cookie handling is centralized in `src/utils/cookies.js`:
  - Provides `set`, `clear`, and `get` helpers for HTTP-only cookies.
  - Cookie options are security-aware (for example, `httpOnly`, `sameSite: 'strict'`, and `secure` in production).
- Authentication middleware is defined in `src/middleware/auth.middleware.js`:
  - `authenticateToken` reads the `token` cookie, verifies it with `jwttoken.verify`, attaches the decoded payload to `req.user`, and responds with appropriate 401 or 500 JSON payloads on failure.
  - `requireRole(allowedRoles)` ensures the caller is authenticated and has one of the required roles, responding with 401 or 403 where appropriate.
- Access control in the user controllers builds on this middleware:
  - `updateUserById` restricts updates so users can only change their own profile (and not their role), while admins can update any user and are the only ones allowed to change roles.
  - `deleteUserById` allows only admins to delete users and prevents admins from deleting their own account.

### Request validation
- Validation logic is handled with Zod schemas under `src/validations/`:
  - `src/validations/auth.validation.js` defines `signupSchema` and `signInSchema` for auth flows.
  - `src/validations/users.validation.js` defines `userIdSchema` and `updateUserSchema` for user operations, including rules like positive numeric IDs and requiring at least one field to update.
- Controllers use `safeParse` and the helper `formatValidationError` from `src/utils/format.js` to convert Zod errors into concise human-readable strings for JSON responses.

### Security middleware and Arcjet integration
- Arcjet configuration lives in `src/config/arcjet.js`:
  - Constructs a base Arcjet client with `ARCJET_KEY` from the environment.
  - Adds a shield rule, bot detection (with some categories allowed), and a base sliding window rate limiter.
- `src/middleware/security.middleware.js` builds on this configuration to enforce dynamic rate limiting and security decisions per request:
  - Infers a logical `role` (`admin`, `user`, or `guest`) from `req.user` where available.
  - Sets rate limits per role and creates a per-request Arcjet client with a sliding window rule named based on the role.
  - Evaluates Arcjet decisions and returns specific 403 JSON responses for bots, shield blocks, and rate limit violations, logging structured details via the logger.
- This middleware is globally applied in `src/app.js` to protect all routes.

### Logging
- Logging is configured in `src/config/logger.js` using `winston`:
  - Logs use a JSON format with timestamp and error stack support.
  - Writes to `logs/error.lg` (errors only) and `logs/combined.log` for all logs.
  - In non-production environments, adds a colorized console transport for developer-friendly output.
- Controllers, services, and middleware log important events and errors (for example, user lifecycle events and security decisions). Ensure the `logs/` directory exists when running locally.

### Testing
- Tests live under the `tests/` directory and use Jest with Supertest for HTTP-level tests.
- `tests/app.test.js` imports the Express app via the `#src/app.js` alias and verifies:
  - The `/health` endpoint returns a 200 status with `status`, `timestamp`, and `uptime` fields.
  - The `/api` endpoint returns the expected JSON message.
  - The 404 handler responds with `{ error: 'Route not found' }` for unknown routes.
- When adding new endpoints, follow this pattern by importing the app via the alias and using Supertest to exercise the routes.

### Tooling configuration
- ESLint is configured via `eslint.config.js` using the flat config format:
  - Extends `@eslint/js` recommended rules and customizes indentation, quotes, semicolons, and several modern JavaScript best practices.
  - Provides additional globals for test files under `tests/**/*.js` (for example, `describe`, `it`, `expect`, `jest`).
  - Ignores `node_modules`, `coverage`, `logs`, and `drizzle` directories.
- Prettier is configured via `.prettierrc` and `.prettierignore` and is integrated into ESLint via `eslint-plugin-prettier` and `eslint-config-prettier`. Use the provided `format` scripts rather than invoking Prettier manually.

### Environment configuration
- Environment variables are loaded via `dotenv` in both `src/index.js` and `src/config/database.js`. Typical variables include:
  - `DATABASE_URL` for the Neon/Drizzle database connection.
  - `ARCJET_KEY` for the Arcjet security integration.
  - `JWT_SECRET` for signing and verifying JWTs (required for secure deployments; a default is used only as a fallback).
  - `LOG_LEVEL` to control the logging level (defaults to `info`).
  - `NODE_ENV` to control environment-specific behavior (for example, database client tweaks and logging transports).
  - `PORT` to configure the listening port for the HTTP server.
- A `.env` file is present in the project root and is typically where these values are defined for local development.
