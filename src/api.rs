use crate::{models::Recipe, storage, AppState};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router, extract::Request,
};
use serde::{Deserialize, Serialize};
use tracing::{error, warn};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/recipes", get(list_recipes).post(create_recipe))
        .route("/recipes/{id}", get(get_recipe).put(update_recipe).delete(delete_recipe))
        .route("/ferment", get(calculate_fermentation))
        .route("/import", post(import_recipe))
        .layer(axum::middleware::from_fn_with_state(state.clone(), require_api_token))
}

async fn require_api_token(
    State(_state): State<AppState>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Result<axum::response::Response, StatusCode> {
    // Only require auth for mutable methods
    let method = req.method();
    if method == axum::http::Method::GET {
        return Ok(next.run(req).await);
    }

    let token = std::env::var("API_TOKEN").unwrap_or_default();
    if token.is_empty() {
        warn!("API_TOKEN is not set. Mutable API endpoints are disabled.");
        return Err(StatusCode::UNAUTHORIZED);
    }

    if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_header.to_str() {
            if auth_str.starts_with("Bearer ") && &auth_str[7..] == token {
                return Ok(next.run(req).await);
            }
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

#[derive(Serialize)]
struct RecipeListResponse {
    recipes: Vec<RecipeSummary>,
}

#[derive(Serialize)]
struct RecipeSummary {
    id: String,
    title: String,
    image: Option<String>,
    tags: Vec<String>,
    prep_time: Option<String>,
    cook_time: Option<String>,
}

async fn list_recipes() -> impl IntoResponse {
    let recipes = storage::list_recipes().await;
    let summaries = recipes.into_iter().map(|r| RecipeSummary {
        id: r.id,
        title: r.title,
        image: r.image,
        tags: r.tags,
        prep_time: r.prep_time,
        cook_time: r.cook_time,
    }).collect();

    Json(RecipeListResponse { recipes: summaries })
}

#[derive(Deserialize)]
struct GetRecipeQuery {
    unit: Option<String>,
    temp: Option<String>,
    scale: Option<f64>,
}

async fn get_recipe(
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<GetRecipeQuery>,
) -> impl IntoResponse {
    match storage::read_recipe(&id).await {
        Some(recipe) => {
            let converted = crate::conversions::convert_recipe(
                recipe,
                query.unit.as_deref(),
                query.temp.as_deref(),
                query.scale,
            );
            Json(converted).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn create_recipe(Json(recipe): Json<Recipe>) -> impl IntoResponse {
    match storage::save_recipe(&recipe).await {
        Ok(_) => (StatusCode::CREATED, Json(recipe)).into_response(),
        Err(e) => {
            error!("Failed to create recipe: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

async fn update_recipe(
    Path(id): Path<String>,
    Json(mut recipe): Json<Recipe>,
) -> impl IntoResponse {
    recipe.id = id.clone();
    match storage::save_recipe(&recipe).await {
        Ok(_) => Json(recipe).into_response(),
        Err(e) => {
            error!("Failed to update recipe {}: {}", id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

async fn delete_recipe(Path(id): Path<String>) -> impl IntoResponse {
    match storage::delete_recipe(&id).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            error!("Failed to delete recipe {}: {}", id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

#[derive(Deserialize)]
struct ImportRequest {
    url: String,
}

async fn import_recipe(Json(req): Json<ImportRequest>) -> impl IntoResponse {
    match crate::importer::import_recipe_from_url(&req.url).await {
        Ok(recipe) => {
            // Don't save it automatically, just return the parsed recipe
            // so the client can edit and then POST it.
            Json(recipe).into_response()
        }
        Err(e) => {
            let msg = format!("Failed to import: {}", e);
            (StatusCode::BAD_REQUEST, msg).into_response()
        }
    }
}

#[derive(Deserialize)]
struct FermentQuery {
    #[serde(rename = "type")]
    leaven_type: String,
    amount: f64,
    temp: f64,
}

#[derive(Serialize)]
struct FermentResult {
    estimated_hours: f64,
}

async fn calculate_fermentation(axum::extract::Query(query): axum::extract::Query<FermentQuery>) -> Json<FermentResult> {
    let base_time;
    let temp_factor;
    let amount_factor;

    if query.leaven_type == "yeast" {
        base_time = 2.0;
        temp_factor = f64::powf(2.0, (24.0 - query.temp) / 7.0);
        amount_factor = 1.0 / query.amount;
    } else {
        base_time = 5.0;
        temp_factor = f64::powf(2.0, (24.0 - query.temp) / 6.0);
        amount_factor = 20.0 / (if query.amount == 0.0 { 0.1 } else { query.amount });
    }

    let mut estimated_hours = base_time * temp_factor * amount_factor;
    if estimated_hours > 48.0 { estimated_hours = 48.0; }
    
    Json(FermentResult { estimated_hours })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use crate::models::Recipe;
    use axum::body::Body;
    use http_body_util::BodyExt;

    fn test_state() -> AppState {
        AppState {
            key: axum_extra::extract::cookie::Key::generate(),
            password_hash: "".to_string(),
            app_base: "",
        }
    }

    #[tokio::test]
    async fn test_api_unauthorized() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        let req = Request::builder()
            .method("POST")
            .uri("/import")
            .header("Content-Type", "application/json")
            .body(Body::from("{\"url\": \"test\"}"))
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_list_recipes() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        let req = Request::builder()
            .method("GET")
            .uri("/recipes")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let list: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(list.get("recipes").is_some());
    }

    #[tokio::test]
    async fn test_recipe_lifecycle() {
        // Ensure data/recipes exists
        let _ = std::fs::create_dir_all("data/recipes");
        
        let state = test_state();
        // Set API_TOKEN for mutable methods
        unsafe { std::env::set_var("API_TOKEN", "test-token"); }
        let app = router(state.clone()).with_state(state);

        let test_id = "api-test-recipe";
        let recipe = Recipe {
            id: test_id.to_string(),
            title: "API Test".to_string(),
            description: None,
            image: None,
            source_url: None,
            tags: vec!["test".to_string()],
            servings: Some(4),
            prep_time: None,
            cook_time: None,
            ingredients: vec!["100g flour".to_string()],
            markdown: "Test".to_string(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
        };

        // 1. Create
        let req = Request::builder()
            .method("POST")
            .uri("/recipes")
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer test-token")
            .body(Body::from(serde_json::to_string(&recipe).unwrap()))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        // 2. Get with conversions
        let req = Request::builder()
            .method("GET")
            .uri(format!("/recipes/{}?unit=imperial&scale=2", test_id))
            .body(Body::empty())
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let converted: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(converted["title"], "API Test");
        // 100g * 2 = 200g. 200g in imperial is ~7.1 oz
        assert!(converted["ingredients"][0].as_str().unwrap().contains("oz"));

        // 3. Update
        let mut updated = recipe.clone();
        updated.title = "Updated Title".into();
        let req = Request::builder()
            .method("PUT")
            .uri(format!("/recipes/{}", test_id))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer test-token")
            .body(Body::from(serde_json::to_string(&updated).unwrap()))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // 4. Delete
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/recipes/{}", test_id))
            .header("Authorization", "Bearer test-token")
            .body(Body::empty())
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // Cleanup env
        unsafe { std::env::remove_var("API_TOKEN"); }
    }
}
