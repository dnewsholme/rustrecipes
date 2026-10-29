use crate::{AppState, models::Recipe, storage};
use axum::{
    Router,
    extract::{FromRequestParts, Path, Query, State},
    http::{StatusCode, header, request::Parts},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post},
};
use axum_extra::extract::cookie::{Cookie, Key, PrivateCookieJar, SameSite};
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

// ---------------------------------------------------------------------------
// Limits used for request validation
// ---------------------------------------------------------------------------

const MAX_TITLE_LEN: usize = 200;
const MAX_SHORT_TEXT_LEN: usize = 2_000;
const MAX_MARKDOWN_LEN: usize = 200_000;
const MAX_CSV_LEN: usize = 10 * 1024 * 1024;
const MAX_TAGS: usize = 50;
const MAX_TAG_LEN: usize = 100;
const MAX_LIST_ITEMS: usize = 500;
const MAX_ITEM_LEN: usize = 1_000;
const MAX_SERVINGS: u32 = 1_000;
const MAX_NOTES_LEN: usize = 50_000;
const MAX_IDS_PER_REQUEST: usize = 100;
const MAX_ID_LEN: usize = 300;
const MAX_PORTIONS: u32 = 100;
const MAX_SCALE: f64 = 100.0;
const MAX_URL_LEN: usize = 2_048;
const MAX_PAGE_SIZE: usize = 200;

pub fn router(_state: AppState) -> Router<AppState> {
    // Authentication/authorisation is enforced per handler through the
    // `CurrentUser` (required) and `MaybeUser` (optional) extractors, rather
    // than by matching request paths in a middleware.
    Router::new()
        .route(
            "/recipes",
            get(list_recipes).post(create_recipe).put(create_recipe),
        )
        .route(
            "/recipes/",
            get(list_recipes).post(create_recipe).put(create_recipe),
        )
        .route(
            "/recipes/{id}",
            get(get_recipe).put(update_recipe).delete(delete_recipe),
        )
        .route(
            "/recipes/{id}/notes",
            get(get_recipe_notes_api).post(save_recipe_notes_api),
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
        .route("/meal-plan/{id}", delete(delete_meal_plan_item))
        .route("/meal-plan/toggle", post(toggle_meal_plan))
        .route("/openapi.json", get(crate::openapi::openapi_json))
        .route("/auth/me", get(get_current_user_api))
        .route("/auth/login", post(api_login))
        .route("/auth/logout", post(api_logout))
        .route("/user/export", get(export_user_data_api))
        .route("/admin/users", get(admin_list_users))
        .route("/admin/users/{id}", delete(admin_delete_user))
        .route(
            "/admin/users/{id}/reset-password",
            post(admin_reset_password),
        )
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Unified API error. Always rendered as
/// `{"error": {"code": "...", "message": "..."}}` with a matching status code.
/// Internal details are logged server-side and never returned to clients.
#[derive(Debug)]
pub(crate) enum ApiError {
    Unauthorized,
    Forbidden,
    NotFound,
    BadRequest(String),
    Internal(String),
}

type ApiResult<T> = Result<T, ApiError>;

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Authentication required".to_string(),
            ),
            ApiError::Forbidden => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "You do not have permission to access this resource".to_string(),
            ),
            ApiError::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "Resource not found".to_string(),
            ),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg),
            ApiError::Internal(detail) => {
                error!("Internal API error: {}", detail);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_string(),
                )
            }
        };
        (
            status,
            Json(ErrorBody {
                error: ErrorDetail { code, message },
            }),
        )
            .into_response()
    }
}

fn bad_request(msg: impl Into<String>) -> ApiError {
    ApiError::BadRequest(msg.into())
}

fn blocking<T, F>(f: F) -> std::future::Ready<ApiResult<T>>
where
    F: FnOnce() -> T,
{
    std::future::ready(Ok(f()))
}

// ---------------------------------------------------------------------------
// Authentication extractors
// ---------------------------------------------------------------------------

/// An authenticated caller, resolved either from the `admin_session` cookie
/// or from a valid `Authorization: Bearer <API_TOKEN>` header (which acts as
/// the admin user).
#[derive(Clone, Debug)]
pub(crate) struct CurrentUser {
    pub id: String,
    pub is_admin: bool,
}

impl CurrentUser {
    fn can_modify(&self, recipe: &Recipe) -> bool {
        self.is_admin || self.id == recipe.owner_id
    }
}

/// Optional authentication: `None` for anonymous callers.
pub(crate) struct MaybeUser(pub Option<CurrentUser>);

fn can_view(user: Option<&CurrentUser>, recipe: &Recipe) -> bool {
    recipe.is_public || user.is_some_and(|u| u.can_modify(recipe))
}

fn admin_user_id() -> Option<String> {
    let email = std::env::var("ADMIN_EMAIL").ok()?;
    storage::find_user_by_email(&email).map(|u| u.id)
}

/// Constant-time token comparison. Both values are hashed first so neither
/// the content nor the length of the expected token leaks through timing.
fn token_matches(presented: &str, expected: &str) -> bool {
    use sha2::{Digest, Sha256};
    let a = Sha256::digest(presented.as_bytes());
    let b = Sha256::digest(expected.as_bytes());
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        // 1. Bearer token. If a header is supplied it must be valid; we never
        //    silently fall back to anonymous access for a bad token.
        if let Some(auth) = parts.headers.get(header::AUTHORIZATION) {
            let presented = auth
                .to_str()
                .ok()
                .and_then(|s| s.strip_prefix("Bearer "))
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or(ApiError::Unauthorized)?;

            let Some(expected) = state.api_token.as_deref() else {
                warn!("Bearer token supplied but API_TOKEN is not configured.");
                return Err(ApiError::Unauthorized);
            };
            if !token_matches(presented, expected) {
                return Err(ApiError::Unauthorized);
            }

            let admin_id = blocking(admin_user_id)
                .await?
                .ok_or_else(|| ApiError::Internal("admin user not found".into()))?;
            return Ok(MaybeUser(Some(CurrentUser {
                id: admin_id,
                is_admin: true,
            })));
        }

        // 2. Session cookie.
        let jar = match PrivateCookieJar::<Key>::from_request_parts(parts, state).await {
            Ok(jar) => jar,
            Err(never) => match never {},
        };
        let raw = match jar.get("admin_session") {
            Some(c) if !c.value().is_empty() => c.value().to_string(),
            _ => return Ok(MaybeUser(None)),
        };

        let admin_id = blocking(admin_user_id).await?;
        let id = if raw == "true" {
            // Legacy admin session cookie
            match admin_id.clone() {
                Some(id) => id,
                None => return Ok(MaybeUser(None)),
            }
        } else {
            raw
        };
        let is_admin = admin_id.as_deref() == Some(id.as_str());
        Ok(MaybeUser(Some(CurrentUser { id, is_admin })))
    }
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        MaybeUser::from_request_parts(parts, state)
            .await?
            .0
            .ok_or(ApiError::Unauthorized)
    }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn check_len(field: &str, value: &str, max: usize) -> ApiResult<()> {
    if value.chars().count() > max {
        return Err(bad_request(format!(
            "'{field}' must be at most {max} characters"
        )));
    }
    Ok(())
}

