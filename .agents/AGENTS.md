# AI Agent Steering Document: Recipe Manager (`recipemanager`)

This document defines mandatory guidelines, architecture blueprints, build/test execution matrix, security guardrails, and coding conventions for AI agents operating in this repository.

---

## 📚 Detailed Guides & References

- 🎨 **Coding Style & Architecture Guide**: [.agents/coding_style.md](file:///home/daryl/git/recipemanager/.agents/coding_style.md)
- 🧪 **Testing & Verification Guide**: [.agents/testing_guide.md](file:///home/daryl/git/recipemanager/.agents/testing_guide.md)
- 📐 **Design Principles Guide**: [.agents/design_principles.md](file:///home/daryl/git/recipemanager/.agents/design_principles.md)

---

## 🎯 Role & Operational Principles

1. **Verification-Driven**: Never declare success or mark a task complete without running the appropriate build and test commands (`cargo test`, `cargo fmt`, `npx playwright test`).
2. **No Unvalidated Assumptions**: Inspect authoritative source code (`src/`, `Cargo.toml`, `templates/`) before inferring data structures, function signatures, database schemas, or API endpoints.
3. **Secret & Privacy Security**:
   - Never hardcode, display, or commit API keys, actual passwords, personal emails, or session secrets.
   - Always load credentials dynamically from environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GEMINI_API_KEY`, `SESSION_SECRET`).
   - Use generic placeholder emails (`admin@example.com`, `user@example.com`) for tests and local development.
4. **Log Inspection First**: When an error or test failure occurs, fetch and read the complete error traceback before diagnosing the failure. Do not guess root causes blindly.
5. **Contract & API Preservation**: Maintain existing function signatures, database schemas, Askama template structures, and API routes unless explicitly instructed to perform a breaking refactor.

---

## 🛠️ Tech Stack & Architecture

- **Backend Framework**: [Axum 0.8](file:///home/daryl/git/recipemanager/Cargo.toml#L9) running on [Tokio](file:///home/daryl/git/recipemanager/Cargo.toml#L23) async engine.
- **Database Layer**: SQLite managed via `rusqlite` (bundled edition) with connection pooling, migrations, and local storage in `data/recipemanager.db`.
- **HTML Server-Side Rendering**: [Askama 0.16](file:///home/daryl/git/recipemanager/Cargo.toml#L8) template engine.
- **Sanitization & Security**: [Ammonia 4.0](file:///home/daryl/git/recipemanager/Cargo.toml#L7) HTML XSS sanitizer; custom CSRF & SSRF verification middleware.
- **Authentication**: WebAuthn / Passkeys ([webauthn-rs 0.5](file:///home/daryl/git/recipemanager/Cargo.toml#L38)) in [src/passkeys.rs](file:///home/daryl/git/recipemanager/src/passkeys.rs) + persistent session cookies (`admin_session`).
- **Frontend**: Vanilla HTML5, CSS3 ([static/styles.css](file:///home/daryl/git/recipemanager/static/styles.css)), and progressive JS enhancement.
- **E2E Testing**: [Playwright](https://playwright.dev/) TypeScript suite in [tests/ui/](file:///home/daryl/git/recipemanager/tests/ui/).

---

## 📂 Repository Layout & Module Blueprint

- [src/main.rs](file:///home/daryl/git/recipemanager/src/main.rs): App entry point, Tokio runtime, Axum router initialization, static asset mounting, `AppState` setup, and HTML page route handlers.
- [src/api.rs](file:///home/daryl/git/recipemanager/src/api.rs): RESTful JSON API routes (`/recipes`, `/ferment`, `/temps`, `/spices`, `/log7`, `/import`, `/shopping-list`, `/meal-plan`) and bearer token auth middleware (`require_api_token`).
- [src/storage.rs](file:///home/daryl/git/recipemanager/src/storage.rs): DB migration, initialization, prepared statement CRUD operations (`save_recipe`, `get_recipe`, user/passkey models, meal planning, shopping list).
- [src/models.rs](file:///home/daryl/git/recipemanager/src/models.rs): Core database entity structs (`Recipe`, `User`, `UserPasskey`, `ShoppingListItem`, `MealPlanItem`).
- [src/conversions.rs](file:///home/daryl/git/recipemanager/src/conversions.rs): Unit conversion engine (imperial/metric, weight, volume, fraction parsing, sourdough baker's percentage).
- [src/importer.rs](file:///home/daryl/git/recipemanager/src/importer.rs): External recipe web scraper & importer with SSRF IP validation defenses.
- [src/passkeys.rs](file:///home/daryl/git/recipemanager/src/passkeys.rs): WebAuthn passkey registration & authentication endpoints and challenge storage.
- [src/bin/hash_password.rs](file:///home/daryl/git/recipemanager/src/bin/hash_password.rs): Utility CLI binary to hash passwords using bcrypt.
- [templates/](file:///home/daryl/git/recipemanager/templates/): Askama HTML templates extending [templates/base.html](file:///home/daryl/git/recipemanager/templates/base.html).
- [static/](file:///home/daryl/git/recipemanager/static/): Cascading stylesheets ([static/styles.css](file:///home/daryl/git/recipemanager/static/styles.css)) and static images/assets.
- [tests/ui/](file:///home/daryl/git/recipemanager/tests/ui/): Integration and E2E Playwright tests.

---

## 🚀 Commands & Execution Matrix

### 1. Launching Local Dev Server
The app panics if `ADMIN_EMAIL` is not set:
```bash
ADMIN_EMAIL=admin@example.com cargo run --bin recipemanager
```

### 2. Running Rust Unit & Integration Tests
```bash
cargo test
```

### 3. Running Playwright E2E UI Tests
Playwright tests utilize CDP virtual authenticators, which require Chromium:
```bash
# Run full E2E test suite (sequential worker to avoid SQLite database locks)
npx playwright test --project=chromium --workers=1

# Run specific E2E test file
npx playwright test tests/ui/passkeys.spec.ts --project=chromium --workers=1
```

### 4. Code Formatting Verification
```bash
cargo fmt --all -- --check
```

---

## 🔒 Security & Safety Guardrails

### 1. WebAuthn Secure Origin Constraints
- WebAuthn mandates a secure origin. During local testing, use `http://localhost:3000` exclusively.
- Do NOT use raw IP addresses (e.g. `http://127.0.0.1:3000`), as RP ID mismatch will trigger `SecurityError`.

### 2. SQL Injection Prevention
- All queries in [src/storage.rs](file:///home/daryl/git/recipemanager/src/storage.rs) must execute via prepared statements with `rusqlite` parameters (e.g. `params![...]`). Never format dynamic query strings.

### 3. XSS Sanitization
- All HTML/Markdown content rendered from user recipes or external imports must be sanitized via `ammonia::Builder::default().sanitize(html)` prior to rendering/storage.

### 4. CSRF & SSRF Protections
- Mutating endpoints (`POST`, `PUT`, `DELETE`) enforce `csrf_header_check` middleware validating `Origin`/`Referer` headers.
- External recipe imports resolve hostnames using `tokio::net::lookup_host` and reject private/loopback ranges (127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12).

### 5. Session Management
- Cookies (`admin_session`) use `HttpOnly` and persistent 30-day max age (`max_age(time::Duration::days(30))`).

---

## 🎨 Coding Conventions & Best Practices

Detailed standards are available in [.agents/coding_style.md](file:///home/daryl/git/recipemanager/.agents/coding_style.md), [.agents/testing_guide.md](file:///home/daryl/git/recipemanager/.agents/testing_guide.md), and [.agents/design_principles.md](file:///home/daryl/git/recipemanager/.agents/design_principles.md).

1. **Axum Handlers**: State is passed as `State(state): State<AppState>`. Routes return Axum `IntoResponse` or `Result<impl IntoResponse, (StatusCode, String)>`.
2. **Askama Template Rules**: Templates derive `#[derive(Template)]` with specified `#[template(path = "...")]`. Layout inheritance is anchored in `templates/base.html`.
3. **Playwright E2E Stability**:
   - Always run tests with `--workers=1` to prevent database locks on SQLite.
   - Call `await page.waitForLoadState('load')` after navigations or redirects before interacting with elements.
   - Use strict selector scoping (e.g., `locator.first().click()`) to avoid multi-match errors.
