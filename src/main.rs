#![allow(clippy::collapsible_if)]
mod api;
mod conversions;
mod importer;
mod models;
pub mod openapi;
mod passkeys;
mod storage;

use askama::Template;
use axum::{
    Form, Router,
    extract::Request,
    extract::{DefaultBodyLimit, FromRef, Multipart, Path, Query, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{Html, IntoResponse, Json, Redirect, Response},
    routing::{delete, get, post},
};
use axum_extra::extract::cookie::{Cookie, Key, PrivateCookieJar, SameSite};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::net::SocketAddr;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing::{error, info, warn};

#[derive(Clone)]
struct GoogleOauthConfig {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    #[allow(dead_code)]
    admin_email: String,
}

#[derive(Clone, Debug)]
struct OidcConfig {
    provider_name: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    scopes: String,
    admin_group: String,
    issuer_url: Option<String>,
    auth_url: Option<String>,
    token_url: Option<String>,
    userinfo_url: Option<String>,
}

fn resolve_oidc_admin_group() -> String {
    std::env::var("OIDC_ADMIN_GROUP")
        .or_else(|_| std::env::var("OIDC_ADMINS_GROUP"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "admins".to_string())
}

#[derive(Deserialize, Debug, Clone)]
struct OidcDiscoveryDocument {
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: Option<String>,
}

async fn fetch_oidc_discovery(issuer_url: &str) -> Result<OidcDiscoveryDocument, String> {
    let discovery_url = if issuer_url.ends_with("/.well-known/openid-configuration") {
        issuer_url.to_string()
    } else {
        format!(
            "{}/.well-known/openid-configuration",
            issuer_url.trim_end_matches('/')
        )
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let res = client.get(&discovery_url).send().await.map_err(|e| {
        format!(
            "Failed to contact OIDC discovery endpoint {}: {}",
            discovery_url, e
        )
    })?;

    if !res.status().is_success() {
        return Err(format!(
            "OIDC discovery returned HTTP status {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    res.json::<OidcDiscoveryDocument>()
        .await
        .map_err(|e| format!("Failed to parse OIDC discovery document: {}", e))
}

impl OidcConfig {
    async fn resolve_endpoints(&self) -> Result<(String, String, Option<String>), String> {
        let auth = self.auth_url.clone();
        let token = self.token_url.clone();
        let userinfo = self.userinfo_url.clone();

        if let (Some(a), Some(t)) = (&auth, &token) {
            return Ok((a.clone(), t.clone(), userinfo));
        }

        if let Some(ref issuer) = self.issuer_url {
            let doc = fetch_oidc_discovery(issuer).await?;
            let a = auth.unwrap_or(doc.authorization_endpoint);
            let t = token.unwrap_or(doc.token_endpoint);
            let u = userinfo.or(doc.userinfo_endpoint);
            return Ok((a, t, u));
        }

        Err("Neither complete OIDC endpoints nor issuer URL was provided".to_string())
    }
}

#[derive(Clone)]
struct AppState {
    key: Key,
    password_hash: String,
    app_base: &'static str,
    google_oauth: Option<GoogleOauthConfig>,
    oidc: Option<OidcConfig>,
    webauthn: std::sync::Arc<webauthn_rs::Webauthn>,
    reg_states: std::sync::Arc<
        std::sync::Mutex<
            std::collections::HashMap<String, webauthn_rs::prelude::PasskeyRegistration>,
        >,
    >,
    auth_states: std::sync::Arc<
        std::sync::Mutex<
            std::collections::HashMap<String, webauthn_rs::prelude::PasskeyAuthentication>,
        >,
    >,
    /// Bearer token granting admin API access. `None` disables token auth.
    api_token: Option<String>,
}

impl FromRef<AppState> for Key {
    fn from_ref(state: &AppState) -> Self {
        state.key.clone()
    }
}

#[derive(Template)]
#[template(path = "api_guide.html")]
struct ApiGuideTemplate {
    app_base: &'static str,
    app_version: String,
    current_user_id: Option<String>,
    current_user_email: Option<String>,
    is_admin: bool,
}

const APP_VERSION: &str = match option_env!("APP_VERSION") {
    Some(v) => v,
    None => env!("CARGO_PKG_VERSION"),
};

#[derive(Serialize)]
struct UploadResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<UploadData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct UploadData {
    #[serde(rename = "filePath")]
    file_path: String,
}

fn is_admin_session(jar: &PrivateCookieJar) -> bool {
    if let Some(c) = jar.get("admin_session") {
        let val = c.value();
        info!("Found session cookie with value: {}", val);
        if val == "true" {
            return true;
        }
        if let Some(uid) = storage::resolve_session_user_id(val) {
            return storage::is_user_admin(&uid);
        }
        false
    } else {
        // Distinguish between missing and invalid
        if jar.iter().any(|c| c.name() == "admin_session") {
            warn!("Admin session cookie present but failed to verify signature (invalid key?)");
        }
        false
    }
}

async fn get_session_user_id(jar: &PrivateCookieJar) -> Option<String> {
    if let Some(c) = jar.get("admin_session") {
        let val = c.value();
        if val == "true" {
            if let Ok(admin_email) = std::env::var("ADMIN_EMAIL") {
                if !admin_email.trim().is_empty()
                    && let Some(user) = storage::find_user_by_email(admin_email.trim())
                {
                    return Some(user.id);
                }
            }
            if let Some(admin_user) = storage::list_users().into_iter().find(|u| u.is_admin) {
                return Some(admin_user.id);
            }
        }
        if !val.is_empty() {
            return storage::resolve_session_user_id(val);
        }
    }
    None
}

async fn spa_fallback(
    State(state): State<AppState>,
    _jar: PrivateCookieJar,
    _headers: axum::http::HeaderMap,
    Query(_params): Query<std::collections::HashMap<String, String>>,
    uri: axum::http::Uri,
) -> Response {
    let mut path = uri.path();
    if !state.app_base.is_empty() && path.starts_with(state.app_base) {
        path = &path[state.app_base.len()..];
    }
    if path.starts_with("/api/")
        || path.starts_with("/static/")
        || path.starts_with("/assets/")
        || path.starts_with("/uploads/")
        || path.starts_with("/data/uploads/")
    {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    let relative_path = path.trim_start_matches('/');
    if !relative_path.is_empty() {
        let candidate = std::path::Path::new("frontend/dist").join(relative_path);
        if candidate.is_file() {
            let req = axum::http::Request::builder()
                .uri(uri.clone())
                .body(axum::body::Body::empty())
                .unwrap();
            let res =
                tower::ServiceExt::oneshot(tower_http::services::ServeFile::new(&candidate), req)
                    .await;
            return res.unwrap().into_response();
        }
    }

    default_index(State(state)).await
}

async fn default_index(State(state): State<AppState>) -> Response {
    match tokio::fs::read_to_string("frontend/dist/index.html").await {
        Ok(content) => {
            let base_href = if state.app_base.is_empty() {
                "/".to_string()
            } else {
                format!("{}/", state.app_base.trim_end_matches('/'))
            };
            let injected = format!(
                "<base href=\"{}\" />\n    <script>window.__APP_BASE__ = {:?};</script>",
                base_href, state.app_base
            );
            let html = if content.contains("<head>") {
                content.replacen("<head>", &format!("<head>\n    {}", injected), 1)
            } else {
                content
            };
            Html(html).into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            "Modern UI bundle not found. Please build frontend.",
        )
            .into_response(),
    }
}

async fn admin_users_page(State(state): State<AppState>, jar: PrivateCookieJar) -> Response {
    if !is_admin_session(&jar) {
        return Redirect::to("/login").into_response();
    }
    default_index(State(state)).await
}

async fn api_guide(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let user_id = get_session_user_id(&jar).await;
    let user_email = if let Some(uid) = &user_id {
        storage::find_user_by_id(uid).map(|u| u.email)
    } else {
        None
    };
    let template = ApiGuideTemplate {
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        current_user_id: user_id,
        current_user_email: user_email,
        is_admin: is_admin_session(&jar),
    };
    Html(template.render().unwrap())
}

async fn toggle_favorite(jar: PrivateCookieJar, Path(id): Path<String>) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return Err((StatusCode::UNAUTHORIZED, "Unauthorized")),
    };

    if let Some(recipe) = storage::read_recipe_for_user(&id, Some(&user_id)) {
        let is_owner = recipe.owner_id == user_id;
        if !recipe.is_public && !is_owner && !is_admin_session(&jar) {
            return Err((StatusCode::FORBIDDEN, "Forbidden"));
        }
        match storage::toggle_recipe_favorite(&user_id, &id) {
            Ok(new_state) => Ok(Json(serde_json::json!({ "favorite": new_state }))),
            Err(_) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to toggle favorite",
            )),
        }
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn import_photo(jar: PrivateCookieJar, mut multipart: Multipart) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    };
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if (name == "photo" || name == "file")
            && let Ok(data) = field.bytes().await
        {
            let processed_data = match storage::process_image(&data) {
                Ok(d) => d,
                Err(e) => {
                    warn!("Failed to process photo: {:?}", e);
                    return (
                        StatusCode::BAD_REQUEST,
                        "Uploaded file is not a valid image format",
                    )
                        .into_response();
                }
            };

            let new_filename = format!("{}.webp", uuid::Uuid::new_v4());
            let filepath = format!("data/uploads/{}", new_filename);
            let _ = std::fs::write(&filepath, &processed_data);

            match importer::import_recipe_from_photo("image/jpeg", &processed_data).await {
                Ok(mut recipe) => {
                    recipe.image = Some(format!("uploads/{}", new_filename));
                    recipe.owner_id = user_id.clone();
                    if let Err(e) = storage::save_recipe(&recipe) {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to save recipe: {:?}", e),
                        )
                            .into_response();
                    }
                    return Json(recipe).into_response();
                }
                Err(e) => {
                    warn!("Failed to parse recipe from photo using AI: {:?}", e);
                    let msg = format!("Failed to parse recipe from photo using AI: {}", e);
                    return (StatusCode::BAD_REQUEST, msg).into_response();
                }
            }
        }
    }

    (StatusCode::BAD_REQUEST, "No photo uploaded").into_response()
}

async fn import_paprika(jar: PrivateCookieJar, mut multipart: Multipart) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    };
    let mut imported = Vec::new();
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if (name == "paprika_file" || name == "file")
            && let Ok(data) = field.bytes().await
        {
            let recipes = importer::import_paprika_archive(&data).await;
            for mut recipe in recipes {
                recipe.owner_id = user_id.clone();
                if storage::save_recipe(&recipe).is_ok() {
                    imported.push(recipe);
                }
            }
        }
    }

    Json(imported).into_response()
}

