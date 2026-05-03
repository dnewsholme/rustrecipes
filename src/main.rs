mod importer;
mod models;
mod storage;

use askama::Template;
use axum::{
    Form, Router,
    extract::{DefaultBodyLimit, Multipart, Path},
    http::StatusCode,
    response::{Html, IntoResponse, Json, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::{services::ServeDir, trace::TraceLayer};
use tracing::{info, error, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Template)]
#[template(path = "index.html")]
struct IndexTemplate {
    recipes: Vec<models::Recipe>,
    base_url: String,
    app_version: String,
}

#[derive(Template)]
#[template(path = "recipe.html")]
struct RecipeTemplate {
    recipe: models::Recipe,
    base_url: String,
    app_version: String,
}

#[derive(Template)]
#[template(path = "edit.html")]
struct EditTemplate {
    recipe: models::Recipe,
    is_new: bool,
    base_url: String,
    app_version: String,
}

fn get_base_url() -> String {
    std::env::var("APP_BASE").unwrap_or_default()
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
                        },
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
                        },
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

async fn index() -> impl IntoResponse {
    let recipes = storage::list_recipes().await;
    let template = IndexTemplate {
        recipes,
        base_url: get_base_url(),
        app_version: APP_VERSION.to_string(),
    };
    Html(template.render().unwrap())
}

async fn view_recipe(Path(id): Path<String>) -> impl IntoResponse {
    if let Some(recipe) = storage::read_recipe(&id).await {
        let template = RecipeTemplate {
            recipe,
            base_url: get_base_url(),
            app_version: APP_VERSION.to_string(),
        };
        Ok(Html(template.render().unwrap()))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn new_recipe() -> impl IntoResponse {
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
        },
        is_new: true,
        base_url: get_base_url(),
        app_version: APP_VERSION.to_string(),
    };
    Html(template.render().unwrap())
}

async fn create_recipe(multipart: Multipart) -> impl IntoResponse {
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
        combustion_csv: form.combustion_csv,
        source_url: form.source_url,
        tags: form.tags,
        servings: form.servings,
        prep_time: form.prep_time,
        cook_time: form.cook_time,
        ingredients: form.ingredients,
        markdown: form.markdown,
        html: None,
    };

    let _ = storage::save_recipe(&recipe).await;
    info!("Created new recipe: {} ({})", recipe.title, id);
    Ok(Redirect::to(&format!("{}/recipe/{}", get_base_url(), id)))
}

