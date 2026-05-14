mod api;
mod conversions;
mod importer;
mod models;
mod storage;

use askama::Template;
use axum::{
    Form, Router,
    extract::Request,
    extract::{DefaultBodyLimit, FromRef, Multipart, Path, State},
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
struct AppState {
    key: Key,
    password_hash: String,
    app_base: &'static str,
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
        val == "true"
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

async fn index(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    let recipes = storage::list_recipes().await;
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
) -> impl IntoResponse {
    if let Some(recipe) = storage::read_recipe(&id).await {
        let template = RecipeTemplate {
            recipe,
            app_base: state.app_base,
            app_version: APP_VERSION.to_string(),
            is_admin: is_admin_session(&jar),
        };
        Ok(Html(template.render().unwrap()))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn new_recipe(State(state): State<AppState>) -> impl IntoResponse {
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
        },
        is_new: true,
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        is_admin: true,
    };
    Html(template.render().unwrap())
}

async fn create_recipe(State(state): State<AppState>, multipart: Multipart) -> impl IntoResponse {
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
    };
    let _ = storage::save_recipe(&recipe).await;
    let redirect_url = format!("{}/recipe/{}", state.app_base, id);
    info!("Redirecting to: {}", redirect_url);
    Ok(Redirect::to(&redirect_url))
}

async fn toggle_favorite(jar: PrivateCookieJar, Path(id): Path<String>) -> impl IntoResponse {
    if !is_admin_session(&jar) {
        return Err((StatusCode::UNAUTHORIZED, "Admin only"));
    }

    if let Some(mut recipe) = storage::read_recipe(&id).await {
        recipe.favorite = !recipe.favorite;
        let _ = storage::save_recipe(&recipe).await;
        Ok(Json(serde_json::json!({ "favorite": recipe.favorite })))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn edit_recipe(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    if let Some(recipe) = storage::read_recipe(&id).await {
        let template = EditTemplate {
            recipe,
            is_new: false,
            app_base: state.app_base,
            app_version: APP_VERSION.to_string(),
            is_admin: true,
        };
        Ok(Html(template.render().unwrap()))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn update_recipe(
    State(state): State<AppState>,
    Path(id): Path<String>,
    multipart: Multipart,
) -> impl IntoResponse {
    let form = match parse_recipe_multipart(multipart).await {
        Some(f) => f,
        None => return Err((StatusCode::BAD_REQUEST, "Invalid form data")),
    };

    if let Some(mut recipe) = storage::read_recipe(&id).await {
        recipe.title = form.title;
        recipe.description = form.description;
        // Only update image if a new one was uploaded or text was provided
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
        let _ = storage::save_recipe(&recipe).await;
        info!("Updated recipe: {} ({})", recipe.title, id);
        Ok(Redirect::to(&format!("{}/recipe/{}", state.app_base, id)))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn delete_recipe(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let _ = storage::delete_recipe(&id).await;
    info!("Deleted recipe: {}", id);
    Redirect::to(&format!("{}/", state.app_base))
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
                if let Err(e) = storage::save_recipe(&recipe).await {
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

async fn login_form(State(state): State<AppState>, jar: PrivateCookieJar) -> impl IntoResponse {
    if is_admin_session(&jar) {
        return Redirect::to(&format!("{}/", state.app_base)).into_response();
    }

    let template = LoginTemplate {
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        error: None,
        is_admin: false,
    };
    Html(template.render().unwrap()).into_response()
}

#[derive(Deserialize)]
struct LoginFormData {
    password: String,
}

async fn login_submit(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Form(form): Form<LoginFormData>,
) -> impl IntoResponse {
    if let Ok(true) = bcrypt::verify(&form.password, &state.password_hash) {
        let cookie_path = if state.app_base.is_empty() {
            "/"
        } else {
            state.app_base
        };
        let cookie = Cookie::build(("admin_session", "true"))
            .path(cookie_path)
            .http_only(true)
            .secure(false)
            .same_site(SameSite::Lax)
            .build();
        let updated_jar = jar.add(cookie);
        return (updated_jar, Redirect::to(&format!("{}/", state.app_base))).into_response();
    }

    let template = LoginTemplate {
        app_base: state.app_base,
        app_version: APP_VERSION.to_string(),
        error: Some("Invalid password".to_string()),
        is_admin: false,
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

    let state = AppState {
        key,
        password_hash,
        app_base,
    };

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
        .route("/logout", post(logout))
        .route("/api", get(api_guide))
        .route("/api/", get(api_guide))
        .merge(static_assets);

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .nest("/api/v1", api::router(state.clone()))
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(1024 * 1024 * 250)) // 250 MB limit
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Server starting at http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