async fn upload_image(mut multipart: Multipart) -> impl IntoResponse {
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let bytes = field.bytes().await.unwrap();

        // Process image: resize and compress
        let processed_data = match storage::process_image(&bytes) {
            Ok(d) => d,
            Err(e) => {
                warn!("Failed to process upload: {:?}", e);
                return Json(UploadResponse {
                    data: None,
                    error: Some("Uploaded file is not a valid image format".to_string()),
                })
                .into_response();
            }
        };

        let new_filename = format!("{}.webp", uuid::Uuid::new_v4());
        let filepath = format!("data/uploads/{}", new_filename);

        if std::fs::write(&filepath, processed_data).is_ok() {
            let url = format!("uploads/{}", new_filename);
            return Json(UploadResponse {
                data: Some(UploadData { file_path: url }),
                error: None,
            })
            .into_response();
        }
    }

    Json(UploadResponse {
        data: None,
        error: Some("Upload failed".to_string()),
    })
    .into_response()
}

async fn upload_csv(mut multipart: Multipart) -> impl IntoResponse {
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        if let Ok(bytes) = field.bytes().await {
            let new_filename = format!("{}.csv", uuid::Uuid::new_v4());
            let filepath = format!("data/uploads/{}", new_filename);
            if std::fs::write(&filepath, bytes).is_ok() {
                let url = format!("uploads/{}", new_filename);
                return Json(UploadResponse {
                    data: Some(UploadData { file_path: url }),
                    error: None,
                })
                .into_response();
            }
        }
    }

    Json(UploadResponse {
        data: None,
        error: Some("Upload failed".to_string()),
    })
    .into_response()
}

#[allow(clippy::result_large_err)]
async fn require_admin(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    if get_session_user_id(&jar).await.is_some() {
        Ok(next.run(req).await)
    } else if req.uri().path().starts_with("/api/") {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": { "code": "UNAUTHORIZED", "message": "Authentication required" }
            })),
        )
            .into_response())
    } else {
        Err(Redirect::to(&format!("{}/login", state.app_base)).into_response())
    }
}

async fn login_form(State(state): State<AppState>) -> Response {
    default_index(State(state)).await
}

#[derive(Deserialize)]
struct LoginFormData {
    email: Option<String>,
    password: String,
}

async fn login_submit(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Form(form): Form<LoginFormData>,
) -> impl IntoResponse {
    let admin_email = std::env::var("ADMIN_EMAIL").unwrap_or_default();
    let email_lookup = match &form.email {
        Some(e) if !e.trim().is_empty() => {
            if e.trim().to_lowercase() == "admin" && !admin_email.is_empty() {
                admin_email
            } else {
                e.trim().to_string()
            }
        }
        _ => admin_email,
    };

    if let Some(user) = storage::find_user_by_email(&email_lookup) {
        if let Ok(true) = bcrypt::verify(&form.password, &user.password_hash) {
            let cookie_path = if state.app_base.is_empty() {
                "/"
            } else {
                state.app_base
            };
            let cookie = Cookie::build(("admin_session", user.id))
                .path(cookie_path)
                .http_only(true)
                .secure(is_cookie_secure())
                .same_site(SameSite::Lax)
                .max_age(time::Duration::days(30))
                .build();
            let updated_jar = jar.add(cookie);
            return (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response();
        }
    }

    (
        StatusCode::UNAUTHORIZED,
        Redirect::to(&format!(
            "{}/login?error=Invalid+credentials",
            state.app_base
        )),
    )
        .into_response()
}

async fn logout(State(state): State<AppState>, jar: PrivateCookieJar) -> Response {
    if let Some(c) = jar.get("admin_session") {
        storage::revoke_oidc_session_by_token(c.value());
    }
    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };
    let mut response = Redirect::to(&format!("{}/", state.app_base)).into_response();

    // 1. Clear cookie at the current app base path
    let clear_cookie_base = format!(
        "admin_session=; Path={}; Max-Age=0; HttpOnly; SameSite=Lax",
        cookie_path
    );
    if let Ok(val) = axum::http::HeaderValue::from_str(&clear_cookie_base) {
        response
            .headers_mut()
            .append(axum::http::header::SET_COOKIE, val);
    }

    // 2. If the app base path is not root, also clear cookie at root path "/"
    // to clean up any legacy cookies or cookies set by previous buggy passkey logins.
    if cookie_path != "/" {
        let clear_cookie_root = "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
        if let Ok(val) = axum::http::HeaderValue::from_str(clear_cookie_root) {
            response
                .headers_mut()
                .append(axum::http::header::SET_COOKIE, val);
        }
    }

    response
}

#[derive(Deserialize)]
struct RegisterFormData {
    email: String,
    password: String,
    confirm_password: Option<String>,
}

async fn register_form(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    if get_session_user_id(&jar).await.is_some() {
        return Redirect::to(&format!("{}/", state.app_base)).into_response();
    }
    default_index(State(state)).await.into_response()
}

async fn register_submit(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Form(form): Form<RegisterFormData>,
) -> impl IntoResponse {
    if form.email.trim().is_empty() || form.password.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "Email and password cannot be empty",
        )
            .into_response();
    }

    if let Some(ref confirm) = form.confirm_password {
        if &form.password != confirm {
            return (StatusCode::BAD_REQUEST, "Passwords do not match").into_response();
        }
    }

    if storage::find_user_by_email(&form.email).is_some() {
        return (
            StatusCode::CONFLICT,
            "A user with this email already exists",
        )
            .into_response();
    }

    let password_hash = match bcrypt::hash(&form.password, bcrypt::DEFAULT_COST) {
        Ok(h) => h,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to process password",
            )
                .into_response();
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let new_user = models::User {
        id: user_id.clone(),
        email: form.email.trim().to_string(),
        password_hash,
        created_at: "".to_string(),
        is_admin: false,
    };

    if let Err(e) = storage::save_user(&new_user) {
        error!("Failed to save new user: {:?}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to register account",
        )
            .into_response();
    }

    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };
    let cookie = Cookie::build(("admin_session", user_id))
        .path(cookie_path)
        .http_only(true)
        .secure(is_cookie_secure())
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(30))
        .build();
    let updated_jar = jar.add(cookie);
    (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response()
}

async fn login_google(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let config = match &state.google_oauth {
        Some(c) => c,
        None => {
            warn!("Google OAuth login requested but Google OAuth is not configured");
            return Redirect::to(&format!(
                "{}/login?error=Google+OAuth+not+configured",
                state.app_base
            ))
            .into_response();
        }
    };

    info!("Google OAuth login initiated");

    let state_token = uuid::Uuid::new_v4().to_string();
    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };

    let state_cookie = Cookie::build(("oauth_state", state_token.clone()))
        .path(cookie_path)
        .http_only(true)
        .secure(is_cookie_secure())
        .same_site(SameSite::Lax)
        .build();

    let mut auth_url = match reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth") {
        Ok(u) => u,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid Google auth URL").into_response();
        }
    };
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", &config.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state_token)
        .append_pair("prompt", "select_account");

    let updated_jar = jar.add(state_cookie);
    (updated_jar, Redirect::to(auth_url.as_str())).into_response()
}

#[derive(Deserialize)]
struct GoogleCallbackQuery {
    code: String,
    state: String,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    email: String,
    email_verified: Option<bool>,
}

