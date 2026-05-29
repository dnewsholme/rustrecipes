#![allow(clippy::collapsible_if)]
mod api;
mod conversions;
mod importer;
mod models;
mod storage;

use askama::Template;
use axum::{
    Form, Router,
    extract::Request,
    extract::{DefaultBodyLimit, FromRef, Multipart, Path, Query, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{Html, IntoResponse, Json, Redirect, Response},
    routing::{get, post},
};
use axum_extra::extract::cookie::{Cookie, Key, PrivateCookieJar, SameSite};
use serde::{Deserialize, Serialize};
use std::env;
use std::net::SocketAddr;
use tower_http::{services::ServeDir, trace::TraceLayer};
use tracing::{error, info, warn};

#[derive(Clone)]
struct GoogleOauthConfig {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    admin_email: String,
}

#[derive(Clone)]
struct AppState {
    key: Key,
    password_hash: String,
    app_base: &'static str,
    google_oauth: Option<GoogleOauthConfig>,
}

impl FromRef<AppState> for Key {
    fn from_ref(state: &AppState) -> Self {
        state.key.clone()
    }
}

#[derive(Template)]
#[template(path = "index.html")]
struct IndexTemplate {
    recipes: Vec<models::Recipe>,
    all_tags: Vec<String>,
    app_base: &'static str,
    app_version: String,
    is_admin: bool,
}

#[derive(Template)]
#[template(path = "recipe.html")]
struct RecipeTemplate {
    recipe: models::Recipe,
    app_base: &'static str,
    app_version: String,
    is_admin: bool,
}

#[derive(Template)]
#[template(path = "edit.html")]
struct EditTemplate {
    recipe: models::Recipe,
    is_new: bool,
    app_base: &'static str,
    app_version: String,
    is_admin: bool,
}

#[derive(Template)]
#[template(path = "api_guide.html")]
struct ApiGuideTemplate {
    app_base: &'static str,
    app_version: String,
    is_admin: bool,
}

#[derive(Template)]
#[template(path = "login.html")]
struct LoginTemplate {
    app_base: &'static str,
    app_version: String,
    error: Option<String>,
    is_admin: bool,
    google_auth_enabled: bool,
}

#[derive(Template)]
#[template(path = "register.html")]
struct RegisterTemplate {
    app_base: &'static str,
    app_version: String,
    error: Option<String>,
    is_admin: bool,
}

const APP_VERSION: &str = match option_env!("APP_VERSION") {
    Some(v) => v,
    None => env!("CARGO_PKG_VERSION"),
};

struct RecipeFormData {
    title: String,
    description: Option<String>,
    image: Option<String>,
    combustion_csv: Option<String>,
    markdown: String,
    tags: Vec<String>,
    ingredients: Vec<String>,
    servings: Option<u32>,
    prep_time: Option<String>,
    cook_time: Option<String>,
    source_url: Option<String>,
    video_url: Option<String>,
    remove_combustion_csv: bool,
    is_public: bool,
}

async fn parse_recipe_multipart(mut multipart: Multipart) -> Option<RecipeFormData> {
    let mut title = String::new();
    let mut description = None;
    let mut image = None;
    let mut combustion_csv = None;
    let mut markdown = String::new();
    let mut tags = Vec::new();
    let mut ingredients = Vec::new();
    let mut servings = None;
    let mut prep_time = None;
    let mut cook_time = None;
    let mut source_url = None;
    let mut video_url = None;
    let mut remove_combustion_csv = false;
    let mut is_public = false;

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();

        if name == "cover_image" {
            let filename = field.file_name().unwrap_or("").to_string();
            if !filename.is_empty() {
                let extension = std::path::Path::new(&filename)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("png");

                let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
                let filepath = format!("data/uploads/{}", new_filename);

                if let Ok(data) = field.bytes().await {
                    match std::fs::write(&filepath, data) {
                        Ok(_) => {
                            info!("Uploaded image saved to {}", filepath);
                            image = Some(format!("uploads/{}", new_filename));
                        }
                        Err(e) => error!("Failed to write image to {}: {:?}", filepath, e),
                    }
                }
            }
            continue;
        }

        if name == "combustion_csv_upload" {
            let filename = field.file_name().unwrap_or("").to_string();
            if !filename.is_empty() {
                let extension = std::path::Path::new(&filename)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("csv");

                let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
                let filepath = format!("data/uploads/{}", new_filename);

                if let Ok(data) = field.bytes().await {
                    match std::fs::write(&filepath, data) {
                        Ok(_) => {
                            info!("Uploaded CSV saved to {}", filepath);
                            combustion_csv = Some(format!("uploads/{}", new_filename));
                        }
                        Err(e) => error!("Failed to write CSV to {}: {:?}", filepath, e),
                    }
                }
            }
            continue;
        }

        if let Ok(text) = field.text().await {
            match name.as_str() {
                "title" => title = text,
                "description" => {
                    description = if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                }
                "existing_image" => {
                    if image.is_none() && !text.trim().is_empty() {
                        image = Some(text)
                    }
                }
                "existing_combustion_csv" => {
                    if combustion_csv.is_none() && !text.trim().is_empty() {
                        combustion_csv = Some(text)
                    }
                }
                "markdown" => markdown = text,
                "tags" => {
                    tags = text
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                "ingredients" => {
                    ingredients = text
                        .lines()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                "servings" => servings = text.parse::<u32>().ok(),
                "prep_time" => {
                    prep_time = if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                }
                "cook_time" => {
                    cook_time = if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                }
                "source_url" => {
                    source_url = if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                }
                "video_url" => {
                    video_url = if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                }
                "remove_combustion_csv" => remove_combustion_csv = text == "true",
                "is_public" => is_public = text == "true" || text == "on",
                _ => {}
            }
        }
    }

    if title.is_empty() {
        return None;
    }

    Some(RecipeFormData {
        title,
        description,
        image,
        combustion_csv,
        markdown,
        tags,
        ingredients,
        servings,
        prep_time,
        cook_time,
        source_url,
        video_url,
        remove_combustion_csv,
        is_public,
    })
}

#[derive(Deserialize)]
struct ImportForm {
    url: String,
}

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
        val == "true" || !val.is_empty()
    } else {
        // Distinguish between missing and invalid
        if jar.iter().any(|c| c.name() == "admin_session") {
            warn!("Admin session cookie present but failed to verify signature (invalid key?)");
        } else {
            warn!("Admin session cookie missing from request");
        }
        false
    }
}

