# Coding Style & Architecture Guide: Recipe Manager (`recipemanager`)

This document outlines coding conventions, architectural standards, and implementation practices for developers and AI agents working on `recipemanager`.

---

## 🦀 Rust & Axum Conventions

### 1. Code Formatting & Linting
- All Rust code must conform to standard `rustfmt` formatting. Run `cargo fmt --all -- --check` prior to committing.
- Treat compiler warnings and clippy lints seriously. Avoid suppressing lints unless strictly necessary (e.g., `#![allow(clippy::items_after_test_module)]`).

### 2. Axum Route Handlers
- **State Extractor**: Pass shared application state using Axum's `State(state): State<AppState>`.
- **Response Types**: Return Axum `IntoResponse` or `Result<impl IntoResponse, (StatusCode, String)>` to ensure clean HTTP status mapping.
- **API Token Middleware**: Mutating JSON API routes (`POST`, `PUT`, `DELETE`) in [src/api.rs](file:///home/daryl/git/recipemanager/src/api.rs) must be protected by the `require_api_token` middleware layer.

### 3. Database Layer (`src/storage.rs`)
- **SQL Injection Prevention**: Never format raw query strings with `format!`. Every query must use `rusqlite` prepared statements with parameterized placeholders (e.g. `stmt.execute(params![...])`).
- **Transactions**: Multi-step DB modifications must run within a SQLite transaction (`conn.transaction()`) to preserve atomicity.
- **Entity Mapping**: Place database entities in [src/models.rs](file:///home/daryl/git/recipemanager/src/models.rs).

### 4. HTML Rendering & Askama Templates
- Server-rendered pages use Askama templates located in [templates/](file:///home/daryl/git/recipemanager/templates/).
- All page templates derive `#[derive(Template)]` with specified `#[template(path = "...")]` and inherit from [templates/base.html](file:///home/daryl/git/recipemanager/templates/base.html).
- Keep logic in templates minimal; calculate display variables in Rust handler functions before building template context structs.

### 5. Security & Sanitization
- **XSS Prevention**: User-submitted recipe Markdown/HTML instructions must be sanitized via `ammonia::Builder::default().sanitize(html)` before rendering or DB storage.
- **SSRF Defenses**: Recipe import URLs in [src/importer.rs](file:///home/daryl/git/recipemanager/src/importer.rs) must resolve hostnames via `tokio::net::lookup_host` and reject private/loopback IP blocks (127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12).
- **CSRF Check**: Form submissions and state-changing requests validate `Origin` and `Referer` headers via `csrf_header_check`.

---

## 🎨 Frontend & UI Conventions

- **Styles**: Global styles are maintained in [static/styles.css](file:///home/daryl/git/recipemanager/static/styles.css). Use CSS custom properties for theme colors and spacing.
- **Progressive Enhancement**: Enhance HTML forms with standard JavaScript `fetch()` calls where dynamic feedback is required (e.g., unit conversions, ingredient adjustments, meal planning).
- **WebAuthn Integration**: Passkey registration and login flows in [src/passkeys.rs](file:///home/daryl/git/recipemanager/src/passkeys.rs) require a secure origin (`http://localhost:3000`).