async fn login_google_callback(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Query(query): Query<GoogleCallbackQuery>,
) -> impl IntoResponse {
    let config = match &state.google_oauth {
        Some(c) => c,
        None => {
            warn!("Google OAuth callback received but Google OAuth is not configured");
            return Redirect::to(&format!(
                "{}/login?error=Google+OAuth+not+configured",
                state.app_base
            ))
            .into_response();
        }
    };

    info!("Google OAuth callback received");

    let stored_state = jar.get("oauth_state").map(|c| c.value().to_string());

    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };
    let clear_state_cookie = Cookie::build("oauth_state").path(cookie_path).build();
    let jar = jar.remove(clear_state_cookie);

    if stored_state.is_none() || stored_state.unwrap() != query.state {
        warn!("CSRF state mismatch in Google OAuth callback");
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error=Invalid+session+state",
                state.app_base
            )),
        )
            .into_response();
    }

    let mut dummy_url = match reqwest::Url::parse("http://localhost") {
        Ok(u) => u,
        Err(_) => {
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Internal+server+error",
                    state.app_base
                )),
            )
                .into_response();
        }
    };
    dummy_url
        .query_pairs_mut()
        .append_pair("code", &query.code)
        .append_pair("client_id", &config.client_id)
        .append_pair("client_secret", &config.client_secret)
        .append_pair("redirect_uri", &config.redirect_uri)
        .append_pair("grant_type", "authorization_code");

    let body_str = dummy_url.query().unwrap_or("").to_string();

    let client = reqwest::Client::new();
    let token_res = match client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body_str)
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to contact Google token endpoint: {:?}", e);
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Failed+to+exchange+code+with+Google",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    if !token_res.status().is_success() {
        let err_text = token_res.text().await.unwrap_or_default();
        error!("Google token endpoint returned error: {}", err_text);
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error=Google+login+failed",
                state.app_base
            )),
        )
            .into_response();
    }

    let token_json: GoogleTokenResponse = match token_res.json().await {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to parse token response: {:?}", e);
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Invalid+token+response+from+Google",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    let user_info_res = match client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(token_json.access_token)
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to fetch userinfo from Google: {:?}", e);
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Failed+to+get+user+profile",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    if !user_info_res.status().is_success() {
        error!(
            "Google userinfo endpoint returned error status: {}",
            user_info_res.status()
        );
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error=Failed+to+retrieve+profile+information",
                state.app_base
            )),
        )
            .into_response();
    }

    let user_info: GoogleUserInfo = match user_info_res.json().await {
        Ok(u) => u,
        Err(e) => {
            error!("Failed to parse userinfo response: {:?}", e);
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Invalid+profile+data+from+Google",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    if user_info.email_verified == Some(false) {
        warn!("Google email is not verified: {}", user_info.email);
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error=Google+email+is+not+verified",
                state.app_base
            )),
        )
            .into_response();
    }

    let user = match storage::find_user_by_email(&user_info.email) {
        Some(u) => u,
        None => {
            let user_id = uuid::Uuid::new_v4().to_string();
            let new_user = models::User {
                id: user_id.clone(),
                email: user_info.email.trim().to_string(),
                password_hash: "".to_string(),
                created_at: "".to_string(),
                is_admin: false,
            };
            let _ = storage::save_user(&new_user);
            new_user
        }
    };

    info!("OAuth login successful for user: {}", user.email);
    let cookie = Cookie::build(("admin_session", user.id))
        .path(cookie_path)
        .http_only(true)
        .secure(is_cookie_secure())
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(30))
        .build();
    let updated_jar = jar.add(cookie);
    (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response()
}

async fn login_oidc(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let config = match &state.oidc {
        Some(c) => c,
        None => {
            warn!("OIDC login requested but OIDC is not configured");
            return Redirect::to(&format!(
                "{}/login?error=OIDC+not+configured",
                state.app_base
            ))
            .into_response();
        }
    };

    info!(
        "OIDC login initiated for provider: {}",
        config.provider_name
    );

    let (auth_endpoint, _, _) = match config.resolve_endpoints().await {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to resolve OIDC endpoints: {}", e);
            return Redirect::to(&format!(
                "{}/login?error=OIDC+discovery+failed",
                state.app_base
            ))
            .into_response();
        }
    };

    let state_token = uuid::Uuid::new_v4().to_string();
    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };

    // Generate PKCE code_verifier using cryptographically random UUIDs
    // Two UUID v4s give us 32 random bytes (each UUID v4 has 122 bits of randomness)
    let code_verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().as_simple(),
        uuid::Uuid::new_v4().as_simple()
    );
    // Compute code_challenge = BASE64URL(SHA256(code_verifier))
    let mut hasher = sha2::Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let challenge_hash = hasher.finalize();
    let code_challenge = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        challenge_hash,
    );

    let state_cookie = Cookie::build(("oidc_state", state_token.clone()))
        .path(cookie_path)
        .http_only(true)
        .secure(is_cookie_secure())
        .same_site(SameSite::Lax)
        .build();

    let verifier_cookie = Cookie::build(("oidc_verifier", code_verifier))
        .path(cookie_path)
        .http_only(true)
        .secure(is_cookie_secure())
        .same_site(SameSite::Lax)
        .build();

    let mut auth_url = match reqwest::Url::parse(&auth_endpoint) {
        Ok(u) => u,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid OIDC auth URL").into_response();
        }
    };

    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", &config.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &config.scopes)
        .append_pair("state", &state_token)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256");

    let updated_jar = jar.add(state_cookie).add(verifier_cookie);
    (updated_jar, Redirect::to(auth_url.as_str())).into_response()
}

#[derive(Deserialize)]
struct OidcCallbackQuery {
    code: Option<String>,
    state: String,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize, Debug)]
struct OidcTokenResponse {
    access_token: String,
    #[allow(dead_code)]
    token_type: Option<String>,
    id_token: Option<String>,
}

#[derive(Deserialize, Debug, Default, Clone)]
struct OidcUserInfo {
    sub: Option<String>,
    sid: Option<String>,
    email: Option<String>,
    email_verified: Option<bool>,
    preferred_username: Option<String>,
    #[allow(dead_code)]
    name: Option<String>,
    #[serde(default)]
    groups: Option<serde_json::Value>,
    #[serde(default)]
    roles: Option<serde_json::Value>,
}