async fn get_session_user_id(jar: &PrivateCookieJar) -> Option<String> {
    if let Some(c) = jar.get("admin_session") {
        let val = c.value();
        if val == "true" {
            let admin_email = std::env::var("ADMIN_EMAIL")
                .unwrap_or_else(|_| "dbizsley@googlemail.com".to_string());
            if let Some(user) = storage::find_user_by_email(&admin_email) {
                return Some(user.id);
            }
        }
        if !val.is_empty() {
            return Some(val.to_string());
        }
    }
    None
}

async fn index(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let user_id = get_session_user_id(&jar).await;
    let recipes = storage::list_recipes_for_user(user_id.as_deref());
    let mut all_tags: Vec<String> = recipes
        .iter()
        .flat_map(|r| r.tags.clone())
        .map(|t| t.to_lowercase())
        .collect();
    all_tags.sort();
    all_tags.dedup();

    let template = IndexTemplate {
        recipes,
        all_tags,
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        is_admin: is_admin_session(&jar),
    };
    Html(template.render().unwrap())
}

async fn api_guide(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let template = ApiGuideTemplate {
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        is_admin: is_admin_session(&jar),
    };
    Html(template.render().unwrap())
}

async fn view_recipe(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Path(id): Path<String>,
) -> Result<Html<String>, (StatusCode, &'static str)> {
    if let Some(recipe) = storage::read_recipe(&id) {
        let user_id = get_session_user_id(&jar).await;
        let is_owner = user_id.as_ref() == Some(&recipe.owner_id);

        if recipe.is_public || is_owner {
            let template = RecipeTemplate {
                recipe,
                app_base: state.app_base,
                app_version: APP_VERSION.to_string(),
                is_admin: is_admin_session(&jar),
            };
            Ok(Html(template.render().unwrap()))
        } else {
            Err((
                StatusCode::FORBIDDEN,
                "Access denied. This recipe is private.",
            ))
        }
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn new_recipe(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    if !is_admin_session(&jar) {
        return Redirect::to(&format!("{}/login", state.app_base)).into_response();
    }

    let template = EditTemplate {
        recipe: models::Recipe {
            id: String::new(),
            title: String::new(),
            description: None,
            image: None,
            combustion_csv: None,
            source_url: None,
            tags: vec![],
            servings: None,
            prep_time: None,
            cook_time: None,
            ingredients: vec![],
            markdown: String::new(),
            html: None,
            video_url: None,
            favorite: false,
            owner_id: "admin".to_string(),
            is_public: true,
            owner_email: None,
        },
        is_new: true,
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        is_admin: true,
    };
    Html(template.render().unwrap()).into_response()
}

#[axum::debug_handler]
async fn create_recipe(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    multipart: Multipart,
) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return Err((StatusCode::UNAUTHORIZED, "Unauthorized")),
    };

    let form = match parse_recipe_multipart(multipart).await {
        Some(f) => f,
        None => return Err((StatusCode::BAD_REQUEST, "Invalid form data")),
    };

    let mut id = slug::slugify(&form.title);
    if id.is_empty() {
        id = uuid::Uuid::new_v4().to_string();
    }
    let recipe = models::Recipe {
        id: id.clone(),
        title: form.title,
        description: form.description,
        image: form.image,
        source_url: form.source_url,
        tags: form.tags,
        servings: form.servings,
        prep_time: form.prep_time,
        cook_time: form.cook_time,
        ingredients: form.ingredients,
        markdown: form.markdown,
        html: None,
        combustion_csv: form.combustion_csv,
        video_url: form.video_url,
        favorite: false,
        owner_id: user_id,
        is_public: form.is_public,
        owner_email: None,
    };
    let _ = storage::save_recipe(&recipe);
    let redirect_url = format!("{}/recipe/{}", state.app_base, id);
    info!("Redirecting to: {}", redirect_url);
    Ok(Redirect::to(&redirect_url))
}