fn check_opt_len(field: &str, value: &Option<String>, max: usize) -> ApiResult<()> {
    match value {
        Some(v) => check_len(field, v, max),
        None => Ok(()),
    }
}

fn check_list(field: &str, items: &[String], max_items: usize, max_len: usize) -> ApiResult<()> {
    if items.len() > max_items {
        return Err(bad_request(format!(
            "'{field}' must contain at most {max_items} entries"
        )));
    }
    for item in items {
        check_len(field, item, max_len)?;
    }
    Ok(())
}

fn check_ids(field: &str, ids: &[String]) -> ApiResult<()> {
    if ids.is_empty() {
        return Err(bad_request(format!("'{field}' must not be empty")));
    }
    if ids.iter().any(|id| id.trim().is_empty()) {
        return Err(bad_request(format!("'{field}' must not contain empty ids")));
    }
    check_list(field, ids, MAX_IDS_PER_REQUEST, MAX_ID_LEN)
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct RecipeListResponse {
    recipes: Vec<RecipeSummary>,
    total: usize,
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
    owner_id: String,
    is_public: bool,
    favorite: bool,
    has_video: bool,
    has_combustion: bool,
}

#[derive(Deserialize)]
struct ListRecipesQuery {
    /// Case-insensitive substring match on title.
    q: Option<String>,
    /// Case-insensitive exact tag match.
    tag: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
}

async fn list_recipes(
    MaybeUser(user): MaybeUser,
    Query(query): Query<ListRecipesQuery>,
) -> ApiResult<impl IntoResponse> {
    if query.limit.is_some_and(|l| l == 0 || l > MAX_PAGE_SIZE) {
        return Err(bad_request(format!(
            "'limit' must be between 1 and {MAX_PAGE_SIZE}"
        )));
    }

    let user_id = user.map(|u| u.id);
    info!(
        "API list_recipes: user={:?}, q={:?}, tag={:?}",
        user_id, query.q, query.tag
    );
    let recipes = blocking(move || storage::list_recipes_for_user(user_id.as_deref())).await?;

    let q = query
        .q
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());
    let tag = query
        .tag
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    let filtered: Vec<Recipe> = recipes
        .into_iter()
        .filter(|r| {
            q.as_ref()
                .is_none_or(|q| r.title.to_lowercase().contains(q))
        })
        .filter(|r| {
            tag.as_ref()
                .is_none_or(|t| r.tags.iter().any(|rt| rt.trim().to_lowercase() == *t))
        })
        .collect();
    let total = filtered.len();

    let summaries = filtered
        .into_iter()
        .skip(query.offset.unwrap_or(0))
        .take(query.limit.unwrap_or(usize::MAX))
        .map(|r| {
            let totals = crate::conversions::calculate_totals(&r.ingredients, 1.0);
            let hydration = if totals.total_flour > 0.0 {
                Some(totals.total_water / totals.total_flour)
            } else {
                None
            };
            let has_video = r.has_video();
            let has_combustion = r.has_combustion();
            let favorite = r.favorite;

            RecipeSummary {
                id: r.id,
                title: r.title,
                image: r.image,
                tags: r.tags,
                prep_time: r.prep_time,
                cook_time: r.cook_time,
                hydration,
                owner_id: r.owner_id,
                is_public: r.is_public,
                favorite,
                has_video,
                has_combustion,
            }
        })
        .collect();

    Ok(Json(RecipeListResponse {
        recipes: summaries,
        total,
    }))
}

#[derive(Deserialize)]
struct GetRecipeQuery {
    unit: Option<String>,
    temp: Option<String>,
    scale: Option<f64>,
    bakers: Option<bool>,
}

async fn get_recipe(
    MaybeUser(user): MaybeUser,
    Path(id): Path<String>,
    Query(query): Query<GetRecipeQuery>,
) -> ApiResult<impl IntoResponse> {
    if let Some(scale) = query.scale
        && (!scale.is_finite() || scale <= 0.0 || scale > MAX_SCALE)
    {
        return Err(bad_request(format!(
            "'scale' must be greater than 0 and at most {MAX_SCALE}"
        )));
    }

    let user_id = user.as_ref().map(|u| u.id.clone());
    info!("API get_recipe: id='{}', user={:?}", id, user_id);
    let recipe = blocking(move || storage::read_recipe_for_user(&id, user_id.as_deref()))
        .await?
        .ok_or(ApiError::NotFound)?;

    if !can_view(user.as_ref(), &recipe) {
        return Err(ApiError::Forbidden);
    }

    let converted = crate::conversions::convert_recipe(
        recipe,
        query.unit.as_deref(),
        query.temp.as_deref(),
        query.scale,
        query.bakers.unwrap_or(false),
    );
    Ok(Json(converted))
}

/// Client-supplied recipe fields. Server-controlled fields (`id`, `owner_id`,
/// `favorite`, `owner_email`, `html`) are deliberately absent: they are
/// ignored if a client sends them, so they can't be overwritten through the API.
#[derive(Deserialize)]
struct RecipeInput {
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    servings: Option<u32>,
    #[serde(default)]
    prep_time: Option<String>,
    #[serde(default)]
    cook_time: Option<String>,
    #[serde(default)]
    ingredients: Vec<String>,
    #[serde(default)]
    markdown: String,
    #[serde(default)]
    combustion_csv: Option<String>,
    #[serde(default)]
    video_url: Option<String>,
    #[serde(default)]
    is_public: Option<bool>,
}

impl RecipeInput {
    fn validate(&self) -> ApiResult<()> {
        if self.title.trim().is_empty() {
            return Err(bad_request("'title' must not be empty"));
        }
        check_len("title", &self.title, MAX_TITLE_LEN)?;
        check_opt_len("description", &self.description, MAX_SHORT_TEXT_LEN)?;
        check_opt_len("image", &self.image, MAX_URL_LEN)?;
        check_opt_len("source_url", &self.source_url, MAX_URL_LEN)?;
        check_opt_len("video_url", &self.video_url, MAX_URL_LEN)?;
        check_opt_len("prep_time", &self.prep_time, MAX_TAG_LEN)?;
        check_opt_len("cook_time", &self.cook_time, MAX_TAG_LEN)?;
        check_list("tags", &self.tags, MAX_TAGS, MAX_TAG_LEN)?;
        check_list(
            "ingredients",
            &self.ingredients,
            MAX_LIST_ITEMS,
            MAX_ITEM_LEN,
        )?;
        check_len("markdown", &self.markdown, MAX_MARKDOWN_LEN)?;
        if self
            .combustion_csv
            .as_ref()
            .is_some_and(|c| c.len() > MAX_CSV_LEN)
        {
            return Err(bad_request("'combustion_csv' is too large"));
        }
        if self.servings.is_some_and(|s| s == 0 || s > MAX_SERVINGS) {
            return Err(bad_request(format!(
                "'servings' must be between 1 and {MAX_SERVINGS}"
            )));
        }
        Ok(())
    }