impl OidcUserInfo {
    fn extract_groups(&self) -> Vec<String> {
        let mut out = Vec::new();
        for claim in [&self.groups, &self.roles].into_iter().flatten() {
            match claim {
                serde_json::Value::Array(arr) => {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            let trimmed = s.trim();
                            if !trimmed.is_empty() {
                                out.push(trimmed.to_string());
                            }
                        } else if let Some(obj) = item.as_object() {
                            if let Some(name) = obj.get("name").and_then(|v| v.as_str()) {
                                let trimmed = name.trim();
                                if !trimmed.is_empty() {
                                    out.push(trimmed.to_string());
                                }
                            } else if let Some(val) = obj.get("value").and_then(|v| v.as_str()) {
                                let trimmed = val.trim();
                                if !trimmed.is_empty() {
                                    out.push(trimmed.to_string());
                                }
                            }
                        }
                    }
                }
                serde_json::Value::String(s) => {
                    for part in s.split([',', ' ']) {
                        let trimmed = part.trim();
                        if !trimmed.is_empty() {
                            out.push(trimmed.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
        out
    }
}

fn resolve_startup_admin_credentials(
    admin_email_env: Option<String>,
    admin_password_hash_env: Option<String>,
    oidc_configured: bool,
) -> Result<(String, String), String> {
    if let Some(email) = admin_email_env
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        let password_hash = match admin_password_hash_env.filter(|s| !s.trim().is_empty()) {
            Some(hash) => hash,
            None => {
                warn!(
                    "ADMIN_PASSWORD_HASH is not set. Creating a default temporary password 'admin'. Please set this in production!"
                );
                bcrypt::hash("admin", bcrypt::DEFAULT_COST).unwrap()
            }
        };
        Ok((email, password_hash))
    } else if oidc_configured {
        info!(
            "Starting without ADMIN_EMAIL/ADMIN_PASSWORD_HASH because OIDC is configured. Users in the configured OIDC admin group will be granted admin privileges."
        );
        Ok((String::new(), String::new()))
    } else {
        error!("ADMIN_EMAIL environment variable is not set and OIDC is not configured!");
        Err("Missing required environment variable: ADMIN_EMAIL".to_string())
    }
}

async fn login_oidc_callback(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Query(query): Query<OidcCallbackQuery>,
) -> impl IntoResponse {
    let config = match &state.oidc {
        Some(c) => c,
        None => {
            warn!("OIDC callback received but OIDC is not configured");
            return Redirect::to(&format!(
                "{}/login?error=OIDC+not+configured",
                state.app_base
            ))
            .into_response();
        }
    };

    info!(
        "OIDC callback received for provider: {}",
        config.provider_name
    );

    let stored_state = jar.get("oidc_state").map(|c| c.value().to_string());

    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };
    let clear_state_cookie = Cookie::build("oidc_state").path(cookie_path).build();
    let stored_verifier = jar.get("oidc_verifier").map(|c| c.value().to_string());
    let clear_verifier_cookie = Cookie::build("oidc_verifier").path(cookie_path).build();
    let jar = jar.remove(clear_state_cookie).remove(clear_verifier_cookie);

    // Handle error responses from OIDC provider (e.g. missing PKCE, invalid request)
    if let Some(ref err) = query.error {
        let desc = query
            .error_description
            .as_deref()
            .unwrap_or("Unknown error");
        warn!("OIDC provider returned error: {} - {}", err, desc);
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error={}",
                state.app_base,
                url::form_urlencoded::byte_serialize(desc.as_bytes()).collect::<String>()
            )),
        )
            .into_response();
    }

    let auth_code = match query.code {
        Some(ref c) => c.clone(),
        None => {
            warn!("OIDC callback missing both code and error");
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Missing+authorization+code",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    if stored_state.is_none() || stored_state.unwrap() != query.state {
        warn!("CSRF state mismatch in OIDC callback");
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error=Invalid+session+state",
                state.app_base
            )),
        )
            .into_response();
    }

    let (_, token_endpoint, userinfo_endpoint) = match config.resolve_endpoints().await {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to resolve OIDC endpoints during callback: {}", e);
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=OIDC+endpoints+unavailable",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    let mut dummy_url = match reqwest::Url::parse("http://localhost") {
        Ok(u) => u,
        Err(_) => {
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Internal+server+error",
                    state.app_base
                )),
            )
                .into_response();
        }
    };
    dummy_url
        .query_pairs_mut()
        .append_pair("code", &auth_code)
        .append_pair("client_id", &config.client_id)
        .append_pair("client_secret", &config.client_secret)
        .append_pair("redirect_uri", &config.redirect_uri)
        .append_pair("grant_type", "authorization_code");

    // Include PKCE code_verifier if we stored one during the authorization request
    if let Some(ref verifier) = stored_verifier {
        dummy_url
            .query_pairs_mut()
            .append_pair("code_verifier", verifier);
    }

    let body_str = dummy_url.query().unwrap_or("").to_string();

    let client = reqwest::Client::new();
    let token_res = match client
        .post(&token_endpoint)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body_str)
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to contact OIDC token endpoint: {:?}", e);
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Failed+to+exchange+code+with+OIDC+provider",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    if !token_res.status().is_success() {
        let err_text = token_res.text().await.unwrap_or_default();
        error!("OIDC token endpoint returned error: {}", err_text);
        return (
            jar,
            Redirect::to(&format!("{}/login?error=OIDC+login+failed", state.app_base)),
        )
            .into_response();
    }

    let token_json: OidcTokenResponse = match token_res.json().await {
        Ok(t) => t,
        Err(e) => {
            error!("Failed to parse token response: {:?}", e);
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Invalid+token+response+from+OIDC+provider",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    // Attempt to fetch userinfo from userinfo endpoint
    let mut endpoint_user_info: Option<OidcUserInfo> = None;
    if let Some(ref u_endpoint) = userinfo_endpoint {
        if let Ok(res) = client
            .get(u_endpoint)
            .bearer_auth(&token_json.access_token)
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(info) = res.json::<OidcUserInfo>().await {
                    endpoint_user_info = Some(info);
                }
            }
        }
    }

    // Also decode claims from id_token payload (for fallback identity or group claims)
    let mut id_token_user_info: Option<OidcUserInfo> = None;
    if let Some(ref id_tok) = token_json.id_token {
        let parts: Vec<&str> = id_tok.split('.').collect();
        if parts.len() >= 2 {
            if let Ok(decoded) =
                base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, parts[1])
            {
                if let Ok(info) = serde_json::from_slice::<OidcUserInfo>(&decoded) {
                    id_token_user_info = Some(info);
                }
            }
        }
    }

    let mut all_groups = Vec::new();
    if let Some(ref info) = endpoint_user_info {
        all_groups.extend(info.extract_groups());
    }
    if let Some(ref info) = id_token_user_info {
        for g in info.extract_groups() {
            if !all_groups
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&g))
            {
                all_groups.push(g);
            }
        }
    }

    let resolved_user_info = match (endpoint_user_info, id_token_user_info) {
        (Some(mut ep), Some(idt)) => {
            if ep.email.as_deref().unwrap_or("").trim().is_empty() {
                ep.email = idt.email;
            }
            if ep.email_verified.is_none() {
                ep.email_verified = idt.email_verified;
            }
            if ep
                .preferred_username
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
            {
                ep.preferred_username = idt.preferred_username;
            }
            if ep.sub.as_deref().unwrap_or("").trim().is_empty() {
                ep.sub = idt.sub;
            }
            if ep.sid.as_deref().unwrap_or("").trim().is_empty() {
                ep.sid = idt.sid;
            }
            Some(ep)
        }
        (Some(ep), None) => Some(ep),
        (None, Some(idt)) => Some(idt),
        (None, None) => None,
    };

    let user_info = match resolved_user_info {
        Some(u) => u,
        None => {
            error!("Failed to retrieve user profile information from OIDC provider");
            return (
                jar,
                Redirect::to(&format!(
                    "{}/login?error=Failed+to+retrieve+profile+information",
                    state.app_base
                )),
            )
                .into_response();
        }
    };

    if user_info.email_verified == Some(false) {
        warn!("OIDC email is not verified: {:?}", user_info.email);
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error=OIDC+email+is+not+verified",
                state.app_base
            )),
        )
            .into_response();
    }

    let email = if let Some(ref e) = user_info.email {
        if !e.trim().is_empty() {
            e.trim().to_string()
        } else {
            user_info
                .preferred_username
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_string()
        }
    } else if let Some(ref u) = user_info.preferred_username {
        u.trim().to_string()
    } else if let Some(ref s) = user_info.sub {
        s.trim().to_string()
    } else {
        "".to_string()
    };

    if email.is_empty() {
        return (
            jar,
            Redirect::to(&format!(
                "{}/login?error=No+valid+user+identity+returned+from+OIDC+provider",
                state.app_base
            )),
        )
            .into_response();
    }

    let target_admin_group = config.admin_group.trim();
    let is_oidc_group_admin = !target_admin_group.is_empty()
        && all_groups
            .iter()
            .any(|g| g.eq_ignore_ascii_case(target_admin_group));
    let is_env_email_admin = std::env::var("ADMIN_EMAIL")
        .ok()
        .map(|e| e.trim().to_string())
        .filter(|e| !e.is_empty())
        .is_some_and(|admin_email| email.eq_ignore_ascii_case(&admin_email));
    let should_be_admin = is_oidc_group_admin || is_env_email_admin;

    let user = match storage::find_user_by_email(&email) {
        Some(mut u) => {
            if u.is_admin != should_be_admin {
                u.is_admin = should_be_admin;
                let _ = storage::save_user(&u);
            }
            u
        }
        None => {
            let user_id = uuid::Uuid::new_v4().to_string();
            let new_user = models::User {
                id: user_id.clone(),
                email: email.clone(),
                password_hash: "".to_string(),
                created_at: "".to_string(),
                is_admin: should_be_admin,
            };
            let _ = storage::save_user(&new_user);
            new_user
        }
    };

    info!(
        "OIDC login successful for user: {} (is_admin: {}, groups: {:?})",
        user.email, user.is_admin, all_groups
    );
    let session_token = storage::create_oidc_session(
        &user.id,
        user_info.sub.as_deref().or(Some(email.as_str())),
        user_info.sid.as_deref(),
    );
    let cookie = Cookie::build(("admin_session", session_token))
        .path(cookie_path)
        .http_only(true)
        .secure(is_cookie_secure())
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(30))
        .build();
    let updated_jar = jar.add(cookie);
    (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response()
}

#[derive(Deserialize, Debug)]
struct OidcLogoutTokenClaims {
    iss: Option<String>,
    sub: Option<String>,
    aud: Option<serde_json::Value>,
    #[allow(dead_code)]
    iat: Option<i64>,
    exp: Option<i64>,
    #[allow(dead_code)]
    jti: Option<String>,
    events: Option<serde_json::Value>,
    sid: Option<String>,
    nonce: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct BackchannelLogoutForm {
    logout_token: Option<String>,
}

fn backchannel_error_response(desc: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({
            "error": "invalid_request",
            "error_description": desc,
        })),
    )
        .into_response()
}