async fn edit_recipe(Path(id): Path<String>) -> impl IntoResponse {
    if let Some(recipe) = storage::read_recipe(&id).await {
        let template = EditTemplate {
            recipe,
            is_new: false,
            base_url: get_base_url(),
            app_version: APP_VERSION.to_string(),
        };
        Ok(Html(template.render().unwrap()))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn update_recipe(Path(id): Path<String>, multipart: Multipart) -> impl IntoResponse {
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
        if form.combustion_csv.is_some() {
            recipe.combustion_csv = form.combustion_csv;
        } else if form.remove_combustion_csv {
            recipe.combustion_csv = None;
        }
        recipe.source_url = form.source_url;
        recipe.tags = form.tags;
        recipe.servings = form.servings;
        recipe.prep_time = form.prep_time;
        recipe.cook_time = form.cook_time;
        recipe.ingredients = form.ingredients;
        recipe.markdown = form.markdown;
        let _ = storage::save_recipe(&recipe).await;
        info!("Updated recipe: {} ({})", recipe.title, id);
        Ok(Redirect::to(&format!("{}/recipe/{}", get_base_url(), id)))
    } else {
        Err((StatusCode::NOT_FOUND, "Recipe not found"))
    }
}

async fn delete_recipe(Path(id): Path<String>) -> impl IntoResponse {
    let _ = storage::delete_recipe(&id).await;
    info!("Deleted recipe: {}", id);
    Redirect::to(&format!("{}/", get_base_url()))
}

#[axum::debug_handler]
async fn import_recipe(Form(form): Form<ImportForm>) -> impl IntoResponse {
    match importer::import_recipe_from_url(&form.url).await {
        Some(recipe) => {
            info!("Successfully imported recipe from URL: {}", form.url);
            let template = EditTemplate {
                recipe,
                is_new: true,
                base_url: get_base_url(),
                app_version: APP_VERSION.to_string(),
            };
            Html(template.render().unwrap()).into_response()
        }
        None => {
            warn!("Failed to import recipe from URL: {}", form.url);
            (StatusCode::BAD_REQUEST, "Failed to import recipe").into_response()
        },
    }
}

async fn import_paprika(mut multipart: Multipart) -> impl IntoResponse {
    let mut count = 0;
    info!("Starting Paprika archive import");
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if name == "paprika_file" {
            if let Ok(data) = field.bytes().await {
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
    }

    info!("Successfully imported {} Paprika recipes", count);

    // Redirect to index after import
    Redirect::to(&format!("{}/", get_base_url()))
}

async fn import_photo(mut multipart: Multipart) -> Response {
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if name == "photo" {
            let content_type = field.content_type().unwrap_or("image/jpeg").to_string();

            let filename = field.file_name().unwrap_or("photo.jpg").to_string();
            let extension = std::path::Path::new(&filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("jpg");

            if let Ok(data) = field.bytes().await {
                // First, save the photo
                let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
                let filepath = format!("data/uploads/{}", new_filename);
                let _ = std::fs::write(&filepath, &data);

                // Then, call Gemini
                if let Some(mut recipe) =
                    importer::import_recipe_from_photo(&content_type, &data).await
                {
                    // Set the image
                    recipe.image = Some(format!("uploads/{}", new_filename));

                    info!("Successfully parsed recipe from photo using AI: {}", recipe.title);
                    let template = EditTemplate {
                        recipe,
                        is_new: true,
                        base_url: get_base_url(),
                        app_version: APP_VERSION.to_string(),
                    };
                    return Html(template.render().unwrap()).into_response();
                } else {
                    warn!("Failed to parse recipe from photo using AI");
                    return (
                        StatusCode::BAD_REQUEST,
                        "Failed to parse recipe from photo using AI. Is GEMINI_API_KEY set?",
                    )
                        .into_response();
                }
            }
        }
    }

    (StatusCode::BAD_REQUEST, "No photo uploaded").into_response()
}

async fn upload_image(mut multipart: Multipart) -> impl IntoResponse {
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        if let Some(filename) = field.file_name() {
            let extension = std::path::Path::new(filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");

            let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
            let filepath = format!("data/uploads/{}", new_filename);

            let data = field.bytes().await.unwrap();
            if std::fs::write(&filepath, data).is_ok() {
                let url = format!("uploads/{}", new_filename);
                return Json(UploadResponse {
                    data: Some(UploadData { file_path: url }),
                    error: None,
                });
            }
        }
    }

    Json(UploadResponse {
        data: None,
        error: Some("Upload failed".to_string()),
    })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // Ensure data directories exist (important for volume mounts)
    let _ = std::fs::create_dir_all("data/recipes");
    let _ = std::fs::create_dir_all("data/uploads");

    let app = Router::new()
        .route("/", get(index))
        .route("/recipe/{id}", get(view_recipe))
        .route("/new", get(new_recipe).post(create_recipe))
        .route("/edit/{id}", get(edit_recipe).post(update_recipe))
        .route("/delete/{id}", post(delete_recipe))
        .route("/import", post(import_recipe))
        .route("/import/paprika", post(import_paprika))
        .route("/import/photo", post(import_photo))
        .route("/upload", post(upload_image))
        .nest_service("/static", ServeDir::new("static"))
        .nest_service("/uploads", ServeDir::new("data/uploads"))
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(1024 * 1024 * 250)); // 250 MB limit

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Server starting at http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
