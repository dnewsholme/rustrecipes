# Agent Guide: Recipe Manager (`recipemanager`)

This document serves as an onboarding guide and architectural reference for AI agents (and human developers) working in this repository.

---

## 🛠️ Tech Stack & Architecture

*   **Backend**: Written in **Rust** using the [Axum](https://github.com/tokio-rs/axum) web framework.
*   **Database**: **SQLite** (via `rusqlite`), managed locally in `data/recipemanager.db`.
*   **HTML Templates**: Server-side rendered using [Askama](https://github.com/djc/askama).
*   **Frontend**: Vanilla HTML5, CSS3 (`static/styles.css`), and JavaScript.
*   **E2E Testing**: [Playwright](https://playwright.dev/) TypeScript tests targeting loopback addresses.
*   **API Endpoints**: The application should use rest api endpoints for functionality where possible, and these API endpoints should be secured using bearer tokens if they contain user or admin specific data (or both).

---

## 📂 Project Structure

*   [src/main.rs](file:///home/daryl/git/recipemanager/src/main.rs): Application entry point, Axum router setup, environment configs, template structures, and core page/form handlers.
*   [src/passkeys.rs](file:///home/daryl/git/recipemanager/src/passkeys.rs): WebAuthn endpoints (register start/finish, login start/finish, listing, deleting).
*   [src/models.rs](file:///home/daryl/git/recipemanager/src/models.rs): Database entity structs (e.g. `User`, `Recipe`, `UserPasskey`).
*   [src/storage.rs](file:///home/daryl/git/recipemanager/src/storage.rs): DB migration, initialization, CRUD operations, and unit tests.
*   [src/importer.rs](file:///home/daryl/git/recipemanager/src/importer.rs): Recipe scrapers/importer logic.
*   [templates/](file:///home/daryl/git/recipemanager/templates/): Askama HTML templates extending [base.html](file:///home/daryl/git/recipemanager/templates/base.html).
*   [static/](file:///home/daryl/git/recipemanager/static/): CSS styling ([styles.css](file:///home/daryl/git/recipemanager/static/styles.css)) and visual assets.
*   [tests/ui/](file:///home/daryl/git/recipemanager/tests/ui/): Playwright integration tests.

---

## 🔑 Crucial Gotchas & Conventions for AI Agents

### 1. WebAuthn Secure Origin Constraints
WebAuthn (Passkeys) mandates a secure context. During local development, loopback addresses (`localhost` and `127.0.0.1`) qualify.
*   **Gotcha**: The WebAuthn Relying Party (RP) ID must match the domain of the origin. Configuring RP ID as `localhost` while visiting the site via `http://127.0.0.1:3000` will throw a `SecurityError`.
*   **Guideline**: Always target `http://localhost:3000` for development and testing. Do not use raw IP addresses.

### 2. Playwright E2E Passkey Tests
*   **Chromium Only**: CDP virtual authenticators (`WebAuthn.addVirtualAuthenticator`) are only supported in Chromium. The E2E passkey test is skipped on other browsers.
*   **Page Load Sync**: After login redirections, call `await page.waitForLoadState('load')` to guarantee scripts have executed and element listeners are fully bound before attempting clicks on dropdowns or panels.
*   **Strictness**: Playwright enforces strict mode. If checking list elements, wait for loading states to clear (`Loading keys...` text is gone) and target `.first().click()` when dealing with repeated buttons (like key deletion).

### 3. Session Cookies
*   Use `max_age(time::Duration::days(30))` for login session cookies to enable persistent logouts across browser restarts.
*   The cookie name is `admin_session`. The application automatically intercepts the username `"admin"` and resolves it to the administrator's actual email (retrieved via the required `ADMIN_EMAIL` environment variable — the app will panic at startup if this is not set).

---

## 🚀 Common Commands

### Running Locally
To launch the dev server with live-reloads:
```bash
ADMIN_EMAIL=admin@example.com cargo run --bin recipemanager
```

### Running Tests
*   **Rust unit & DB tests**:
    ```bash
    cargo test
    ```
*   **Playwright E2E tests (All)**:
    ```bash
    npx playwright test --project=chromium --workers=1
    ```
*   **Playwright E2E tests (Passkeys Specific)**:
    ```bash
    npx playwright test tests/ui/passkeys.spec.ts --project=chromium --workers=1
    ```

### Formatting Code
To ensure all Rust code complies with the project's formatting standard:
```bash
cargo fmt --all -- --check
```