pub(crate) async fn logout_oidc_backchannel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let config = match &state.oidc {
        Some(c) => c,
        None => {
            warn!("OIDC back-channel logout received but OIDC is not configured");
            return backchannel_error_response("OIDC is not configured");
        }
    };

    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let logout_token = if content_type.contains("application/json") {
        serde_json::from_slice::<BackchannelLogoutForm>(&body)
            .ok()
            .and_then(|f| f.logout_token)
    } else {
        url::form_urlencoded::parse(&body)
            .find(|(k, _)| k == "logout_token")
            .map(|(_, v)| v.to_string())
            .or_else(|| {
                serde_json::from_slice::<BackchannelLogoutForm>(&body)
                    .ok()
                    .and_then(|f| f.logout_token)
            })
    };

    let Some(token) = logout_token
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
    else {
        warn!("OIDC back-channel logout missing logout_token parameter");
        return backchannel_error_response("Missing logout_token parameter");
    };

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        warn!("OIDC back-channel logout_token is not a valid JWT");
        return backchannel_error_response("Malformed logout_token JWT");
    }

    let payload_bytes =
        match base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, parts[1])
            .or_else(|_| {
                base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE, parts[1])
            }) {
            Ok(b) => b,
            Err(_) => {
                warn!("Failed to base64url-decode OIDC logout_token payload");
                return backchannel_error_response("Invalid logout_token payload encoding");
            }
        };

    let claims: OidcLogoutTokenClaims = match serde_json::from_slice(&payload_bytes) {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to parse OIDC logout_token JSON claims: {:?}", e);
            return backchannel_error_response("Invalid logout_token claims JSON");
        }
    };

    // OIDC Back-Channel Logout 1.0 Section 2.6 validations:
    // 1. Verify that the Logout Token doesn't contain a nonce Claim.
    if claims.nonce.is_some() {
        warn!("OIDC logout_token rejected: contains prohibited nonce claim");
        return backchannel_error_response("logout_token must not contain a nonce claim");
    }

    // 2. Verify that the Logout Token contains an events Claim with member
    //    "http://schemas.openid.net/event/backchannel-logout" whose value is a JSON object.
    let valid_event = claims
        .events
        .as_ref()
        .and_then(|ev| ev.as_object())
        .and_then(|obj| obj.get("http://schemas.openid.net/event/backchannel-logout"))
        .is_some_and(|val| val.is_object());
    if !valid_event {
        warn!("OIDC logout_token rejected: missing or invalid backchannel-logout event claim");
        return backchannel_error_response(
            "Missing or invalid http://schemas.openid.net/event/backchannel-logout event claim",
        );
    }

    // 3. Verify that the Logout Token contains a sub Claim, a sid Claim, or both.
    let has_sub = claims.sub.as_deref().is_some_and(|s| !s.trim().is_empty());
    let has_sid = claims.sid.as_deref().is_some_and(|s| !s.trim().is_empty());
    if !has_sub && !has_sid {
        warn!("OIDC logout_token rejected: neither sub nor sid claim present");
        return backchannel_error_response("logout_token must contain sub, sid, or both");
    }

    // 4. Verify aud matches client_id if aud is present.
    if let Some(ref aud) = claims.aud {
        let aud_matches = match aud {
            serde_json::Value::String(s) => s == &config.client_id,
            serde_json::Value::Array(arr) => arr
                .iter()
                .any(|v| v.as_str() == Some(config.client_id.as_str())),
            _ => false,
        };
        if !aud_matches {
            warn!(
                "OIDC logout_token rejected: aud {:?} does not match client_id '{}'",
                aud, config.client_id
            );
            return backchannel_error_response("logout_token audience mismatch");
        }
    }

    // 5. Verify iss matches configured issuer_url if both are present.
    if let (Some(expected_iss), Some(token_iss)) = (&config.issuer_url, &claims.iss) {
        if !expected_iss.trim().is_empty()
            && token_iss.trim_end_matches('/') != expected_iss.trim_end_matches('/')
        {
            warn!(
                "OIDC logout_token rejected: iss '{}' does not match configured issuer '{}'",
                token_iss, expected_iss
            );
            return backchannel_error_response("logout_token issuer mismatch");
        }
    }

    // 6. Verify exp if present.
    if let Some(exp) = claims.exp {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        if exp <= now {
            warn!(
                "OIDC logout_token rejected: token expired (exp={}, now={})",
                exp, now
            );
            return backchannel_error_response("logout_token has expired");
        }
    }

    let revoked = storage::revoke_oidc_sessions(claims.sub.as_deref(), claims.sid.as_deref());
    info!(
        "OIDC back-channel logout processed for provider '{}' (sub: {:?}, sid: {:?}, revoked_sessions: {})",
        config.provider_name, claims.sub, claims.sid, revoked
    );

    (
        StatusCode::OK,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({
            "status": "ok",
            "revoked_sessions": revoked,
        })),
    )
        .into_response()
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "recipemanager=info,tower_http=info".into()),
        )
        .init();

    // Ensure data directories exist (important for volume mounts)
    let _ = std::fs::create_dir_all("data/recipes");
    let _ = std::fs::create_dir_all("data/uploads");
    let _ = std::fs::create_dir_all("frontend/dist");

    // Generate a random key for signed cookies if not provided
    // In production, SESSION_SECRET should be set so sessions persist across restarts
    let key = if let Ok(secret) = std::env::var("SESSION_SECRET") {
        let mut key_bytes = [0u8; 64];
        let secret_bytes = secret.as_bytes();
        let len = std::cmp::min(secret_bytes.len(), 64);
        key_bytes[..len].copy_from_slice(&secret_bytes[..len]);
        Key::from(&key_bytes)
    } else {
        warn!(
            "SESSION_SECRET not set. Using a random key for signed cookies. Sessions will be invalidated on server restart."
        );
        Key::generate()
    };

    let app_base = std::env::var("APP_BASE").unwrap_or_default();
    let app_base = if !app_base.is_empty() && !app_base.starts_with('/') {
        format!("/{}", app_base)
    } else {
        app_base
    };
    let app_base: &'static str =
        Box::leak(app_base.trim_end_matches('/').to_string().into_boxed_str());

    let oidc = {
        let client_id = std::env::var("OIDC_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let client_secret = std::env::var("OIDC_CLIENT_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty());

        if let (Some(client_id), Some(client_secret)) = (client_id, client_secret) {
            let provider_name =
                std::env::var("OIDC_PROVIDER_NAME").unwrap_or_else(|_| "OIDC".to_string());

            let redirect_uri = std::env::var("OIDC_REDIRECT_URI").unwrap_or_else(|_| {
                let base = if app_base.is_empty() {
                    "http://localhost:3000"
                } else {
                    app_base
                };
                format!("{}/login/oidc/callback", base)
            });

            let scopes = std::env::var("OIDC_SCOPES")
                .unwrap_or_else(|_| "openid email profile groups".to_string());

            let admin_group = resolve_oidc_admin_group();

            let issuer_url = std::env::var("OIDC_ISSUER_URL").ok();

            let auth_url = std::env::var("OIDC_AUTH_URL").ok();
            let token_url = std::env::var("OIDC_TOKEN_URL").ok();
            let userinfo_url = std::env::var("OIDC_USERINFO_URL").ok();

            let mut config = OidcConfig {
                provider_name,
                client_id,
                client_secret,
                redirect_uri,
                scopes,
                admin_group,
                issuer_url,
                auth_url,
                token_url,
                userinfo_url,
            };

            match config.resolve_endpoints().await {
                Ok((a, t, u)) => {
                    info!(
                        "OIDC provider '{}' configured with endpoints (auth: {}, token: {}, admin_group: '{}')",
                        config.provider_name, a, t, config.admin_group
                    );
                    config.auth_url = Some(a);
                    config.token_url = Some(t);
                    if u.is_some() {
                        config.userinfo_url = u;
                    }
                }
                Err(e) => {
                    warn!(
                        "OIDC provider '{}' registered, but endpoint resolution failed at startup: {}. Will retry on demand.",
                        config.provider_name, e
                    );
                }
            }

            Some(config)
        } else {
            None
        }
    };

    let (admin_email, password_hash) = match resolve_startup_admin_credentials(
        std::env::var("ADMIN_EMAIL").ok(),
        std::env::var("ADMIN_PASSWORD_HASH").ok(),
        oidc.is_some(),
    ) {
        Ok(creds) => creds,
        Err(msg) => panic!("{}", msg),
    };

    let google_oauth = if let (Ok(client_id), Ok(client_secret)) = (
        std::env::var("GOOGLE_CLIENT_ID"),
        std::env::var("GOOGLE_CLIENT_SECRET"),
    ) {
        let redirect_uri = match std::env::var("GOOGLE_REDIRECT_URI") {
            Ok(uri) => uri,
            Err(_) => {
                let base = if app_base.is_empty() {
                    "http://localhost:3000"
                } else {
                    app_base
                };
                format!("{}/login/google/callback", base)
            }
        };

        info!("Google OAuth enabled");
        Some(GoogleOauthConfig {
            client_id,
            client_secret,
            redirect_uri,
            admin_email: admin_email.clone(),
        })
    } else {
        info!("Google OAuth is not configured. Falling back to standard password login.");
        None
    };

    let rp_id = std::env::var("WEBAUTHN_RP_ID").unwrap_or_else(|_| "localhost".to_string());
    let rp_origin_str =
        std::env::var("WEBAUTHN_RP_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".to_string());
    let rp_origin = url::Url::parse(&rp_origin_str).expect("Invalid WEBAUTHN_RP_ORIGIN URL");
    let webauthn_builder = webauthn_rs::WebauthnBuilder::new(&rp_id, &rp_origin)
        .expect("Failed to create WebauthnBuilder");
    let webauthn_builder = webauthn_builder.rp_name("Recipe Manager");
    let webauthn = std::sync::Arc::new(webauthn_builder.build().expect("Failed to build Webauthn"));

    let reg_states = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    let auth_states = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));

    let api_token = std::env::var("API_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    if api_token.is_none() {
        warn!("API_TOKEN is not set. Bearer-token API access is disabled.");
    }

    let state = AppState {
        key,
        password_hash,
        app_base,
        google_oauth,
        oidc,
        webauthn,
        reg_states,
        auth_states,
        api_token,
    };

    storage::db_init(&state.password_hash, &admin_email).unwrap();

    let protected_routes = Router::new()
        .route("/upload", post(upload_image))
        .route("/upload-csv", post(upload_csv))
        .route("/import/photo", post(import_photo))
        .route("/import/paprika", post(import_paprika))
        .route("/api/v1/auth/passkeys", get(passkeys::passkeys_list))
        .route(
            "/api/v1/auth/passkeys/register/start",
            post(passkeys::passkeys_register_start),
        )
        .route(
            "/api/v1/auth/passkeys/register/finish",
            post(passkeys::passkeys_register_finish),
        )
        .route(
            "/api/v1/auth/passkeys/{id}",
            delete(passkeys::passkeys_delete),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin));

    let static_assets = Router::new()
        .nest_service("/static", ServeDir::new("static"))
        .nest_service("/uploads", ServeDir::new("data/uploads"))
        .nest_service("/data/uploads", ServeDir::new("data/uploads"))
        .nest_service("/assets", ServeDir::new("frontend/dist/assets"))
        .nest_service("/app/assets", ServeDir::new("frontend/dist/assets"))
        .nest_service(
            "/app",
            ServeDir::new("frontend/dist").fallback(ServeFile::new("frontend/dist/index.html")),
        );

    let public_routes = Router::new()
        .route("/", get(default_index))
        .route("/new", get(default_index))
        .route("/edit/{id}", get(default_index))
        .route("/meal-plan", get(default_index))
        .route("/meal-plan/", get(default_index))
        .route("/shopping-list", get(default_index))
        .route("/shopping-list/", get(default_index))
        .route("/temps", get(default_index))
        .route("/temps/", get(default_index))
        .route("/cooking-temps", get(default_index))
        .route("/cooking-temps/", get(default_index))
        .route("/recipe/{id}", get(default_index))
        .route("/recipe/{id}/edit", get(default_index))
        .route("/admin/users", get(admin_users_page))
        .route("/admin/users/", get(admin_users_page))
        .route("/recipe/favorite/{id}", post(toggle_favorite))
        .route("/login", get(login_form).post(login_submit))
        .route("/login/google", get(login_google))
        .route("/login/google/callback", get(login_google_callback))
        .route("/login/oidc", get(login_oidc))
        .route("/login/oidc/callback", get(login_oidc_callback))
        .route("/logout/oidc/backchannel", post(logout_oidc_backchannel))
        .route("/oidc/backchannel-logout", post(logout_oidc_backchannel))
        .route(
            "/login/oidc/backchannel-logout",
            post(logout_oidc_backchannel),
        )
        .route("/register", get(register_form).post(register_submit))
        .route("/logout", get(logout).post(logout))
        .route("/export", get(export_data_page))
        .route("/spa", get(redirect_to_app))
        .route("/spa/", get(redirect_to_app))
        .route("/api", get(api_guide))
        .route("/api/", get(api_guide))
        .route("/api/docs", get(docs_page))
        .route(
            "/api/v1/auth/passkeys/login/start",
            post(passkeys::passkeys_login_start),
        )
        .route(
            "/api/v1/auth/passkeys/login/finish",
            post(passkeys::passkeys_login_finish),
        )
        .merge(static_assets);

    let mut app = Router::new()
        .merge(public_routes.clone().with_state(state.clone()))
        .merge(protected_routes.clone().with_state(state.clone()))
        .nest(
            "/api/v1",
            api::router(state.clone()).with_state(state.clone()),
        );

    if !state.app_base.is_empty() {
        let base = state.app_base.trim_end_matches('/');
        let sub_app = Router::new()
            .merge(public_routes.with_state(state.clone()))
            .merge(protected_routes.with_state(state.clone()))
            .nest(
                "/api/v1",
                api::router(state.clone()).with_state(state.clone()),
            );
        app = app.nest(base, sub_app);
    }

    let app = app
        .fallback(spa_fallback)
        .with_state(state)
        .layer(axum::middleware::from_fn(add_security_headers))
        .layer(axum::middleware::from_fn(csrf_header_check))
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(1024 * 1024 * 250)); // 250 MB limit

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Server starting at http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn redirect_to_app(State(state): State<AppState>) -> impl IntoResponse {
    let target = if state.app_base.is_empty() {
        "/app/".to_string()
    } else {
        format!("{}/app/", state.app_base)
    };
    Redirect::temporary(&target)
}

