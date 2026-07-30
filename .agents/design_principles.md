# Design Principles: Recipe Manager (`recipemanager`)

This document outlines the core UI/UX, visual aesthetic, architecture, REST API design, and interaction principles for `recipemanager`.

---

## 🎨 UI/UX & Visual Aesthetic Principles

### 1. Kitchen-First Usability
- **Glanceable & High Contrast**: Typography and UI elements in active cooking views (e.g. Cook Mode, Timers, Temperature charts) must be bold, legible from a distance, and high-contrast for kitchen environments.
- **Responsive Layouts**: Design for mobile smartphones and kitchen tablets first. Ensure touch targets are at least 44x44px for easy interaction with wet or gloved hands.
- **Distraction-Free Focus**: Keep recipe details, ingredient quantities, and preparation steps unobstructed by unnecessary popups or intrusive overlays.

### 2. Aesthetic Excellence & Theme Harmony
- **Modern Palette**: Utilize custom CSS variables ([static/styles.css](file:///home/daryl/git/recipemanager/static/styles.css)) for seamless light and dark mode themes. Avoid plain, unstyled browser defaults.
- **Typography & Hierarchy**: Enforce a strict hierarchy (`h1` for main page title, `h2` for section headers like Ingredients/Instructions, clear bold labels for quantities).
- **Subtle Micro-Animations**: Use smooth CSS transitions for hover states, modal toggles, checkbox completion states, and notification toasts.

---

## 🛠️ Software & Architectural Design Principles

### 1. Server-Side First (Progressive Enhancement)
- **Fast SSR Initial Render**: The primary application layout and page content are rendered server-side via Askama templates ([templates/](file:///home/daryl/git/recipemanager/templates/)) for near-instant first contentful paint (FCP).
- **Lightweight JS Enhancement**: Use progressive JavaScript enhancements for dynamic features (e.g., unit conversions, fraction adjustments, sourdough baker's percentage scaling, cook timers, meal planner toggles). Avoid heavy frontend SPA frameworks.

### 2. RESTful API Architecture
- **API First Endpoints**: Core functionality is exposed through clean RESTful API routes in [src/api.rs](file:///home/daryl/git/recipemanager/src/api.rs) (`/recipes`, `/ferment`, `/temps`, `/spices`, `/log7`, `/import`, `/shopping-list`, `/meal-plan`), returning structured JSON payloads.
- **Bearer Token Security**: Endpoints containing user- or admin-specific data or performing state mutations enforce HTTP Bearer token authentication via the `require_api_token` middleware.
- **Standard HTTP Verbs & Status Codes**: Consistently map operations to HTTP methods (`GET` for reads, `POST` for creation, `PUT` for updates, `DELETE` for removals) and explicit status codes (`200 OK`, `201 Created`, `400 Bad Request`, `401 Unauthorized`, `404 Not Found`).

### 3. Dependency Minimization & Performance
- **Zero Heavy Frontend Frameworks**: Rely on vanilla HTML5, CSS3, and standard ES6 JavaScript. Keep asset bundle size small and load times ultra-fast.
- **Single Binary Simplicity**: The entire application (Axum web server, SQLite database, static assets, and HTML templates) compiles into a self-contained Rust binary for simple deployment and low resource consumption.

### 4. Security-by-Default Design
- **Sanitized Output**: User-provided Markdown and HTML recipes must undergo strict XSS sanitization (Ammonia) before storage and rendering.
- **Passwordless Security**: Authenticate users via WebAuthn / Passkeys (`webauthn-rs`) to provide secure, modern, passwordless authentication without risk of credential leaks.
