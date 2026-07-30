# Testing & Verification Guide: Recipe Manager (`recipemanager`)

This document outlines the testing strategy, test suites, execution workflows, and stability guidelines for `recipemanager`.

---

## 🧪 Test Architecture Overview

`recipemanager` uses a two-tiered testing approach:
1. **Rust Unit & Integration Tests**: Validates core business logic, SQLite storage, unit conversions, fraction parsing, and web scrapers.
2. **Playwright E2E UI Tests**: Validates full user browser interactions, authentication, passkeys (WebAuthn), meal planner, shopping list, and mobile UI responsiveness.

---

## 🦀 Rust Unit & Integration Tests

### 1. Running Unit Tests
Execute all Rust tests with:
```bash
cargo test
```

### 2. Test Coverage & Locations
- **Unit Conversions**: [src/conversions.rs](file:///home/daryl/git/recipemanager/src/conversions.rs) tests metric/imperial conversion formulas, sourdough baker's percentage calculations, and fraction parsing.
- **Database & Storage**: [src/storage.rs](file:///home/daryl/git/recipemanager/src/storage.rs) tests migration execution, recipe CRUD operations, shopping list management, and user/passkey models using isolated temporary databases.
- **Recipe Importer**: [src/importer.rs](file:///home/daryl/git/recipemanager/src/importer.rs) tests schema.org/Recipe JSON-LD parsing and web page HTML scraping against fixtures in [tests/fixtures/](file:///home/daryl/git/recipemanager/tests/fixtures/).

---

## 🎭 Playwright E2E Testing Strategy

### 1. Execution Command
```bash
# Run full Playwright test suite (Chromium browser, single worker)
npx playwright test --project=chromium --workers=1

# Run a specific spec file
npx playwright test tests/ui/passkeys.spec.ts --project=chromium --workers=1
```

### 2. Critical Playwright Stability Rules

- **Single Worker (`--workers=1`)**:
  - SQLite databases do not support concurrent write locks across multiple process workers during testing.
  - Always execute Playwright tests with `--workers=1`.

- **Chromium Project Requirement (`--project=chromium`)**:
  - CDP (Chrome DevTools Protocol) virtual authenticators (`WebAuthn.addVirtualAuthenticator`) are used to mock WebAuthn passkey hardware keys in automated testing.
  - CDP virtual authenticators are ONLY supported in Chromium. Non-Chromium browsers will skip passkey tests.

- **Page Load Synchronization**:
  - After performing navigation, login, or form submissions, call `await page.waitForLoadState('load')` before attempting to locate or interact with elements.
  - Wait for dynamic loader elements (e.g. `Loading keys...`) to detach before clicking action buttons.

- **Strict Mode Selectors**:
  - Avoid ambiguous selectors. Use strict scoping or explicit `.first()` targets (e.g., `page.locator('.delete-btn').first().click()`).

---

## 🛡️ Pre-Commit Verification Checklist

Before marking a task complete or submitting a pull request, run the full verification battery:

```bash
# 1. Rust build & unit tests
cargo test

# 2. Rust formatting check
cargo fmt --all -- --check

# 3. Playwright E2E UI tests
npx playwright test --project=chromium --workers=1
```