async fn export_data_page(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return Redirect::to(&format!("{}/login", state.app_base)).into_response(),
    };
    info!("Web export_data_page: user_id='{}'", user_id);
    match storage::export_user_data(&user_id) {
        Ok(export) => match serde_json::to_string_pretty(&export) {
            Ok(json_str) => {
                let prefix = &user_id[..8.min(user_id.len())];
                let filename = format!("recipe_manager_export_{}.json", prefix);
                Response::builder()
                    .status(StatusCode::OK)
                    .header(
                        axum::http::header::CONTENT_TYPE,
                        "application/json; charset=utf-8",
                    )
                    .header(
                        axum::http::header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{}\"", filename),
                    )
                    .body(axum::body::Body::from(json_str))
                    .unwrap()
                    .into_response()
            }
            Err(e) => {
                error!("Failed to serialize user export data: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to serialize export data",
                )
                    .into_response()
            }
        },
        Err(e) => {
            error!("Failed to generate user export data: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to export data").into_response()
        }
    }
}

async fn docs_page(State(state): State<AppState>) -> impl IntoResponse {
    openapi::swagger_ui(state.app_base).await
}

pub(crate) fn is_cookie_secure() -> bool {
    std::env::var("COOKIE_SECURE")
        .map(|v| v.to_lowercase() == "true")
        .unwrap_or(true)
}

async fn add_security_headers(req: Request, next: Next) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(
        "X-Frame-Options",
        axum::http::HeaderValue::from_static("SAMEORIGIN"),
    );
    headers.insert(
        "X-Content-Type-Options",
        axum::http::HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "Referrer-Policy",
        axum::http::HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert("Content-Security-Policy", axum::http::HeaderValue::from_static(
        "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://maxcdn.bootstrapcdn.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://maxcdn.bootstrapcdn.com https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self' https: http:;"
    ));
    response
}