    fn into_recipe(
        self,
        id: String,
        owner_id: String,
        favorite: bool,
        default_public: bool,
    ) -> Recipe {
        Recipe {
            id,
            title: self.title.trim().to_string(),
            description: self.description,
            image: self.image,
            source_url: self.source_url,
            tags: self.tags,
            servings: self.servings,
            prep_time: self.prep_time,
            cook_time: self.cook_time,
            ingredients: self.ingredients,
            markdown: self.markdown,
            html: None,
            combustion_csv: self.combustion_csv,
            video_url: self.video_url,
            favorite,
            owner_id,
            is_public: self.is_public.unwrap_or(default_public),
            owner_email: None,
            ..Default::default()
        }
    }
}

/// Generates a slug ID from the title that does not collide with an existing
/// recipe, so creating a recipe can never overwrite another one.
fn unique_recipe_id(title: &str) -> String {
    let base = slug::slugify(title);
    if base.is_empty() {
        return uuid::Uuid::new_v4().to_string();
    }
    if storage::read_recipe(&base).is_none() {
        return base;
    }
    loop {
        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let candidate = format!("{}-{}", base, &suffix[..8]);
        if storage::read_recipe(&candidate).is_none() {
            return candidate;
        }
    }
}

async fn create_recipe(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<RecipeInput>,
) -> ApiResult<Response> {
    input.validate()?;
    info!(
        "API create_recipe: user='{}', title='{}'",
        user.id, input.title
    );

    let recipe = blocking(move || -> Result<Recipe, std::io::Error> {
        let id = unique_recipe_id(&input.title);
        let recipe = input.into_recipe(id, user.id, false, true);
        storage::save_recipe(&recipe)?;
        Ok(recipe)
    })
    .await?
    .map_err(|e| ApiError::Internal(format!("failed to create recipe: {e}")))?;

    let location = format!("{}/api/v1/recipes/{}", state.app_base, recipe.id);
    Ok((
        StatusCode::CREATED,
        [(header::LOCATION, location)],
        Json(recipe),
    )
        .into_response())
}

async fn update_recipe(
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<RecipeInput>,
) -> ApiResult<Json<Recipe>> {
    input.validate()?;
    info!("API update_recipe: user='{}', id='{}'", user.id, id);

    let lookup_id = id.clone();
    let existing = blocking(move || storage::read_recipe(&lookup_id))
        .await?
        .ok_or(ApiError::NotFound)?;
    if !user.can_modify(&existing) {
        return Err(ApiError::Forbidden);
    }

    // Identity, ownership and favourite state are preserved from the stored recipe.
    let recipe = input.into_recipe(
        existing.id,
        existing.owner_id,
        existing.favorite,
        existing.is_public,
    );
    let to_save = recipe.clone();
    blocking(move || storage::save_recipe(&to_save))
        .await?
        .map_err(|e| ApiError::Internal(format!("failed to update recipe {id}: {e}")))?;

    Ok(Json(recipe))
}

