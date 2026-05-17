use crate::{AppState, models::Recipe, storage};
use axum::{
    Router,
    extract::Request,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tracing::{error, warn};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/recipes", get(list_recipes).post(create_recipe))
        .route(
            "/recipes/{id}",
            get(get_recipe).put(update_recipe).delete(delete_recipe),
        )
        .route("/ferment", get(calculate_fermentation))
        .route("/temps", get(get_cooking_temps))
        .route("/log7", get(calculate_log7))
        .route("/import", post(import_recipe))
        .route("/shopping-list", post(generate_shopping_list))
        .route(
            "/meal-plan",
            get(get_meal_plan)
                .post(add_to_meal_plan)
                .delete(clear_meal_plan),
        )
        .route("/meal-plan/toggle", post(toggle_meal_plan))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_api_token,
        ))
}

async fn require_api_token(
    State(_state): State<AppState>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Result<axum::response::Response, StatusCode> {
    // Only require auth for mutable methods, except for shopping-list and meal-plan
    let method = req.method();
    let path = req.uri().path();
    if method == axum::http::Method::GET
        || path == "/shopping-list"
        || path.starts_with("/meal-plan")
    {
        return Ok(next.run(req).await);
    }

    let token = std::env::var("API_TOKEN").unwrap_or_default();
    if token.is_empty() {
        warn!("API_TOKEN is not set. Mutable API endpoints are disabled.");
        return Err(StatusCode::UNAUTHORIZED);
    }

    if headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .filter(|s| s.starts_with("Bearer ") && s[7..] == token)
        .is_some()
    {
        return Ok(next.run(req).await);
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
    hydration: Option<f64>,
}

#[derive(Serialize)]
struct CookingTemp {
    label: String,
    temp_c: f64,
    temp_c_max: Option<f64>,
}

#[derive(Serialize)]
struct CookingTempGroup {
    category: String,
    items: Vec<CookingTemp>,
}

#[derive(Serialize)]
struct Log7Response {
    temp_c: f64,
    seconds: f64,
    display_time: String,
}

#[derive(Deserialize)]
struct Log7Query {
    temp: f64,
}

async fn list_recipes() -> impl IntoResponse {
    let recipes = storage::list_recipes().await;
    let summaries = recipes
        .into_iter()
        .map(|r| {
            let totals = crate::conversions::calculate_totals(&r.ingredients, 1.0);
            let hydration = if totals.total_flour > 0.0 {
                Some(totals.total_water / totals.total_flour)
            } else {
                None
            };

            RecipeSummary {
                id: r.id,
                title: r.title,
                image: r.image,
                tags: r.tags,
                prep_time: r.prep_time,
                cook_time: r.cook_time,
                hydration,
            }
        })
        .collect();

    Json(RecipeListResponse { recipes: summaries })
}

#[derive(Deserialize)]
struct GetRecipeQuery {
    unit: Option<String>,
    temp: Option<String>,
    scale: Option<f64>,
    bakers: Option<bool>,
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
                query.bakers.unwrap_or(false),
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

#[derive(Deserialize)]
struct ShoppingListRequest {
    recipe_ids: Vec<String>,
    portions: u32,
    unit_system: String,
}

#[derive(Serialize)]
struct ShoppingListResponse {
    ingredients: Vec<String>,
}

async fn generate_shopping_list(Json(payload): Json<ShoppingListRequest>) -> impl IntoResponse {
    let mut recipes = Vec::new();
    for id in &payload.recipe_ids {
        if let Some(r) = storage::read_recipe(id).await {
            recipes.push(r);
        }
    }

    if recipes.is_empty() {
        return (StatusCode::BAD_REQUEST, "No valid recipes found").into_response();
    }

    let ingredients = crate::conversions::generate_combined_shopping_list(
        recipes,
        payload.portions,
        &payload.unit_system,
    );

    Json(ShoppingListResponse { ingredients }).into_response()
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

async fn calculate_fermentation(
    axum::extract::Query(query): axum::extract::Query<FermentQuery>,
) -> Json<FermentResult> {
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
        amount_factor = 20.0
            / (if query.amount == 0.0 {
                0.1
            } else {
                query.amount
            });
    }

    let mut estimated_hours = base_time * temp_factor * amount_factor;
    if estimated_hours > 48.0 {
        estimated_hours = 48.0;
    }

    Json(FermentResult { estimated_hours })
}

async fn get_cooking_temps() -> impl IntoResponse {
    let temps = vec![
        CookingTempGroup {
            category: "Beef, Lamb, Veal, Pork".to_string(),
            items: vec![
                CookingTemp {
                    label: "Rare".to_string(),
                    temp_c: 52.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Med Rare".to_string(),
                    temp_c: 57.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium".to_string(),
                    temp_c: 63.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Well Done".to_string(),
                    temp_c: 71.0,
                    temp_c_max: None,
                },
            ],
        },
        CookingTempGroup {
            category: "Poultry & Ground".to_string(),
            items: vec![
                CookingTemp {
                    label: "Chicken / Turkey".to_string(),
                    temp_c: 74.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Ground / Sausage".to_string(),
                    temp_c: 71.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Fish".to_string(),
                    temp_c: 63.0,
                    temp_c_max: None,
                },
            ],
        },
        CookingTempGroup {
            category: "BBQ Low & Slow".to_string(),
            items: vec![
                CookingTemp {
                    label: "Brisket (Sliced)".to_string(),
                    temp_c: 93.0,
                    temp_c_max: Some(96.0),
                },
                CookingTemp {
                    label: "Pulled Pork".to_string(),
                    temp_c: 95.0,
                    temp_c_max: Some(98.0),
                },
            ],
        },
    ];

    Json(temps)
}

async fn calculate_log7(
    axum::extract::Query(query): axum::extract::Query<Log7Query>,
) -> impl IntoResponse {
    let temp_c = query.temp;
    let log7_table = [
        (57.8, 4104.0),
        (60.0, 1650.0),
        (62.8, 552.0),
        (65.6, 162.0),
        (68.3, 48.0),
        (71.1, 14.0),
        (73.9, 0.0),
    ];

    let mut seconds = 0.0;
    if temp_c >= 73.9 {
        seconds = 0.0;
    } else if temp_c < 57.8 {
        seconds = 9999.0;
    } else {
        for i in 0..log7_table.len() - 1 {
            let (t1, s1) = log7_table[i];
            let (t2, s2) = log7_table[i + 1];
            if temp_c >= t1 && temp_c <= t2 {
                let ratio = (temp_c - t1) / (t2 - t1);
                seconds = s1 + ratio * (s2 - s1);
                break;
            }
        }
    }

    let display_time = if seconds == 0.0 {
        "Instant".to_string()
    } else if seconds > 3600.0 {
        "> 1 Hour".to_string()
    } else if seconds >= 60.0 {
        format!("{:.1} Min", seconds / 60.0)
    } else {
        format!("{:.0} Sec", seconds)
    };

    Json(Log7Response {
        temp_c,
        seconds,
        display_time,
    })
}

#[derive(Serialize)]
struct MealPlanResponse {
    meals: Vec<PlannedMealItem>,
}

#[derive(Serialize)]
struct PlannedMealItem {
    recipe_id: String,
    title: String,
    checked: bool,
}

#[derive(Deserialize)]
struct AddMealPlanRequest {
    recipe_ids: Vec<String>,
}

#[derive(Deserialize)]
struct ToggleMealRequest {
    recipe_id: String,
}

fn is_admin_session(jar: &axum_extra::extract::cookie::PrivateCookieJar) -> bool {
    if let Some(c) = jar.get("admin_session") {
        c.value() == "true"
    } else {
        false
    }
}

async fn get_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
) -> Result<impl IntoResponse, StatusCode> {
    if !is_admin_session(&jar) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let meals = storage::read_meal_plan().await;
    let mut items = Vec::new();
    for meal in meals {
        let title = if meal.recipe_id.starts_with("manual:") {
            meal.recipe_id.trim_start_matches("manual:").to_string()
        } else if let Some(recipe) = storage::read_recipe(&meal.recipe_id).await {
            recipe.title
        } else {
            meal.recipe_id.clone()
        };

        items.push(PlannedMealItem {
            recipe_id: meal.recipe_id,
            title,
            checked: meal.checked,
        });
    }

    Ok(Json(MealPlanResponse { meals: items }))
}

async fn add_to_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
    Json(payload): Json<AddMealPlanRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if !is_admin_session(&jar) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let mut meals = storage::read_meal_plan().await;
    for id in payload.recipe_ids {
        if !meals.iter().any(|m| m.recipe_id == id) {
            meals.push(crate::models::PlannedMeal {
                recipe_id: id,
                checked: false,
            });
        }
    }

    if storage::save_meal_plan(&meals).await.is_err() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(StatusCode::OK)
}

async fn toggle_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
    Json(payload): Json<ToggleMealRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if !is_admin_session(&jar) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let mut meals = storage::read_meal_plan().await;
    let mut found = false;
    for meal in &mut meals {
        if meal.recipe_id == payload.recipe_id {
            meal.checked = !meal.checked;
            found = true;
            break;
        }
    }

    if !found {
        return Err(StatusCode::NOT_FOUND);
    }

    if storage::save_meal_plan(&meals).await.is_err() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(StatusCode::OK)
}

async fn clear_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
) -> Result<impl IntoResponse, StatusCode> {
    if !is_admin_session(&jar) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    if storage::save_meal_plan(&[]).await.is_err() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Recipe;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

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
        unsafe {
            std::env::set_var("API_TOKEN", "test-token");
        }
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
        unsafe {
            std::env::remove_var("API_TOKEN");
        }
    }

    #[tokio::test]
    async fn test_temps_and_log7() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        // Test /temps
        let req = Request::builder()
            .method("GET")
            .uri("/temps")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let temps: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(temps.as_array().unwrap().len() > 0);

        // Test /log7
        let req = Request::builder()
            .method("GET")
            .uri("/log7?temp=65.0")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let log7: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(log7["temp_c"], 65.0);
        assert!(log7["display_time"].as_str().unwrap().contains("Min"));
    }
}
