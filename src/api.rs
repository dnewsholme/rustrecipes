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
        .route("/spices", get(get_spices))
        .route("/log7", get(calculate_log7))
        .route("/import", post(import_recipe))
        .route(
            "/shopping-list",
            get(get_shopping_list)
                .post(generate_shopping_list)
                .put(update_shopping_list)
                .delete(clear_shopping_list),
        )
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
        || path == "/api/v1/shopping-list"
        || path.starts_with("/meal-plan")
        || path.starts_with("/api/v1/meal-plan")
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

async fn list_recipes(jar: axum_extra::extract::cookie::PrivateCookieJar) -> impl IntoResponse {
    let user_id = get_session_user_id(&jar);
    let recipes = storage::list_recipes_for_user(user_id.as_deref());
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
    jar: axum_extra::extract::cookie::PrivateCookieJar,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<GetRecipeQuery>,
) -> impl IntoResponse {
    let user_id = get_session_user_id(&jar);
    let is_admin = if let Some(ref uid) = user_id {
        let admin_email = std::env::var("ADMIN_EMAIL").expect("ADMIN_EMAIL must be set");
        if let Some(admin_user) = storage::find_user_by_email(&admin_email) {
            uid == &admin_user.id
        } else {
            false
        }
    } else {
        false
    };

    match storage::read_recipe_for_user(&id, user_id.as_deref()) {
        Some(recipe) => {
            let is_owner = user_id.as_ref() == Some(&recipe.owner_id);
            if recipe.is_public || is_owner || is_admin {
                let converted = crate::conversions::convert_recipe(
                    recipe,
                    query.unit.as_deref(),
                    query.temp.as_deref(),
                    query.scale,
                    query.bakers.unwrap_or(false),
                );
                Json(converted).into_response()
            } else {
                StatusCode::FORBIDDEN.into_response()
            }
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn create_recipe(Json(recipe): Json<Recipe>) -> impl IntoResponse {
    match storage::save_recipe(&recipe) {
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

async fn generate_shopping_list(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
    Json(payload): Json<ShoppingListRequest>,
) -> impl IntoResponse {
    let user_id = get_session_user_id(&jar);
    let is_admin = if let Some(ref uid) = user_id {
        let admin_email = std::env::var("ADMIN_EMAIL").expect("ADMIN_EMAIL must be set");
        if let Some(admin_user) = storage::find_user_by_email(&admin_email) {
            uid == &admin_user.id
        } else {
            false
        }
    } else {
        false
    };

    let mut recipes = Vec::new();
    for id in &payload.recipe_ids {
        if let Some(r) = storage::read_recipe_for_user(id, user_id.as_deref()) {
            let is_owner = user_id.as_ref() == Some(&r.owner_id);
            if r.is_public || is_owner || is_admin {
                recipes.push(r);
            }
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

    // Save generated list automatically if user is logged in
    if let Some(ref uid) = user_id {
        let items: Vec<crate::models::ShoppingItem> = ingredients
            .iter()
            .map(|ing| crate::models::ShoppingItem {
                name: ing.clone(),
                checked: false,
            })
            .collect();
        let _ = storage::save_shopping_list(uid, &items);
    }

    Json(ShoppingListResponse { ingredients }).into_response()
}

async fn get_shopping_list(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = match get_session_user_id(&jar) {
        Some(uid) => uid,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    match storage::read_shopping_list(&user_id) {
        Some(items) => Ok(Json(items)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn update_shopping_list(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
    Json(payload): Json<Vec<crate::models::ShoppingItem>>,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = match get_session_user_id(&jar) {
        Some(uid) => uid,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    match storage::save_shopping_list(&user_id, &payload) {
        Ok(_) => Ok(StatusCode::OK),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn clear_shopping_list(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = match get_session_user_id(&jar) {
        Some(uid) => uid,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    match storage::delete_shopping_list(&user_id) {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

#[axum::debug_handler]
async fn update_recipe(
    Path(id): Path<String>,
    Json(mut recipe): Json<Recipe>,
) -> impl IntoResponse {
    recipe.id = id.clone();
    match storage::save_recipe(&recipe) {
        Ok(_) => Json(recipe).into_response(),
        Err(e) => {
            error!("Failed to update recipe {}: {}", id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

async fn delete_recipe(Path(id): Path<String>) -> impl IntoResponse {
    match storage::delete_recipe(&id) {
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

async fn get_spices() -> impl IntoResponse {
    Json(crate::storage::list_spices())
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

fn get_session_user_id(jar: &axum_extra::extract::cookie::PrivateCookieJar) -> Option<String> {
    if let Some(c) = jar.get("admin_session") {
        let val = c.value();
        if val == "true" {
            let admin_email = std::env::var("ADMIN_EMAIL").expect("ADMIN_EMAIL must be set");
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

async fn get_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = match get_session_user_id(&jar) {
        Some(uid) => uid,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    tracing::info!("get_meal_plan called for user_id={}", user_id);
    let meals = storage::read_meal_plan(&user_id);
    tracing::info!(
        "Returning {} meal plan items for user_id={}",
        meals.len(),
        user_id
    );
    let mut items = Vec::new();
    for meal in meals {
        let title = if meal.recipe_id.starts_with("manual:") {
            meal.recipe_id.trim_start_matches("manual:").to_string()
        } else if let Some(recipe) = storage::read_recipe(&meal.recipe_id) {
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

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        "no-store, no-cache, must-revalidate, private"
            .parse()
            .unwrap(),
    );
    headers.insert(axum::http::header::VARY, "Cookie".parse().unwrap());

    Ok((headers, Json(MealPlanResponse { meals: items })))
}

async fn add_to_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
    Json(payload): Json<AddMealPlanRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = match get_session_user_id(&jar) {
        Some(uid) => uid,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    let mut meals = storage::read_meal_plan(&user_id);
    for id in payload.recipe_ids {
        if !meals.iter().any(|m| m.recipe_id == id) {
            meals.push(crate::models::PlannedMeal {
                recipe_id: id,
                checked: false,
            });
        }
    }

    if storage::save_meal_plan(&user_id, &meals).is_err() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(StatusCode::OK)
}

async fn toggle_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
    Json(payload): Json<ToggleMealRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = match get_session_user_id(&jar) {
        Some(uid) => uid,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    let mut meals = storage::read_meal_plan(&user_id);
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

    if storage::save_meal_plan(&user_id, &meals).is_err() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(StatusCode::OK)
}

async fn clear_meal_plan(
    jar: axum_extra::extract::cookie::PrivateCookieJar,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = match get_session_user_id(&jar) {
        Some(uid) => uid,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    if storage::save_meal_plan(&user_id, &[]).is_err() {
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
        let _ = std::fs::create_dir_all("data");
        unsafe {
            std::env::set_var("ADMIN_EMAIL", "admin@example.com");
        }
        let _ = storage::db_init("", "admin@example.com");

        let rp_id = "localhost".to_string();
        let rp_origin = url::Url::parse("http://localhost:3000").unwrap();
        let webauthn_builder = webauthn_rs::WebauthnBuilder::new(&rp_id, &rp_origin).unwrap();
        let webauthn = std::sync::Arc::new(webauthn_builder.build().unwrap());
        let reg_states =
            std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        let auth_states =
            std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));

        AppState {
            key: axum_extra::extract::cookie::Key::generate(),
            password_hash: "".to_string(),
            app_base: "",
            google_oauth: None,
            webauthn,
            reg_states,
            auth_states,
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

        let owner_id = storage::find_user_by_email("admin@example.com")
            .map(|u| u.id)
            .unwrap_or_else(|| "admin".to_string());

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
            owner_id,
            is_public: true,
            owner_email: None,
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
        assert!(!temps.as_array().unwrap().is_empty());

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

    #[tokio::test]
    async fn test_private_recipe_api_access() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        let private_recipe_id = "api-private-test-recipe";
        let owner_id = "some-user-id".to_string();

        let test_user = crate::models::User {
            id: owner_id.clone(),
            email: "some-user@example.com".to_string(),
            password_hash: "hash".to_string(),
            created_at: "".to_string(),
        };
        storage::save_user(&test_user).unwrap();

        let recipe = Recipe {
            id: private_recipe_id.to_string(),
            title: "Private API Test".to_string(),
            description: None,
            image: None,
            source_url: None,
            tags: vec![],
            servings: Some(4),
            prep_time: None,
            cook_time: None,
            ingredients: vec!["Secret Ingredient".to_string()],
            markdown: "Secret instructions".to_string(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
            owner_id,
            is_public: false,
            owner_email: None,
        };

        // Save directly to storage
        storage::save_recipe(&recipe).unwrap();

        // 1. Verify GET /recipes does not contain the private recipe
        let req = Request::builder()
            .method("GET")
            .uri("/recipes")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let list: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let recipes = list["recipes"].as_array().unwrap();
        let contains_private = recipes
            .iter()
            .any(|r| r["id"].as_str() == Some(private_recipe_id));
        assert!(
            !contains_private,
            "Private recipe should not be listed for guest"
        );

        // 2. Verify GET /recipes/{id} returns FORBIDDEN
        let req = Request::builder()
            .method("GET")
            .uri(format!("/recipes/{}", private_recipe_id))
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        // 3. Verify POST /shopping-list returns BAD_REQUEST (No valid recipes found)
        let payload = serde_json::json!({
            "recipe_ids": [private_recipe_id],
            "portions": 4,
            "unit_system": "metric"
        });
        let req = Request::builder()
            .method("POST")
            .uri("/shopping-list")
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_string(&payload).unwrap()))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        // Clean up
        let _ = storage::delete_recipe(private_recipe_id);
        let _ = storage::delete_user("some-user-id");
    }

    #[tokio::test]
    async fn test_shopping_list_persistence() {
        let state = test_state();
        let app = router(state.clone()).with_state(state.clone());

        let user_id = "shopping-test-user";
        let test_user = crate::models::User {
            id: user_id.to_string(),
            email: "shopping@example.com".to_string(),
            password_hash: "hash".to_string(),
            created_at: "".to_string(),
        };
        storage::save_user(&test_user).unwrap();

        // Construct encrypted cookie header
        let cookie = axum_extra::extract::cookie::Cookie::new("admin_session", user_id);
        let jar = axum_extra::extract::cookie::PrivateCookieJar::new(state.key.clone()).add(cookie);
        let response = axum::response::IntoResponse::into_response(jar);
        let cookie_header_val = response
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();

        // 1. GET /shopping-list initially should return NOT_FOUND (404)
        let req = Request::builder()
            .method("GET")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // 2. PUT /shopping-list to save a shopping list
        let list_items = vec![
            crate::models::ShoppingItem {
                name: "2 cups flour".to_string(),
                checked: false,
            },
            crate::models::ShoppingItem {
                name: "1 tsp salt".to_string(),
                checked: true,
            },
        ];
        let req = Request::builder()
            .method("PUT")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_string(&list_items).unwrap()))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // 3. GET /shopping-list to verify list is saved correctly
        let req = Request::builder()
            .method("GET")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let fetched: Vec<crate::models::ShoppingItem> = serde_json::from_slice(&body).unwrap();
        assert_eq!(fetched.len(), 2);
        assert_eq!(fetched[0].name, "2 cups flour");
        assert_eq!(fetched[0].checked, false);
        assert_eq!(fetched[1].name, "1 tsp salt");
        assert_eq!(fetched[1].checked, true);

        // 4. DELETE /shopping-list to clear the shopping list
        let req = Request::builder()
            .method("DELETE")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // 5. GET /shopping-list to verify list is deleted / empty (404)
        let req = Request::builder()
            .method("GET")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // Clean up
        let _ = storage::delete_user(user_id);
    }
}