async fn toggle_favorite(jar: PrivateCookieJar, Path(id): Path<String>) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return Err((StatusCode::UNAUTHORIZED, "Unauthorized")),
    };

    if let Some(mut recipe) = storage::read_recipe(&id) {
        if recipe.owner_id != user_id {
            return Err((StatusCode::FORBIDDEN, "Forbidden"));
        }
        recipe.favorite = !recipe.favorite;
        let _ = storage::save_recipe(&recipe);
        Ok(Json(serde_json::json!({ "favorite": recipe.favorite })))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn edit_recipe(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    };

    if let Some(recipe) = storage::read_recipe(&id) {
        if recipe.owner_id != user_id {
            return (StatusCode::FORBIDDEN, "Access denied").into_response();
        }
        let template = EditTemplate {
            recipe,
            is_new: false,
            app_base: state.app_base,
            app_version: APP_VERSION.to_string(),
            is_admin: true,
        };
        Html(template.render().unwrap()).into_response()
    } else {
        (StatusCode::NOT_FOUND, "Recipe not found").into_response()
    }
}

#[axum::debug_handler]
async fn update_recipe(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Path(id): Path<String>,
    multipart: Multipart,
) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return Err((StatusCode::UNAUTHORIZED, "Unauthorized")),
    };

    let form = match parse_recipe_multipart(multipart).await {
        Some(f) => f,
        None => return Err((StatusCode::BAD_REQUEST, "Invalid form data")),
    };

    if let Some(mut recipe) = storage::read_recipe(&id) {
        if recipe.owner_id != user_id {
            return Err((StatusCode::FORBIDDEN, "Forbidden"));
        }
        recipe.title = form.title;
        recipe.description = form.description;
        if form.image.is_some() {
            recipe.image = form.image;
        }
        if form.remove_combustion_csv {
            recipe.combustion_csv = None;
        } else if form.combustion_csv.is_some() {
            recipe.combustion_csv = form.combustion_csv;
        }
        recipe.source_url = form.source_url;
        recipe.tags = form.tags;
        recipe.servings = form.servings;
        recipe.prep_time = form.prep_time;
        recipe.cook_time = form.cook_time;
        recipe.ingredients = form.ingredients;
        recipe.markdown = form.markdown;
        recipe.video_url = form.video_url;
        recipe.is_public = form.is_public;
        let _ = storage::save_recipe(&recipe);
        info!("Updated recipe: {} ({})", recipe.title, id);
        Ok(Redirect::to(&format!("{}/recipe/{}", state.app_base, id)))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn delete_recipe(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let user_id = match get_session_user_id(&jar).await {
        Some(id) => id,
        None => return Err((StatusCode::UNAUTHORIZED, "Unauthorized")),
    };

    if let Some(recipe) = storage::read_recipe(&id) {
        if recipe.owner_id != user_id {
            return Err((StatusCode::FORBIDDEN, "Forbidden"));
        }
        let _ = storage::delete_recipe(&id);
        info!("Deleted recipe: {}", id);
        Ok(Redirect::to(&format!("{}/", state.app_base)))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

#[axum::debug_handler]
async fn import_recipe(
    State(state): State<AppState>,
    Form(form): Form<ImportForm>,
) -> impl IntoResponse {
    match importer::import_recipe_from_url(&form.url).await {
        Ok(recipe) => {
            info!("Successfully imported recipe from URL: {}", form.url);
            let template = EditTemplate {
                recipe,
                is_new: true,
                app_base: state.app_base,
                app_version: APP_VERSION.to_string(),
                is_admin: true,
            };
            Html(template.render().unwrap()).into_response()
        }
        Err(e) => {
            warn!("Failed to import recipe from URL {}: {:?}", form.url, e);
            let msg = format!("Failed to import: {}", e);
            (StatusCode::BAD_REQUEST, msg).into_response()
        }
    }
}

async fn import_paprika(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let mut count = 0;
    info!("Starting Paprika archive import");
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if name == "paprika_file"
            && let Ok(data) = field.bytes().await
        {
            println!("Received Paprika file: {} bytes", data.len());
            let recipes = importer::import_paprika_archive(&data).await;
            info!("Parsed {} recipes from archive", recipes.len());
            for recipe in recipes {
                if let Err(e) = storage::save_recipe(&recipe) {
                    error!("Failed to save recipe {}: {:?}", recipe.title, e);
                } else {
                    count += 1;
                }
            }
        }
    }

    info!("Successfully imported {} Paprika recipes", count);

    // Redirect to index after import
    Redirect::to(&format!("{}/", state.app_base))
}

async fn import_photo(State(state): State<AppState>, mut multipart: Multipart) -> Response {
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if name == "photo"
            && let Ok(data) = field.bytes().await
        {
            // Process image: resize and compress
            let processed_data = match storage::process_image(&data) {
                Ok(d) => d,
                Err(e) => {
                    warn!("Failed to process photo: {:?}", e);
                    data.to_vec()
                }
            };

            let new_filename = format!("{}.webp", uuid::Uuid::new_v4());
            let filepath = format!("data/uploads/{}", new_filename);
            let _ = std::fs::write(&filepath, &processed_data);

            // Then, call Gemini using the processed image
            match importer::import_recipe_from_photo("image/jpeg", &processed_data).await {
                Ok(mut recipe) => {
                    // Set the image
                    recipe.image = Some(format!("uploads/{}", new_filename));

                    info!(
                        "Successfully parsed recipe from photo using AI: {}",
                        recipe.title
                    );
                    let template = EditTemplate {
                        recipe,
                        is_new: true,
                        app_base: state.app_base,
                        app_version: APP_VERSION.to_string(),
                        is_admin: true,
                    };
                    return Html(template.render().unwrap()).into_response();
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

async fn upload_image(mut multipart: Multipart) -> impl IntoResponse {
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let bytes = field.bytes().await.unwrap();

        // Process image: resize and compress
        let processed_data = match storage::process_image(&bytes) {
            Ok(d) => d,
            Err(e) => {
                warn!("Failed to process upload: {:?}", e);
                bytes.to_vec()
            }
        };

        let new_filename = format!("{}.webp", uuid::Uuid::new_v4());
        let filepath = format!("data/uploads/{}", new_filename);

        if std::fs::write(&filepath, processed_data).is_ok() {
            let url = format!("uploads/{}", new_filename);
            return Json(UploadResponse {
                data: Some(UploadData { file_path: url }),
                error: None,
            });
        }
    }

    Json(UploadResponse {
        data: None,
        error: Some("Upload failed".to_string()),
    })
}

async fn require_admin(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    req: Request,
    next: Next,
) -> Result<Response, Redirect> {
    if is_admin_session(&jar) {
        Ok(next.run(req).await)
    } else {
        Err(Redirect::to(&format!("{}/login", state.app_base)))
    }
}

#[derive(Deserialize)]
struct LoginQuery {
    error: Option<String>,
}

async fn login_form(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Query(query): Query<LoginQuery>,
) -> impl IntoResponse {
    if is_admin_session(&jar) {
        return Redirect::to(&format!("{}/", state.app_base)).into_response();
    }

    let template = LoginTemplate {
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        error: query.error,
        is_admin: false,
        google_auth_enabled: state.google_oauth.is_some(),
    };
    Html(template.render().unwrap()).into_response()
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
    let admin_email =
        std::env::var("ADMIN_EMAIL").unwrap_or_else(|_| "dbizsley@googlemail.com".to_string());
    let email_lookup = match &form.email {
        Some(e) if !e.trim().is_empty() => {
            if e.trim().to_lowercase() == "admin" {
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
                .secure(false)
                .same_site(SameSite::Lax)
                .build();
            let updated_jar = jar.add(cookie);
            return (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response();
        }
    }

    let template = LoginTemplate {
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        error: Some("Invalid email or password".to_string()),
        is_admin: false,
        google_auth_enabled: state.google_oauth.is_some(),
    };
    Html(template.render().unwrap()).into_response()
}

async fn logout(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };
    let cookie = Cookie::build("admin_session").path(cookie_path).build();
    let updated_jar = jar.remove(cookie);
    (updated_jar, Redirect::to(&format!("{}/", state.app_base)))
}

async fn register_form(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    if is_admin_session(&jar) {
        return Redirect::to(&format!("{}/", state.app_base)).into_response();
    }

    let template = RegisterTemplate {
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        error: None,
        is_admin: false,
    };
    Html(template.render().unwrap()).into_response()
}

#[derive(Deserialize)]
struct RegisterFormData {
    email: String,
    password: String,
    confirm_password: String,
}

async fn register_submit(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Form(form): Form<RegisterFormData>,
) -> impl IntoResponse {
    if form.email.trim().is_empty() || form.password.is_empty() {
        let template = RegisterTemplate {
            app_base: state.app_base,
            app_version: APP_VERSION.to_string(),
            error: Some("Email and password cannot be empty".to_string()),
            is_admin: false,
        };
        return Html(template.render().unwrap()).into_response();
    }

    if form.password != form.confirm_password {
        let template = RegisterTemplate {
            app_base: state.app_base,
            app_version: APP_VERSION.to_string(),
            error: Some("Passwords do not match".to_string()),
            is_admin: false,
        };
        return Html(template.render().unwrap()).into_response();
    }

    if storage::find_user_by_email(&form.email).is_some() {
        let template = RegisterTemplate {
            app_base: state.app_base,
            app_version: APP_VERSION.to_string(),
            error: Some("A user with this email already exists".to_string()),
            is_admin: false,
        };
        return Html(template.render().unwrap()).into_response();
    }

    let password_hash = match bcrypt::hash(&form.password, bcrypt::DEFAULT_COST) {
        Ok(h) => h,
        Err(_) => {
            let template = RegisterTemplate {
                app_base: state.app_base,
                app_version: APP_VERSION.to_string(),
                error: Some("Failed to process password".to_string()),
                is_admin: false,
            };
            return Html(template.render().unwrap()).into_response();
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let new_user = models::User {
        id: user_id.clone(),
        email: form.email.trim().to_string(),
        password_hash,
        created_at: "".to_string(),
    };

    if let Err(e) = storage::save_user(&new_user) {
        error!("Failed to save new user: {:?}", e);
        let template = RegisterTemplate {
            app_base: state.app_base,
            app_version: APP_VERSION.to_string(),
            error: Some("Failed to register account".to_string()),
            is_admin: false,
        };
        return Html(template.render().unwrap()).into_response();
    }

    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };
    let cookie = Cookie::build(("admin_session", user_id))
        .path(cookie_path)
        .http_only(true)
        .secure(false)
        .same_site(SameSite::Lax)
        .build();
    let updated_jar = jar.add(cookie);
    (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response()
}

async fn login_google(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let config = match &state.google_oauth {
        Some(c) => c,
        None => {
            return Redirect::to(&format!(
                "{}/login?error=Google+OAuth+not+configured",
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

    let state_cookie = Cookie::build(("oauth_state", state_token.clone()))
        .path(cookie_path)
        .http_only(true)
        .secure(false)
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
        .append_pair("state", &state_token);

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
            return Redirect::to(&format!(
                "{}/login?error=Google+OAuth+not+configured",
                state.app_base
            ))
            .into_response();
        }
    };

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
            if user_info.email.to_lowercase() == config.admin_email.to_lowercase() {
                let user_id = uuid::Uuid::new_v4().to_string();
                let new_user = models::User {
                    id: user_id.clone(),
                    email: user_info.email.trim().to_string(),
                    password_hash: "".to_string(),
                    created_at: "".to_string(),
                };
                let _ = storage::save_user(&new_user);
                new_user
            } else {
                warn!("Unauthorized Google OAuth attempt: {}", user_info.email);
                return (
                    jar,
                    Redirect::to(&format!(
                        "{}/login?error=Unauthorized+email+address",
                        state.app_base
                    )),
                )
                    .into_response();
            }
        }
    };

    info!("OAuth login successful for user: {}", user.email);
    let cookie = Cookie::build(("admin_session", user.id))
        .path(cookie_path)
        .http_only(true)
        .secure(false)
        .same_site(SameSite::Lax)
        .build();
    let updated_jar = jar.add(cookie);
    (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response()
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    // Ensure data directories exist (important for volume mounts)
    let _ = std::fs::create_dir_all("data/recipes");
    let _ = std::fs::create_dir_all("data/uploads");

    let password_hash = std::env::var("ADMIN_PASSWORD_HASH").unwrap_or_else(|_| {
        warn!("ADMIN_PASSWORD_HASH is not set. Creating a default temporary password 'admin'. Please set this in production!");
        bcrypt::hash("admin", bcrypt::DEFAULT_COST).unwrap()
    });

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

    let google_oauth = if let (Ok(client_id), Ok(client_secret), Ok(admin_email)) = (
        std::env::var("GOOGLE_CLIENT_ID"),
        std::env::var("GOOGLE_CLIENT_SECRET"),
        std::env::var("ADMIN_EMAIL"),
    ) {
        let redirect_uri = std::env::var("GOOGLE_REDIRECT_URI").unwrap_or_else(|_| {
            let base = if app_base.is_empty() {
                "http://localhost:3000"
            } else {
                app_base
            };
            format!("{}/login/google/callback", base)
        });

        info!("Google OAuth enabled for admin email: {}", admin_email);
        Some(GoogleOauthConfig {
            client_id,
            client_secret,
            redirect_uri,
            admin_email,
        })
    } else {
        info!("Google OAuth is not configured. Falling back to standard password login.");
        None
    };

    let state = AppState {
        key,
        password_hash,
        app_base,
        google_oauth,
    };

    let admin_email =
        std::env::var("ADMIN_EMAIL").unwrap_or_else(|_| "dbizsley@googlemail.com".to_string());
    storage::db_init(&state.password_hash, &admin_email).unwrap();

    let protected_routes = Router::new()
        .route("/new", get(new_recipe).post(create_recipe))
        .route("/edit/{id}", get(edit_recipe).post(update_recipe))
        .route("/delete/{id}", post(delete_recipe))
        .route("/import", post(import_recipe))
        .route("/import/paprika", post(import_paprika))
        .route("/import/photo", post(import_photo))
        .route("/upload", post(upload_image))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin));

    let static_assets = Router::new()
        .nest_service("/static", ServeDir::new("static"))
        .nest_service("/uploads", ServeDir::new("data/uploads"))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));

    let public_routes = Router::new()
        .route("/", get(index))
        .route("/recipe/{id}", get(view_recipe))
        .route("/recipe/favorite/{id}", post(toggle_favorite))
        .route("/login", get(login_form).post(login_submit))
        .route("/login/google", get(login_google))
        .route("/login/google/callback", get(login_google_callback))
        .route("/register", get(register_form).post(register_submit))
        .route("/logout", post(logout))
        .route("/api", get(api_guide))
        .route("/api/", get(api_guide))
        .merge(static_assets);

    let app = Router::new()
        .merge(public_routes.with_state(state.clone()))
        .merge(protected_routes.with_state(state.clone()))
        .nest("/api/v1", api::router(state.clone()).with_state(state))
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(1024 * 1024 * 250)); // 250 MB limit

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Server starting at http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod oauth_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn build_test_app(google_config: Option<GoogleOauthConfig>) -> Router {
        let _ = std::fs::remove_file("data/recipes.db"); // Deterministic db state
        let state = AppState {
            key: axum_extra::extract::cookie::Key::generate(),
            password_hash: "".to_string(),
            app_base: "",
            google_oauth: google_config,
        };

        storage::db_init(&state.password_hash, "dbizsley@googlemail.com").unwrap();

        let static_assets = Router::new()
            .nest_service("/static", ServeDir::new("static"))
            .nest_service("/uploads", ServeDir::new("data/uploads"));

        let public_routes = Router::new()
            .route("/", get(index))
            .route("/login", get(login_form).post(login_submit))
            .route("/login/google", get(login_google))
            .route("/login/google/callback", get(login_google_callback))
            .route("/register", get(register_form).post(register_submit))
            .merge(static_assets);

        Router::new().merge(public_routes).with_state(state)
    }

    #[tokio::test]
    async fn test_google_oauth_disabled_by_default() {
        let app = build_test_app(None).await;

        let req = Request::builder()
            .method("GET")
            .uri("/login")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();
        assert!(!body_str.contains("Sign in with Google"));
    }

    #[tokio::test]
    async fn test_google_oauth_enabled_shows_button() {
        let config = GoogleOauthConfig {
            client_id: "test-client-id".to_string(),
            client_secret: "test-client-secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            admin_email: "admin@example.com".to_string(),
        };
        let app = build_test_app(Some(config)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/login")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_str.contains("Sign in with Google"));
        assert!(body_str.contains("/login/google"));
    }

    #[tokio::test]
    async fn test_google_oauth_redirect() {
        let config = GoogleOauthConfig {
            client_id: "test-client-id".to_string(),
            client_secret: "test-client-secret".to_string(),
            redirect_uri: "http://localhost/callback".to_string(),
            admin_email: "admin@example.com".to_string(),
        };
        let app = build_test_app(Some(config)).await;

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
        let app = build_test_app(Some(config)).await;

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
}