async fn delete_recipe(user: CurrentUser, Path(id): Path<String>) -> ApiResult<StatusCode> {
    info!("API delete_recipe: user='{}', id='{}'", user.id, id);
    let lookup_id = id.clone();
    let existing = blocking(move || storage::read_recipe(&lookup_id))
        .await?
        .ok_or(ApiError::NotFound)?;
    if !user.can_modify(&existing) {
        return Err(ApiError::Forbidden);
    }

    let delete_id = id.clone();
    blocking(move || storage::delete_recipe(&delete_id))
        .await?
        .map_err(|e| ApiError::Internal(format!("failed to delete recipe {id}: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Recipe notes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SaveNotesRequest {
    notes: String,
}

#[derive(Serialize)]
struct NotesResponse {
    notes: String,
}

/// Loads a recipe and ensures the user may view it.
async fn load_viewable_recipe(user: &CurrentUser, id: &str) -> ApiResult<Recipe> {
    let (rid, uid) = (id.to_string(), user.id.clone());
    let recipe = blocking(move || storage::read_recipe_for_user(&rid, Some(&uid)))
        .await?
        .ok_or(ApiError::NotFound)?;
    if !can_view(Some(user), &recipe) {
        return Err(ApiError::Forbidden);
    }
    Ok(recipe)
}

async fn get_recipe_notes_api(
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<NotesResponse>> {
    load_viewable_recipe(&user, &id).await?;
    let notes = blocking(move || storage::get_recipe_notes(&user.id, &id))
        .await?
        .unwrap_or_default();
    Ok(Json(NotesResponse { notes }))
}

async fn save_recipe_notes_api(
    user: CurrentUser,
    Path(id): Path<String>,
    Json(payload): Json<SaveNotesRequest>,
) -> ApiResult<Json<NotesResponse>> {
    check_len("notes", &payload.notes, MAX_NOTES_LEN)?;
    info!("API save_recipe_notes: user='{}', id='{}'", user.id, id);
    load_viewable_recipe(&user, &id).await?;

    let notes = payload.notes;
    let to_save = notes.clone();
    blocking(move || storage::save_recipe_notes(&user.id, &id, &to_save))
        .await?
        .map_err(|e| ApiError::Internal(format!("failed to save recipe notes: {e:?}")))?;

    Ok(Json(NotesResponse { notes }))
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ImportRequest {
    url: String,
}

async fn import_recipe(
    user: CurrentUser,
    Json(req): Json<ImportRequest>,
) -> ApiResult<impl IntoResponse> {
    // Import performs outbound requests (and may call Gemini), so it stays
    // restricted to the admin (API token or admin session), as before.
    if !user.is_admin {
        return Err(ApiError::Forbidden);
    }
    if req.url.trim().is_empty() {
        return Err(bad_request("'url' must not be empty"));
    }
    info!("API import_recipe: user='{}', url='{}'", user.id, req.url);
    check_len("url", &req.url, MAX_URL_LEN)?;

    match crate::importer::import_recipe_from_url(&req.url).await {
        Ok(mut recipe) => {
            // Don't save it automatically, just return the parsed recipe
            // so the client can edit and then POST it.
            recipe.id.clear();
            Ok(Json(recipe))
        }
        Err(e) => Err(bad_request(format!("Failed to import: {}", e))),
    }
}

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

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
    MaybeUser(user): MaybeUser,
    Json(payload): Json<ShoppingListRequest>,
) -> ApiResult<Json<ShoppingListResponse>> {
    check_ids("recipe_ids", &payload.recipe_ids)?;
    info!(
        "API generate_shopping_list: recipes={:?}, portions={}",
        payload.recipe_ids, payload.portions
    );
    if payload.portions == 0 || payload.portions > MAX_PORTIONS {
        return Err(bad_request(format!(
            "'portions' must be between 1 and {MAX_PORTIONS}"
        )));
    }
    if !matches!(payload.unit_system.as_str(), "metric" | "imperial") {
        return Err(bad_request("'unit_system' must be 'metric' or 'imperial'"));
    }

    let ids = payload.recipe_ids;
    let viewer = user.clone();
    let recipes = blocking(move || {
        let uid = viewer.as_ref().map(|u| u.id.as_str());
        ids.iter()
            .filter_map(|id| storage::read_recipe_for_user(id, uid))
            .filter(|r| can_view(viewer.as_ref(), r))
            .collect::<Vec<_>>()
    })
    .await?;

    if recipes.is_empty() {
        return Err(bad_request("No valid recipes found"));
    }

    let ingredients = crate::conversions::generate_combined_shopping_list(
        recipes,
        payload.portions,
        &payload.unit_system,
    );

    // Save generated list automatically if user is logged in
    if let Some(user) = user {
        let items: Vec<crate::models::ShoppingItem> = ingredients
            .iter()
            .map(|ing| crate::models::ShoppingItem {
                name: ing.clone(),
                checked: false,
            })
            .collect();
        let uid = user.id;
        if let Err(e) = blocking(move || storage::save_shopping_list(&uid, &items)).await? {
            // The generated list is still returned; only persistence failed.
            warn!("Failed to persist generated shopping list: {}", e);
        }
    }

    Ok(Json(ShoppingListResponse { ingredients }))
}

async fn get_shopping_list(user: CurrentUser) -> ApiResult<impl IntoResponse> {
    info!("API get_shopping_list: user='{}'", user.id);
    // An empty list is a valid state, so return `[]` rather than 404.
    let items = blocking(move || storage::read_shopping_list(&user.id))
        .await?
        .unwrap_or_default();
    Ok(Json(items))
}

async fn update_shopping_list(
    user: CurrentUser,
    Json(payload): Json<Vec<crate::models::ShoppingItem>>,
) -> ApiResult<StatusCode> {
    info!(
        "API update_shopping_list: user='{}', count={}",
        user.id,
        payload.len()
    );
    if payload.len() > MAX_LIST_ITEMS {
        return Err(bad_request(format!(
            "Shopping list must contain at most {MAX_LIST_ITEMS} items"
        )));
    }
    for item in &payload {
        check_len("name", &item.name, MAX_ITEM_LEN)?;
    }

    blocking(move || storage::save_shopping_list(&user.id, &payload))
        .await?
        .map_err(|e| ApiError::Internal(format!("failed to save shopping list: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear_shopping_list(user: CurrentUser) -> ApiResult<StatusCode> {
    info!("API clear_shopping_list: user='{}'", user.id);
    blocking(move || storage::delete_shopping_list(&user.id))
        .await?
        .map_err(|e| ApiError::Internal(format!("failed to clear shopping list: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Calculators & reference data
// ---------------------------------------------------------------------------

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
    Query(query): Query<FermentQuery>,
) -> ApiResult<Json<FermentResult>> {
    info!(
        "API calculate_fermentation: type='{}', amount={}, temp={}",
        query.leaven_type, query.amount, query.temp
    );
    if !query.amount.is_finite() || query.amount <= 0.0 || query.amount > 1_000.0 {
        return Err(bad_request(
            "'amount' must be greater than 0 and at most 1000",
        ));
    }
    if !query.temp.is_finite() || !(-20.0..=60.0).contains(&query.temp) {
        return Err(bad_request("'temp' must be between -20 and 60 °C"));
    }

    let (base_time, temp_factor, amount_factor) = if query.leaven_type == "yeast" {
        (
            2.0,
            f64::powf(2.0, (24.0 - query.temp) / 7.0),
            1.0 / query.amount,
        )
    } else {
        (
            5.0,
            f64::powf(2.0, (24.0 - query.temp) / 6.0),
            20.0 / query.amount,
        )
    };

    let mut estimated_hours = base_time * temp_factor * amount_factor;
    if estimated_hours > 48.0 {
        estimated_hours = 48.0;
    }

    Ok(Json(FermentResult { estimated_hours }))
}

async fn get_cooking_temps() -> impl IntoResponse {
    info!("API get_cooking_temps");
    let temps = vec![
        CookingTempGroup {
            category: "Beef".to_string(),
            items: vec![
                CookingTemp {
                    label: "Rare".to_string(),
                    temp_c: 52.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium Rare".to_string(),
                    temp_c: 57.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium".to_string(),
                    temp_c: 63.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium Well".to_string(),
                    temp_c: 66.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Well Done".to_string(),
                    temp_c: 71.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Ground Beef".to_string(),
                    temp_c: 71.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Brisket (BBQ)".to_string(),
                    temp_c: 93.0,
                    temp_c_max: Some(96.0),
                },
            ],
        },
        CookingTempGroup {
            category: "Pork".to_string(),
            items: vec![
                CookingTemp {
                    label: "Medium Rare".to_string(),
                    temp_c: 57.0,
                    temp_c_max: Some(60.0),
                },
                CookingTemp {
                    label: "Medium".to_string(),
                    temp_c: 63.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium Well".to_string(),
                    temp_c: 66.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Well Done".to_string(),
                    temp_c: 71.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Ground Pork / Sausage".to_string(),
                    temp_c: 71.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Pulled Pork (Shoulder)".to_string(),
                    temp_c: 95.0,
                    temp_c_max: Some(98.0),
                },
            ],
        },
        CookingTempGroup {
            category: "Poultry".to_string(),
            items: vec![
                CookingTemp {
                    label: "Breast / White Meat (Sous Vide)".to_string(),
                    temp_c: 63.0,
                    temp_c_max: Some(66.0),
                },
                CookingTemp {
                    label: "Breast / White Meat (Traditional)".to_string(),
                    temp_c: 74.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Dark Meat (Thighs / Legs)".to_string(),
                    temp_c: 79.0,
                    temp_c_max: Some(85.0),
                },
                CookingTemp {
                    label: "Ground Poultry".to_string(),
                    temp_c: 74.0,
                    temp_c_max: None,
                },
            ],
        },
        CookingTempGroup {
            category: "Lamb".to_string(),
            items: vec![
                CookingTemp {
                    label: "Rare".to_string(),
                    temp_c: 52.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium Rare".to_string(),
                    temp_c: 57.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium".to_string(),
                    temp_c: 60.0,
                    temp_c_max: Some(63.0),
                },
                CookingTemp {
                    label: "Medium Well".to_string(),
                    temp_c: 66.0,
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
            category: "Fish & Seafood".to_string(),
            items: vec![
                CookingTemp {
                    label: "Rare (Tuna / Salmon)".to_string(),
                    temp_c: 43.0,
                    temp_c_max: Some(49.0),
                },
                CookingTemp {
                    label: "Medium Rare".to_string(),
                    temp_c: 52.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Medium".to_string(),
                    temp_c: 57.0,
                    temp_c_max: None,
                },
                CookingTemp {
                    label: "Well Done (USDA)".to_string(),
                    temp_c: 63.0,
                    temp_c_max: None,
                },
            ],
        },
    ];

    // Static reference data: safe to cache.
    (
        [(header::CACHE_CONTROL, "public, max-age=86400")],
        Json(temps),
    )
}

async fn get_spices() -> ApiResult<impl IntoResponse> {
    Ok(Json(blocking(crate::storage::list_spices).await?))
}

async fn calculate_log7(Query(query): Query<Log7Query>) -> ApiResult<Json<Log7Response>> {
    let temp_c = query.temp;
    if !temp_c.is_finite() {
        return Err(bad_request("'temp' must be a finite number"));
    }
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

    Ok(Json(Log7Response {
        temp_c,
        seconds,
        display_time,
    }))
}

// ---------------------------------------------------------------------------
// Meal plan
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct MealPlanResponse {
    meals: Vec<PlannedMealItem>,
}

#[derive(Serialize)]
struct PlannedMealItem {
    recipe_id: String,
    title: String,
    checked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<String>,
    has_recipe: bool,
}

#[derive(Deserialize)]
struct AddMealPlanRequest {
    recipe_ids: Vec<String>,
}

#[derive(Deserialize)]
struct ToggleMealRequest {
    recipe_id: String,
}

async fn get_meal_plan(user: CurrentUser) -> ApiResult<impl IntoResponse> {
    info!("API get_meal_plan: user_id='{}'", user.id);
    let viewer = user.clone();
    let items = blocking(move || {
        storage::read_meal_plan(&viewer.id)
            .into_iter()
            .map(|meal| {
                let (title, image, has_recipe) = if meal.recipe_id.starts_with("manual:") {
                    (
                        meal.recipe_id.trim_start_matches("manual:").to_string(),
                        None,
                        false,
                    )
                } else {
                    match storage::read_recipe(&meal.recipe_id) {
                        // Only reveal titles of recipes the user is allowed to see.
                        Some(recipe) if can_view(Some(&viewer), &recipe) => {
                            (recipe.title, recipe.image, true)
                        }
                        Some(_) => ("Unavailable recipe".to_string(), None, false),
                        None => (meal.recipe_id.clone(), None, false),
                    }
                };
                PlannedMealItem {
                    recipe_id: meal.recipe_id,
                    title,
                    checked: meal.checked,
                    image,
                    has_recipe,
                }
            })
            .collect::<Vec<_>>()
    })
    .await?;
    debug!(
        "Returning {} meal plan items for user_id={}",
        items.len(),
        user.id
    );

    Ok((
        [
            (
                header::CACHE_CONTROL,
                "no-store, no-cache, must-revalidate, private",
            ),
            (header::VARY, "Cookie"),
        ],
        Json(MealPlanResponse { meals: items }),
    ))
}

async fn save_meals(user_id: String, meals: Vec<crate::models::PlannedMeal>) -> ApiResult<()> {
    blocking(move || storage::save_meal_plan(&user_id, &meals))
        .await?
        .map_err(|e| ApiError::Internal(format!("failed to save meal plan: {e:?}")))
}

async fn add_to_meal_plan(
    user: CurrentUser,
    Json(payload): Json<AddMealPlanRequest>,
) -> ApiResult<StatusCode> {
    check_ids("recipe_ids", &payload.recipe_ids)?;
    info!(
        "API add_to_meal_plan: user='{}', recipe_ids={:?}",
        user.id, payload.recipe_ids
    );

    let uid = user.id.clone();
    let mut meals = blocking(move || storage::read_meal_plan(&uid)).await?;
    for id in payload.recipe_ids {
        if !meals.iter().any(|m| m.recipe_id == id) {
            meals.push(crate::models::PlannedMeal {
                recipe_id: id,
                checked: false,
            });
        }
    }

    save_meals(user.id, meals).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn toggle_meal_plan(
    user: CurrentUser,
    Json(payload): Json<ToggleMealRequest>,
) -> ApiResult<StatusCode> {
    info!(
        "API toggle_meal_plan: user='{}', recipe_id='{}'",
        user.id, payload.recipe_id
    );
    let uid = user.id.clone();
    let mut meals = blocking(move || storage::read_meal_plan(&uid)).await?;
    let meal = meals
        .iter_mut()
        .find(|m| m.recipe_id == payload.recipe_id)
        .ok_or(ApiError::NotFound)?;
    meal.checked = !meal.checked;

    save_meals(user.id, meals).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear_meal_plan(user: CurrentUser) -> ApiResult<StatusCode> {
    save_meals(user.id, Vec::new()).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_meal_plan_item(
    user: CurrentUser,
    Path(recipe_id): Path<String>,
) -> ApiResult<StatusCode> {
    info!(
        "API delete_meal_plan_item: user='{}', recipe_id='{}'",
        user.id, recipe_id
    );
    let uid = user.id.clone();
    let mut meals = blocking(move || storage::read_meal_plan(&uid)).await?;
    let original_len = meals.len();
    meals.retain(|m| m.recipe_id != recipe_id);

    if meals.len() == original_len {
        return Err(ApiError::NotFound);
    }

    save_meals(user.id, meals).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct LoginPayload {
    pub email: String,
    pub password: String,
}

pub async fn api_login(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
    Json(payload): Json<LoginPayload>,
) -> ApiResult<(PrivateCookieJar, Json<serde_json::Value>)> {
    let admin_email = std::env::var("ADMIN_EMAIL").unwrap_or_default();
    let email_lookup = if payload.email.trim().to_lowercase() == "admin" {
        admin_email
    } else {
        payload.email.trim().to_string()
    };

    let user = storage::find_user_by_email(&email_lookup).ok_or(ApiError::Unauthorized)?;
    info!("API login attempt for email: {}", email_lookup);
    if !bcrypt::verify(&payload.password, &user.password_hash).unwrap_or(false) {
        return Err(ApiError::Unauthorized);
    }

    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };

    let cookie = Cookie::build(("admin_session", user.id.clone()))
        .path(cookie_path)
        .http_only(true)
        .secure(crate::is_cookie_secure())
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(30))
        .build();
    let updated_jar = jar.add(cookie);

    let is_admin = admin_user_id().as_deref() == Some(&user.id);

    Ok((
        updated_jar,
        Json(serde_json::json!({
            "success": true,
            "user": {
                "id": user.id,
                "email": user.email,
                "is_admin": is_admin
            }
        })),
    ))
}

pub async fn api_logout(
    State(state): State<AppState>,
    jar: PrivateCookieJar,
) -> (PrivateCookieJar, Json<serde_json::Value>) {
    info!("API logout called");
    let cookie_path = if state.app_base.is_empty() {
        "/"
    } else {
        state.app_base
    };
    let updated_jar = jar.remove(Cookie::build("admin_session").path(cookie_path).build());
    (updated_jar, Json(serde_json::json!({ "success": true })))
}

pub async fn get_current_user_api(
    State(state): State<AppState>,
    MaybeUser(user): MaybeUser,
) -> impl IntoResponse {
    let user_info = if let Some(u) = user {
        let email = storage::find_user_by_id(&u.id).map(|user| user.email);
        Some(serde_json::json!({
            "id": u.id,
            "email": email,
            "is_admin": u.is_admin,
        }))
    } else {
        None
    };

    let config = serde_json::json!({
        "app_base": state.app_base,
        "google_auth_enabled": state.google_oauth.is_some(),
        "oidc_auth_enabled": state.oidc.is_some(),
        "oidc_provider_name": state.oidc.as_ref().map(|o| o.provider_name.clone()).unwrap_or_default(),
    });

    Json(serde_json::json!({
        "user": user_info,
        "config": config,
    }))
}

pub async fn export_user_data_api(user: CurrentUser) -> ApiResult<Response> {
    info!("API export_user_data: user_id='{}'", user.id);
    let data = blocking(move || storage::export_user_data(&user.id))
        .await?
        .map_err(|e| ApiError::Internal(format!("failed to export user data: {e}")))?;

    let json_bytes = serde_json::to_vec_pretty(&data)
        .map_err(|e| ApiError::Internal(format!("failed to serialize export data: {e}")))?;

    let filename = format!("recipe-manager-export-{}.json", data.user_id);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(axum::body::Body::from(json_bytes))
        .map_err(|e| ApiError::Internal(format!("failed to build response: {e}")))
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AdminUserDto {
    pub id: String,
    pub email: String,
    pub created_at: String,
    pub is_admin: bool,
    pub has_password: bool,
    pub passkey_count: usize,
}

#[derive(Deserialize)]
pub struct ResetPasswordPayload {
    pub password: String,
}

pub async fn admin_list_users(user: CurrentUser) -> ApiResult<Json<Vec<AdminUserDto>>> {
    if !user.is_admin {
        return Err(ApiError::Forbidden);
    }
    let users = blocking(storage::list_users).await?;
    let admin_id = blocking(admin_user_id).await?;
    let mut dtos = Vec::with_capacity(users.len());
    for u in users {
        let uid = u.id.clone();
        let passkey_count = blocking(move || storage::find_passkeys_by_user_id(&uid).len()).await?;
        let is_admin = admin_id.as_deref() == Some(&u.id);
        dtos.push(AdminUserDto {
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            is_admin,
            has_password: !u.password_hash.is_empty(),
            passkey_count,
        });
    }
    Ok(Json(dtos))
}

pub async fn admin_delete_user(
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    if !user.is_admin {
        return Err(ApiError::Forbidden);
    }
    if user.id == id {
        return Err(ApiError::BadRequest(
            "Cannot delete your own administrator account.".into(),
        ));
    }
    let target_id = id.clone();
    blocking(move || storage::delete_user(&target_id))
        .await?
        .map_err(|e| ApiError::Internal(format!("Failed to delete user: {e}")))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn admin_reset_password(
    user: CurrentUser,
    Path(id): Path<String>,
    Json(payload): Json<ResetPasswordPayload>,
) -> ApiResult<Json<serde_json::Value>> {
    if !user.is_admin {
        return Err(ApiError::Forbidden);
    }
    if payload.password.trim().is_empty() {
        return Err(ApiError::BadRequest("Password cannot be empty.".into()));
    }
    let target_id = id.clone();
    let target_user = blocking(move || storage::find_user_by_id(&target_id))
        .await?
        .ok_or(ApiError::NotFound)?;
    if target_user.password_hash.is_empty() {
        return Err(ApiError::BadRequest(
            "Cannot reset password for users who registered via external authentication (OAuth/OIDC).".into()
        ));
    }
    let hashed = bcrypt::hash(&payload.password, bcrypt::DEFAULT_COST)
        .map_err(|e| ApiError::Internal(format!("Failed to hash password: {e}")))?;
    let target_id2 = id.clone();
    blocking(move || storage::update_user_password(&target_id2, &hashed))
        .await?
        .map_err(|e| ApiError::Internal(format!("Failed to update password: {e}")))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Recipe;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    const TEST_TOKEN: &str = "test-token";

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
            oidc: None,
            webauthn,
            reg_states,
            auth_states,
            api_token: Some(TEST_TOKEN.to_string()),
        }
    }

    fn session_cookie(state: &AppState, user_id: &str) -> String {
        let cookie = axum_extra::extract::cookie::Cookie::new("admin_session", user_id.to_string());
        let jar = axum_extra::extract::cookie::PrivateCookieJar::new(state.key.clone()).add(cookie);
        let response = axum::response::IntoResponse::into_response(jar);
        response
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string()
    }

    fn save_test_user(id: &str, email: &str) {
        storage::save_user(&crate::models::User {
            id: id.to_string(),
            email: email.to_string(),
            password_hash: "hash".to_string(),
            created_at: "".to_string(),
        })
        .unwrap();
    }

    fn sample_recipe(id: &str, owner_id: &str, is_public: bool) -> Recipe {
        Recipe {
            id: id.to_string(),
            title: format!("Recipe {id}"),
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
            owner_id: owner_id.to_string(),
            is_public,
            owner_email: None,
            ..Default::default()
        }
    }

    async fn json_body(response: Response) -> serde_json::Value {
        let body = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&body).unwrap()
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
        let body = json_body(response).await;
        assert_eq!(body["error"]["code"], "unauthorized");
    }

    #[tokio::test]
    async fn test_invalid_bearer_token_rejected() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        let req = Request::builder()
            .method("GET")
            .uri("/recipes")
            .header("Authorization", "Bearer wrong-token")
            .body(Body::empty())
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

        let list = json_body(response).await;
        assert!(list.get("recipes").is_some());
        assert!(list.get("total").is_some());
    }

    #[tokio::test]
    async fn test_list_recipes_rejects_invalid_limit() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        let req = Request::builder()
            .method("GET")
            .uri("/recipes?limit=0")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_recipe_lifecycle() {
        // Ensure data/recipes exists
        let _ = std::fs::create_dir_all("data/recipes");

        let state = test_state();
        let app = router(state.clone()).with_state(state);

        let payload = serde_json::json!({
            "title": "API Lifecycle Test",
            "tags": ["test"],
            "servings": 4,
            "ingredients": ["100g flour"],
            "markdown": "Test",
        });

        // 1. Create (server assigns the ID)
        let req = Request::builder()
            .method("POST")
            .uri("/recipes")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::from(payload.to_string()))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let location = response
            .headers()
            .get(header::LOCATION)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let created = json_body(response).await;
        let test_id = created["id"].as_str().unwrap().to_string();
        assert!(test_id.starts_with("api-lifecycle-test"));
        assert_eq!(location, format!("/api/v1/recipes/{test_id}"));

        // 2. Get with conversions
        let req = Request::builder()
            .method("GET")
            .uri(format!("/recipes/{}?unit=imperial&scale=2", test_id))
            .body(Body::empty())
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let converted = json_body(response).await;
        assert_eq!(converted["title"], "API Lifecycle Test");
        // 100g * 2 = 200g. 200g in imperial is ~7.1 oz
        assert!(converted["ingredients"][0].as_str().unwrap().contains("oz"));

        // 3. Update
        let mut updated = payload.clone();
        updated["title"] = "Updated Title".into();
        let req = Request::builder()
            .method("PUT")
            .uri(format!("/recipes/{}", test_id))
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::from(updated.to_string()))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["id"], test_id.as_str());
        assert_eq!(body["title"], "Updated Title");

        // 4. Delete
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/recipes/{}", test_id))
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::empty())
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // 5. Deleting again yields 404
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/recipes/{}", test_id))
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // 6. PUT /recipes/ (empty ID from imported draft on cached client) creates recipe
        let req = Request::builder()
            .method("PUT")
            .uri("/recipes/")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::from(payload.to_string()))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let created_via_put = json_body(response).await;
        let put_id = created_via_put["id"].as_str().unwrap().to_string();
        assert!(!put_id.is_empty());
        let _ = storage::delete_recipe(&put_id);
    }

    #[tokio::test]
    async fn test_create_cannot_overwrite_or_spoof_owner() {
        let state = test_state();
        let app = router(state.clone()).with_state(state.clone());

        let victim_id = "api-victim-user";
        let attacker_id = "api-attacker-user";
        save_test_user(victim_id, "victim@example.com");
        save_test_user(attacker_id, "attacker@example.com");

        let existing_id = "api-overwrite-target";
        storage::save_recipe(&sample_recipe(existing_id, victim_id, true)).unwrap();

        // Attacker tries to POST with the victim's recipe id and owner id
        let payload = serde_json::json!({
            "id": existing_id,
            "owner_id": victim_id,
            "title": format!("Recipe {existing_id}"),
            "markdown": "pwned",
        });
        let req = Request::builder()
            .method("POST")
            .uri("/recipes")
            .header("Content-Type", "application/json")
            .header("Cookie", session_cookie(&state, attacker_id))
            .body(Body::from(payload.to_string()))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let created = json_body(response).await;
        let new_id = created["id"].as_str().unwrap().to_string();

        assert_ne!(new_id, existing_id, "must not reuse an existing id");
        assert_eq!(created["owner_id"], attacker_id, "owner must be the caller");
        let original = storage::read_recipe(existing_id).unwrap();
        assert_eq!(original.markdown, "Secret instructions");
        assert_eq!(original.owner_id, victim_id);

        let _ = storage::delete_recipe(existing_id);
        let _ = storage::delete_recipe(&new_id);
        let _ = storage::delete_user(victim_id);
        let _ = storage::delete_user(attacker_id);
    }

    #[tokio::test]
    async fn test_non_owner_cannot_update_or_delete() {
        let state = test_state();
        let app = router(state.clone()).with_state(state.clone());

        let owner_id = "api-owner-user";
        let other_id = "api-other-user";
        save_test_user(owner_id, "owner@example.com");
        save_test_user(other_id, "other@example.com");

        let recipe_id = "api-owned-recipe";
        storage::save_recipe(&sample_recipe(recipe_id, owner_id, true)).unwrap();
        let other_cookie = session_cookie(&state, other_id);

        let req = Request::builder()
            .method("PUT")
            .uri(format!("/recipes/{recipe_id}"))
            .header("Content-Type", "application/json")
            .header("Cookie", &other_cookie)
            .body(Body::from(
                serde_json::json!({"title": "Hijacked"}).to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/recipes/{recipe_id}"))
            .header("Cookie", &other_cookie)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(storage::read_recipe(recipe_id).is_some());

        // The owner can update via their session; owner_id in the body is ignored.
        let req = Request::builder()
            .method("PUT")
            .uri(format!("/recipes/{recipe_id}"))
            .header("Content-Type", "application/json")
            .header("Cookie", session_cookie(&state, owner_id))
            .body(Body::from(
                serde_json::json!({"title": "Renamed", "owner_id": other_id}).to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let stored = storage::read_recipe(recipe_id).unwrap();
        assert_eq!(stored.title, "Renamed");
        assert_eq!(stored.owner_id, owner_id);

        // Updating a missing recipe is 404, not an implicit create.
        let req = Request::builder()
            .method("PUT")
            .uri("/recipes/api-does-not-exist")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::from(
                serde_json::json!({"title": "Ghost"}).to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(storage::read_recipe("api-does-not-exist").is_none());

        let _ = storage::delete_recipe(recipe_id);
        let _ = storage::delete_user(owner_id);
        let _ = storage::delete_user(other_id);
    }

    #[tokio::test]
    async fn test_recipe_validation() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        for payload in [
            serde_json::json!({"title": "   "}),
            serde_json::json!({"title": "x".repeat(MAX_TITLE_LEN + 1)}),
            serde_json::json!({"title": "ok", "servings": 0}),
        ] {
            let req = Request::builder()
                .method("POST")
                .uri("/recipes")
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {TEST_TOKEN}"))
                .body(Body::from(payload.to_string()))
                .unwrap();
            let response = app.clone().oneshot(req).await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let body = json_body(response).await;
            assert_eq!(body["error"]["code"], "bad_request");
        }

        let req = Request::builder()
            .method("GET")
            .uri("/recipes/anything?scale=-1")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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
        assert!(response.headers().get(header::CACHE_CONTROL).is_some());
        let temps = json_body(response).await;
        assert!(!temps.as_array().unwrap().is_empty());

        // Test /log7
        let req = Request::builder()
            .method("GET")
            .uri("/log7?temp=65.0")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let log7 = json_body(response).await;
        assert_eq!(log7["temp_c"], 65.0);
        assert!(log7["display_time"].as_str().unwrap().contains("Min"));

        // Invalid fermentation input is rejected instead of producing nonsense
        let req = Request::builder()
            .method("GET")
            .uri("/ferment?type=yeast&amount=0&temp=24")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_private_recipe_api_access() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        let private_recipe_id = "api-private-test-recipe";
        let owner_id = "some-user-id".to_string();
        save_test_user(&owner_id, "some-user@example.com");

        // Save directly to storage
        storage::save_recipe(&sample_recipe(private_recipe_id, &owner_id, false)).unwrap();

        // 1. Verify GET /recipes does not contain the private recipe
        let req = Request::builder()
            .method("GET")
            .uri("/recipes")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let list = json_body(response).await;
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
    async fn test_meal_plan_hides_private_titles() {
        let state = test_state();
        let app = router(state.clone()).with_state(state.clone());

        let owner_id = "api-meal-owner";
        let viewer_id = "api-meal-viewer";
        save_test_user(owner_id, "meal-owner@example.com");
        save_test_user(viewer_id, "meal-viewer@example.com");

        let private_id = "api-meal-private-recipe";
        storage::save_recipe(&sample_recipe(private_id, owner_id, false)).unwrap();
        let cookie = session_cookie(&state, viewer_id);

        let req = Request::builder()
            .method("POST")
            .uri("/meal-plan")
            .header("Content-Type", "application/json")
            .header("Cookie", &cookie)
            .body(Body::from(
                serde_json::json!({"recipe_ids": [private_id]}).to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let req = Request::builder()
            .method("GET")
            .uri("/meal-plan")
            .header("Cookie", &cookie)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["meals"][0]["title"], "Unavailable recipe");

        let _ = storage::save_meal_plan(viewer_id, &[]);
        let _ = storage::delete_recipe(private_id);
        let _ = storage::delete_user(owner_id);
        let _ = storage::delete_user(viewer_id);
    }

    #[tokio::test]
    async fn test_shopping_list_persistence() {
        let state = test_state();
        let app = router(state.clone()).with_state(state.clone());

        let user_id = "shopping-test-user";
        save_test_user(user_id, "shopping@example.com");

        // Construct encrypted cookie header
        let cookie_header_val = session_cookie(&state, user_id);

        // 1. GET /shopping-list initially should return an empty list
        let req = Request::builder()
            .method("GET")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let initial: Vec<crate::models::ShoppingItem> =
            serde_json::from_value(json_body(response).await).unwrap();
        assert!(initial.is_empty());

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
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // 3. GET /shopping-list to verify list is saved correctly
        let req = Request::builder()
            .method("GET")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let fetched: Vec<crate::models::ShoppingItem> =
            serde_json::from_value(json_body(response).await).unwrap();
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

        // 5. GET /shopping-list to verify list is empty again
        let req = Request::builder()
            .method("GET")
            .uri("/shopping-list")
            .header("Cookie", &cookie_header_val)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let cleared: Vec<crate::models::ShoppingItem> =
            serde_json::from_value(json_body(response).await).unwrap();
        assert!(cleared.is_empty());

        // Clean up
        let _ = storage::delete_user(user_id);
    }

    #[tokio::test]
    async fn test_openapi_spec() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);
        let req = Request::builder()
            .method("GET")
            .uri("/openapi.json")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let val = json_body(response).await;
        assert_eq!(val["openapi"], "3.0.3");
        assert_eq!(val["info"]["title"], "Recipe Manager API");
        assert!(val["paths"]["/recipes"].is_object());
        assert!(val["paths"]["/recipes/{id}"].is_object());
    }

    #[tokio::test]
    async fn test_auth_endpoints() {
        let state = test_state();
        let app = router(state.clone()).with_state(state.clone());

        // 1. Unauthenticated /auth/me
        let req = Request::builder()
            .method("GET")
            .uri("/auth/me")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let val = json_body(response).await;
        assert!(val["user"].is_null());

        // Create a test user with valid bcrypt hash
        let test_pass = "testpassword";
        let hash = bcrypt::hash(test_pass, 4).unwrap();
        storage::save_user(&crate::models::User {
            id: "auth-test-user".to_string(),
            email: "authtest@example.com".to_string(),
            password_hash: hash,
            created_at: "".to_string(),
        })
        .unwrap();

        // 2. Successful Login
        let req = Request::builder()
            .method("POST")
            .uri("/auth/login")
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "email": "authtest@example.com",
                    "password": "testpassword"
                }))
                .unwrap(),
            ))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let login_res = json_body(response).await;
        assert_eq!(login_res["success"], true);

        // 3. Bad Password Login
        let req = Request::builder()
            .method("POST")
            .uri("/auth/login")
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "email": "authtest@example.com",
                    "password": "wrongpassword"
                }))
                .unwrap(),
            ))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        // 4. Logout
        let req = Request::builder()
            .method("POST")
            .uri("/auth/logout")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let _ = storage::delete_user("auth-test-user");
    }

    #[tokio::test]
    async fn test_recipe_structured_api() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);
        let admin_id = storage::find_user_by_email("admin@example.com").unwrap().id;
        let r = Recipe {
            id: "api-struct-test".to_string(),
            title: "Structured API Recipe".to_string(),
            description: Some("Oven 350°F".to_string()),
            image: None,
            source_url: None,
            tags: vec!["bread".to_string()],
            servings: Some(2),
            prep_time: None,
            cook_time: None,
            ingredients: vec![
                "## Starter".to_string(),
                "100g sourdough starter".to_string(),
                "## Dough".to_string(),
                "500g bread flour".to_string(),
                "350g water".to_string(),
            ],
            markdown: "1. Mix starter and water.\n2. Add flour and autolyse.".to_string(),
            owner_id: admin_id,
            is_public: true,
            ..Default::default()
        };
        storage::save_recipe(&r).unwrap();

        // Query with scaling x2 and metric unit
        let req = Request::builder()
            .method("GET")
            .uri("/recipes/api-struct-test?scale=2&unit=metric&temp=c&bakers=true")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["id"], "api-struct-test");
        assert_eq!(body["servings"], 4);
        assert!(body["structured_ingredients"].is_array());
        let structured = body["structured_ingredients"].as_array().unwrap();
        assert_eq!(structured.len(), 5);
        assert_eq!(structured[0]["is_header"], true);
        assert_eq!(structured[0]["name"], "Starter");
        assert_eq!(structured[2]["is_header"], true);
        assert_eq!(structured[2]["name"], "Dough");

        assert!(body["steps"].is_array());
        let steps = body["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0]["instruction"], "Mix starter and water.");

        // Cleanup
        let _ = storage::delete_recipe("api-struct-test");
    }

    #[tokio::test]
    async fn test_admin_user_management_api() {
        let state = test_state();
        let app = router(state.clone()).with_state(state);

        // 1. Non-admin or unauthenticated access should be rejected
        let req = Request::builder()
            .method("GET")
            .uri("/admin/users")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

        // 2. Admin access with bearer token
        let req = Request::builder()
            .method("GET")
            .uri("/admin/users")
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let users: Vec<AdminUserDto> = serde_json::from_slice(
            &axum::body::to_bytes(res.into_body(), 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(!users.is_empty());
        let admin_entry = users
            .iter()
            .find(|u| u.email == "admin@example.com")
            .unwrap();
        assert!(admin_entry.is_admin);

        // 3. Create a secondary test user directly
        let test_user_id = "test-user-admin-mgmt-uuid";
        storage::save_user(&crate::models::User {
            id: test_user_id.to_string(),
            email: "testuser@example.com".to_string(),
            password_hash: "hashedpass".to_string(),
            created_at: String::new(),
        })
        .unwrap();

        // 4. Reset password via admin API
        let req = Request::builder()
            .method("POST")
            .uri(format!("/admin/users/{test_user_id}/reset-password"))
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"password": "newsecretpassword123"}"#))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // 5. Delete test user via admin API
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/admin/users/{test_user_id}"))
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // 6. Attempting to delete own admin account should fail
        let admin_id = storage::find_user_by_email("admin@example.com").unwrap().id;
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/admin/users/{admin_id}"))
            .header("Authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