async fn csrf_header_check(req: Request, next: Next) -> Result<Response, StatusCode> {
    let path = req.uri().path();
    if path.ends_with("/logout/oidc/backchannel")
        || path.ends_with("/oidc/backchannel-logout")
        || path.ends_with("/login/oidc/backchannel-logout")
        || path.ends_with("/auth/oidc/backchannel-logout")
    {
        return Ok(next.run(req).await);
    }

    if req.method() == axum::http::Method::POST
        || req.method() == axum::http::Method::PUT
        || req.method() == axum::http::Method::DELETE
    {
        let headers = req.headers();
        let origin = headers
            .get(axum::http::header::ORIGIN)
            .and_then(|v| v.to_str().ok());
        let referer = headers
            .get(axum::http::header::REFERER)
            .and_then(|v| v.to_str().ok());
        let host = headers
            .get(axum::http::header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let mut matched = false;

        let is_allowed = |val: &str| {
            (!host.is_empty() && val.contains(host))
                || val.contains("localhost")
                || val.contains("127.0.0.1")
                || val.contains("[::1]")
        };

        if let Some(o) = origin {
            if is_allowed(o) {
                matched = true;
            }
        } else if let Some(r) = referer {
            if is_allowed(r) {
                matched = true;
            }
        } else {
            // For simple clients or APIs without headers (like standard token actions) we let it proceed
            matched = true;
        }

        if !matched {
            warn!(
                "Blocked potential CSRF request. Origin ({:?}) and Referer ({:?}) did not match allowed host domains (Host header: {:?}).",
                origin, referer, host
            );
            return Err(StatusCode::FORBIDDEN);
        }
    }
    Ok(next.run(req).await)
}

#[cfg(test)]
mod oauth_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn build_test_app(
        google_config: Option<GoogleOauthConfig>,
        oidc_config: Option<OidcConfig>,
    ) -> Router {
        build_test_app_internal(google_config, oidc_config, "").await
    }

    async fn build_test_app_with_base(app_base: &'static str) -> Router {
        build_test_app_internal(None, None, app_base).await
    }

    async fn build_test_app_internal(
        google_config: Option<GoogleOauthConfig>,
        oidc_config: Option<OidcConfig>,
        app_base: &'static str,
    ) -> Router {
        unsafe {
            std::env::set_var("ADMIN_EMAIL", "admin@example.com");
        }
        let _ = std::fs::remove_file("data/recipes.db"); // Deterministic db state
        let _ = std::fs::create_dir_all("frontend/dist");
        let index_file = std::path::Path::new("frontend/dist/index.html");
        if !index_file.exists() {
            let _ = std::fs::write(
                index_file,
                "<!DOCTYPE html><html><head><title>SPA</title></head><body><div id=\"root\"></div></body></html>",
            );
        }
        let rp_id = "localhost".to_string();
        let rp_origin = url::Url::parse("http://localhost:3000").unwrap();
        let webauthn_builder = webauthn_rs::WebauthnBuilder::new(&rp_id, &rp_origin).unwrap();
        let webauthn = std::sync::Arc::new(webauthn_builder.build().unwrap());
        let reg_states =
            std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        let auth_states =
            std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));

        let state = AppState {
            key: axum_extra::extract::cookie::Key::generate(),
            password_hash: "".to_string(),
            app_base,
            google_oauth: google_config,
            oidc: oidc_config,
            webauthn,
            reg_states,
            auth_states,
            api_token: None,
        };

        storage::db_init(&state.password_hash, "admin@example.com").unwrap();

        let static_assets = Router::new()
            .nest_service("/static", ServeDir::new("static"))
            .nest_service("/uploads", ServeDir::new("data/uploads"))
            .nest_service("/data/uploads", ServeDir::new("data/uploads"))
            .nest_service("/assets", ServeDir::new("frontend/dist/assets"))
            .nest_service("/app/assets", ServeDir::new("frontend/dist/assets"))
            .nest_service(
                "/app",
                ServeDir::new("frontend/dist").fallback(ServeFile::new("frontend/dist/index.html")),
            );

        let public_routes = Router::new()
            .route("/", get(default_index))
            .route("/meal-plan", get(default_index))
            .route("/meal-plan/", get(default_index))
            .route("/login", get(login_form).post(login_submit))
            .route("/login/google", get(login_google))
            .route("/login/google/callback", get(login_google_callback))
            .route("/login/oidc", get(login_oidc))
            .route("/login/oidc/callback", get(login_oidc_callback))
            .route("/logout/oidc/backchannel", post(logout_oidc_backchannel))
            .route("/oidc/backchannel-logout", post(logout_oidc_backchannel))
            .route(
                "/login/oidc/backchannel-logout",
                post(logout_oidc_backchannel),
            )
            .route("/register", get(register_form).post(register_submit))
            .route("/logout", get(logout).post(logout))
            .route("/export", get(export_data_page))
            .route("/spa", get(redirect_to_app))
            .route("/spa/", get(redirect_to_app))
            .merge(static_assets);

        let mut app = Router::new().merge(public_routes).nest(
            "/api/v1",
            api::router(state.clone()).with_state(state.clone()),
        );

        if !state.app_base.is_empty() {
            let base = state.app_base.trim_end_matches('/');
            app = app
                .nest(
                    &format!("{}/api/v1", base),
                    api::router(state.clone()).with_state(state.clone()),
                )
                .route(&format!("{}", base), get(default_index))
                .route(&format!("{}/", base), get(default_index))
                .route(&format!("{}/meal-plan", base), get(default_index))
                .route(&format!("{}/meal-plan/", base), get(default_index));
        }

        app.fallback(spa_fallback).with_state(state)
    }

    #[tokio::test]
    async fn test_google_oauth_disabled_by_default() {
        let app = build_test_app(None, None).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/auth/me")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["config"]["google_auth_enabled"], false);
        assert_eq!(json["config"]["oidc_auth_enabled"], false);
    }

    #[tokio::test]
    async fn test_google_oauth_enabled_shows_button() {
        let config = GoogleOauthConfig {
            client_id: "test-client-id".to_string(),
            client_secret: "test-client-secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            admin_email: "admin@example.com".to_string(),
        };
        let app = build_test_app(Some(config), None).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/auth/me")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["config"]["google_auth_enabled"], true);
    }

    #[tokio::test]
    async fn test_google_oauth_redirect() {
        let config = GoogleOauthConfig {
            client_id: "test-client-id".to_string(),
            client_secret: "test-client-secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            admin_email: "admin@example.com".to_string(),
        };
        let app = build_test_app(Some(config), None).await;

        let req = Request::builder()
            .method("GET")
            .uri("/login/google")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let location = response
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(location.contains("accounts.google.com"));
        assert!(location.contains("client_id=test-client-id"));
        assert!(location.contains("redirect_uri=http%3A%2F%2Flocalhost%2Fcallback"));
        assert!(location.contains("state="));
        assert!(location.contains("prompt=select_account"));

        let cookie_header = response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie_header.contains("oauth_state="));
    }

    #[tokio::test]
    async fn test_google_oauth_callback_csrf_protection() {
        let config = GoogleOauthConfig {
            client_id: "test-client-id".to_string(),
            client_secret: "test-client-secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            admin_email: "admin@example.com".to_string(),
        };
        let app = build_test_app(Some(config), None).await;

        let req = Request::builder()
            .method("GET")
            .uri("/login/google/callback?code=some-code&state=mismatched-state")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let location = response
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(location.contains("/login?error=Invalid+session+state"));
    }

    #[tokio::test]
    async fn test_oidc_enabled_shows_button() {
        let oidc_config = OidcConfig {
            provider_name: "Pocket ID".to_string(),
            client_id: "oidc-client".to_string(),
            client_secret: "oidc-secret".to_string(),
            redirect_uri: "http://localhost:3000/login/oidc/callback".to_string(),
            scopes: "openid email profile".to_string(),
            admin_group: "admins".to_string(),
            issuer_url: None,
            auth_url: Some("https://id.example.com/authorize".to_string()),
            token_url: Some("https://id.example.com/api/oidc/token".to_string()),
            userinfo_url: Some("https://id.example.com/api/oidc/userinfo".to_string()),
        };
        let app = build_test_app(None, Some(oidc_config)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/auth/me")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["config"]["oidc_auth_enabled"], true);
        assert_eq!(json["config"]["oidc_provider_name"], "Pocket ID");
        assert_eq!(json["config"]["google_auth_enabled"], false);
    }

    #[tokio::test]
    async fn test_oidc_and_google_both_enabled_shows_both_buttons() {
        let google_config = GoogleOauthConfig {
            client_id: "google-client".to_string(),
            client_secret: "google-secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            admin_email: "admin@example.com".to_string(),
        };
        let oidc_config = OidcConfig {
            provider_name: "Pocket ID".to_string(),
            client_id: "oidc-client".to_string(),
            client_secret: "oidc-secret".to_string(),
            redirect_uri: "http://localhost:3000/login/oidc/callback".to_string(),
            scopes: "openid email profile".to_string(),
            admin_group: "admins".to_string(),
            issuer_url: None,
            auth_url: Some("https://id.example.com/authorize".to_string()),
            token_url: Some("https://id.example.com/api/oidc/token".to_string()),
            userinfo_url: Some("https://id.example.com/api/oidc/userinfo".to_string()),
        };
        let app = build_test_app(Some(google_config), Some(oidc_config)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/auth/me")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["config"]["oidc_auth_enabled"], true);
        assert_eq!(json["config"]["google_auth_enabled"], true);
    }

    #[tokio::test]
    async fn test_oidc_redirect() {
        let oidc_config = OidcConfig {
            provider_name: "Pocket ID".to_string(),
            client_id: "oidc-client-123".to_string(),
            client_secret: "secret-abc".to_string(),
            redirect_uri: "http://localhost:3000/login/oidc/callback".to_string(),
            scopes: "openid email profile".to_string(),
            admin_group: "admins".to_string(),
            issuer_url: None,
            auth_url: Some("https://id.example.com/authorize".to_string()),
            token_url: Some("https://id.example.com/api/oidc/token".to_string()),
            userinfo_url: Some("https://id.example.com/api/oidc/userinfo".to_string()),
        };
        let app = build_test_app(None, Some(oidc_config)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/login/oidc")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let location = response
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(location.contains("https://id.example.com/authorize"));
        assert!(location.contains("client_id=oidc-client-123"));
        assert!(
            location
                .contains("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Flogin%2Foidc%2Fcallback")
        );
        assert!(location.contains("scope=openid+email+profile"));
        assert!(location.contains("state="));
        // Verify PKCE parameters are present
        assert!(location.contains("code_challenge="));
        assert!(location.contains("code_challenge_method=S256"));

        let cookie_headers: Vec<String> = response
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect();
        let combined = cookie_headers.join(" ");
        assert!(combined.contains("oidc_state="));
        assert!(combined.contains("oidc_verifier="));
    }

    #[tokio::test]
    async fn test_oidc_callback_csrf_protection() {
        let oidc_config = OidcConfig {
            provider_name: "Pocket ID".to_string(),
            client_id: "test-client".to_string(),
            client_secret: "test-secret".to_string(),
            redirect_uri: "http://localhost:3000/login/oidc/callback".to_string(),
            scopes: "openid email profile".to_string(),
            admin_group: "admins".to_string(),
            issuer_url: None,
            auth_url: Some("https://id.example.com/authorize".to_string()),
            token_url: Some("https://id.example.com/api/oidc/token".to_string()),
            userinfo_url: Some("https://id.example.com/api/oidc/userinfo".to_string()),
        };
        let app = build_test_app(None, Some(oidc_config)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/login/oidc/callback?code=fake-code&state=mismatched-csrf-token")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let location = response
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(location.contains("/login?error=Invalid+session+state"));
    }

    #[tokio::test]
    async fn test_oidc_endpoint_resolution_from_endpoints() {
        let config = OidcConfig {
            provider_name: "Pocket ID".to_string(),
            client_id: "id".to_string(),
            client_secret: "sec".to_string(),
            redirect_uri: "uri".to_string(),
            scopes: "openid".to_string(),
            admin_group: "admins".to_string(),
            issuer_url: None,
            auth_url: Some("https://id.example.com/auth".to_string()),
            token_url: Some("https://id.example.com/token".to_string()),
            userinfo_url: Some("https://id.example.com/userinfo".to_string()),
        };

        let (auth, token, userinfo) = config.resolve_endpoints().await.unwrap();
        assert_eq!(auth, "https://id.example.com/auth");
        assert_eq!(token, "https://id.example.com/token");
        assert_eq!(
            userinfo,
            Some("https://id.example.com/userinfo".to_string())
        );
    }

    #[test]
    fn test_startup_with_oidc_without_admin_env_vars() {
        // When OIDC is configured, ADMIN_EMAIL and ADMIN_PASSWORD_HASH are optional
        let res = resolve_startup_admin_credentials(None, None, true);
        assert!(res.is_ok());
        let (email, hash) = res.unwrap();
        assert_eq!(email, "");
        assert_eq!(hash, "");

        // When OIDC is NOT configured and ADMIN_EMAIL is missing, startup fails
        let err_res = resolve_startup_admin_credentials(None, None, false);
        assert!(err_res.is_err());

        // Also verify db_init succeeds with empty admin_email and password_hash
        let _ = std::fs::create_dir_all("data");
        assert!(storage::db_init("", "").is_ok());
    }

    #[tokio::test]
    async fn test_oidc_callback_grants_admin_to_custom_group_member() {
        // Start a mock OIDC server for /token and /userinfo
        let mock_oidc = Router::new()
            .route(
                "/token",
                post(|| async {
                    Json(serde_json::json!({
                        "access_token": "mock-access-token",
                        "token_type": "Bearer"
                    }))
                }),
            )
            .route(
                "/userinfo",
                get(|| async {
                    Json(serde_json::json!({
                        "sub": "oidc-user-1",
                        "email": "chef-admin@example.com",
                        "email_verified": true,
                        "groups": ["recipe-masters", "users"]
                    }))
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, mock_oidc).await.unwrap();
        });

        let oidc_config = OidcConfig {
            provider_name: "Pocket ID".to_string(),
            client_id: "oidc-client".to_string(),
            client_secret: "oidc-secret".to_string(),
            redirect_uri: "http://localhost:3000/login/oidc/callback".to_string(),
            scopes: "openid email profile groups".to_string(),
            admin_group: "recipe-masters".to_string(),
            issuer_url: None,
            auth_url: Some(format!("http://{}/authorize", addr)),
            token_url: Some(format!("http://{}/token", addr)),
            userinfo_url: Some(format!("http://{}/userinfo", addr)),
        };

        let app = build_test_app(None, Some(oidc_config)).await;

        // 1. Initiate OIDC login to obtain signed oidc_state & oidc_verifier cookies
        let req_init = Request::builder()
            .method("GET")
            .uri("/login/oidc")
            .body(Body::empty())
            .unwrap();
        let res_init = app.clone().oneshot(req_init).await.unwrap();
        assert_eq!(res_init.status(), StatusCode::SEE_OTHER);

        let location = res_init
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let parsed_url = reqwest::Url::parse(&location).unwrap();
        let state_param = parsed_url
            .query_pairs()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.to_string())
            .unwrap();

        let cookies: Vec<String> = res_init
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
            .collect();
        let cookie_header = cookies.join("; ");

        // 2. Call /login/oidc/callback with the matching state and cookies
        let req_cb = Request::builder()
            .method("GET")
            .uri(format!(
                "/login/oidc/callback?code=valid-code&state={}",
                state_param
            ))
            .header("cookie", &cookie_header)
            .body(Body::empty())
            .unwrap();
        let res_cb = app.clone().oneshot(req_cb).await.unwrap();
        assert_eq!(res_cb.status(), StatusCode::SEE_OTHER);

        let session_cookie = res_cb
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find(|s| s.starts_with("admin_session=") && !s.starts_with("admin_session=;"))
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();

        // 3. Verify /api/v1/auth/me reports is_admin = true for the OIDC group member
        let req_me = Request::builder()
            .method("GET")
            .uri("/api/v1/auth/me")
            .header("cookie", &session_cookie)
            .body(Body::empty())
            .unwrap();
        let res_me = app.oneshot(req_me).await.unwrap();
        assert_eq!(res_me.status(), StatusCode::OK);
        let body = res_me.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["user"]["email"], "chef-admin@example.com");
        assert_eq!(json["user"]["is_admin"], true);
    }

    #[tokio::test]
    async fn test_logout_get() {
        let app = build_test_app(None, None).await;

        let req = Request::builder()
            .method("GET")
            .uri("/logout")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let location = response
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(location, "/");
        let cookie_header = response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie_header.contains("admin_session=;"));
    }

    #[tokio::test]
    async fn test_spa_routing() {
        let app = build_test_app(None, None).await;

        // / serves modern UI index.html (200 OK) with injected base and app_base
        let req_root = Request::builder().uri("/").body(Body::empty()).unwrap();
        let res_root = app.clone().oneshot(req_root).await.unwrap();
        assert_eq!(res_root.status(), StatusCode::OK);
        let root_body = res_root.into_body().collect().await.unwrap().to_bytes();
        let root_str = String::from_utf8(root_body.to_vec()).unwrap();
        assert!(root_str.contains("<base href=\"/\" />"));
        assert!(root_str.contains("window.__APP_BASE__ = \"\""));

        // /app serves index.html directly
        let req_app = Request::builder().uri("/app").body(Body::empty()).unwrap();
        let res_app = app.clone().oneshot(req_app).await.unwrap();
        assert_eq!(res_app.status(), StatusCode::OK);

        // /spa redirects to /app/
        let req_spa = Request::builder().uri("/spa").body(Body::empty()).unwrap();
        let res_spa = app.clone().oneshot(req_spa).await.unwrap();
        assert_eq!(res_spa.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            res_spa.headers().get("location").unwrap().to_str().unwrap(),
            "/app/"
        );

        // /app/ returns 200 OK index.html
        let req_slash = Request::builder().uri("/app/").body(Body::empty()).unwrap();
        let res_slash = app.clone().oneshot(req_slash).await.unwrap();
        assert_eq!(res_slash.status(), StatusCode::OK);

        // /export unauthenticated redirects to /login
        let req_export = Request::builder()
            .uri("/export")
            .body(Body::empty())
            .unwrap();
        let res_export = app.oneshot(req_export).await.unwrap();
        assert_eq!(res_export.status(), StatusCode::SEE_OTHER);
        assert_eq!(
            res_export
                .headers()
                .get("location")
                .unwrap()
                .to_str()
                .unwrap(),
            "/login"
        );
    }

    #[tokio::test]
    async fn test_spa_subpath_base_injection() {
        let app = build_test_app_with_base("/recipes").await;
        let req = Request::builder().uri("/").body(Body::empty()).unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("<base href=\"/recipes/\" />"));
        assert!(html.contains("window.__APP_BASE__ = \"/recipes\""));
    }

    fn build_mock_jwt(claims: &serde_json::Value) -> String {
        let header = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            r#"{"alg":"RS256","typ":"logout+jwt"}"#.as_bytes(),
        );
        let payload = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            serde_json::to_vec(claims).unwrap(),
        );
        format!("{}.{}.mock-signature", header, payload)
    }

    #[tokio::test]
    async fn test_oidc_backchannel_logout_revokes_active_session() {
        let id_token = build_mock_jwt(&serde_json::json!({
            "sub": "oidc-user-bc-1",
            "sid": "oidc-session-42",
            "email": "bc-user@example.com",
            "email_verified": true,
            "groups": ["users"]
        }));

        let id_token_clone = id_token.clone();
        let mock_oidc = Router::new()
            .route(
                "/token",
                post(move || {
                    let tok = id_token_clone.clone();
                    async move {
                        Json(serde_json::json!({
                            "access_token": "mock-access-token",
                            "token_type": "Bearer",
                            "id_token": tok
                        }))
                    }
                }),
            )
            .route(
                "/userinfo",
                get(|| async {
                    Json(serde_json::json!({
                        "sub": "oidc-user-bc-1",
                        "email": "bc-user@example.com",
                        "email_verified": true
                    }))
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, mock_oidc).await.unwrap();
        });

        let oidc_config = OidcConfig {
            provider_name: "Pocket ID".to_string(),
            client_id: "oidc-client".to_string(),
            client_secret: "oidc-secret".to_string(),
            redirect_uri: "http://localhost:3000/login/oidc/callback".to_string(),
            scopes: "openid email profile".to_string(),
            admin_group: "admins".to_string(),
            issuer_url: Some("https://id.example.com".to_string()),
            auth_url: Some(format!("http://{}/authorize", addr)),
            token_url: Some(format!("http://{}/token", addr)),
            userinfo_url: Some(format!("http://{}/userinfo", addr)),
        };

        let app = build_test_app(None, Some(oidc_config)).await;

        // 1. Complete OIDC login
        let res_init = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/login/oidc")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let location = res_init
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let parsed_url = reqwest::Url::parse(&location).unwrap();
        let state_param = parsed_url
            .query_pairs()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.to_string())
            .unwrap();
        let cookie_header = res_init
            .headers()
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
            .collect::<Vec<_>>()
            .join("; ");

        let res_cb = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/login/oidc/callback?code=valid-code&state={}",
                        state_param
                    ))
                    .header("cookie", &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_cb.status(), StatusCode::SEE_OTHER);

        let session_cookie = res_cb
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find(|s| s.starts_with("admin_session=") && !s.starts_with("admin_session=;"))
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();

        // 2. Verify session is authenticated before back-channel logout
        let res_me_before = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/auth/me")
                    .header("cookie", &session_cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let me_before_bytes = res_me_before
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let me_before_json: serde_json::Value = serde_json::from_slice(&me_before_bytes).unwrap();
        assert_eq!(me_before_json["user"]["email"], "bc-user@example.com");

        // 3. Reject a logout_token that contains a prohibited `nonce` claim
        let bad_logout_token = build_mock_jwt(&serde_json::json!({
            "iss": "https://id.example.com",
            "sub": "oidc-user-bc-1",
            "aud": "oidc-client",
            "iat": 1700000000,
            "jti": "logout-bad-1",
            "nonce": "prohibited-nonce",
            "events": {
                "http://schemas.openid.net/event/backchannel-logout": {}
            }
        }));
        let res_bad_bc = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/logout/oidc/backchannel")
                    .header("content-type", "application/x-www-form-urlencoded")
                    .body(Body::from(format!("logout_token={}", bad_logout_token)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_bad_bc.status(), StatusCode::BAD_REQUEST);

        // 4. Send valid OIDC back-channel logout token
        let valid_logout_token = build_mock_jwt(&serde_json::json!({
            "iss": "https://id.example.com",
            "sub": "oidc-user-bc-1",
            "sid": "oidc-session-42",
            "aud": "oidc-client",
            "iat": 1700000000,
            "jti": "logout-ok-1",
            "events": {
                "http://schemas.openid.net/event/backchannel-logout": {}
            }
        }));
        let res_bc = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/logout/oidc/backchannel")
                    .header("content-type", "application/x-www-form-urlencoded")
                    .body(Body::from(format!("logout_token={}", valid_logout_token)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_bc.status(), StatusCode::OK);
        assert_eq!(
            res_bc
                .headers()
                .get("cache-control")
                .unwrap()
                .to_str()
                .unwrap(),
            "no-store"
        );

        // 5. Verify the user's browser session is now invalidated
        let res_me_after = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/auth/me")
                    .header("cookie", &session_cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let me_after_bytes = res_me_after.into_body().collect().await.unwrap().to_bytes();
        let me_after_json: serde_json::Value = serde_json::from_slice(&me_after_bytes).unwrap();
        assert!(me_after_json["user"].is_null());
    }
}
