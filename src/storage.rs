#![allow(clippy::io_other_error, clippy::bool_assert_comparison)]
use crate::models::Recipe;
use image::{GenericImageView, ImageFormat};
use pulldown_cmark::{Parser, html};
use std::io::Cursor;
use std::path::PathBuf;

const RECIPES_DIR: &str = "data/recipes";

#[cfg(test)]
thread_local! {
    static DB_PATH_TEST: std::cell::RefCell<String> = std::cell::RefCell::new({
        let _ = std::fs::create_dir_all("target/test_dbs");
        format!("target/test_dbs/recipes_test_{}.db", uuid::Uuid::new_v4())
    });
}

#[cfg(test)]
fn get_db_path() -> String {
    DB_PATH_TEST.with(|path| path.borrow().clone())
}

#[cfg(not(test))]
fn get_db_path() -> String {
    "data/recipes.db".to_string()
}

pub fn get_recipes_dir() -> PathBuf {
    PathBuf::from(RECIPES_DIR)
}

pub fn db_init(
    admin_password_hash: &str,
    admin_email: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Ensure directories exist
    let _ = std::fs::create_dir_all("data");
    let _ = std::fs::create_dir_all("target");

    let conn = rusqlite::Connection::open(get_db_path())?;

    // Create users table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Create recipes table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            image TEXT,
            source_url TEXT,
            tags TEXT,
            servings INTEGER,
            prep_time TEXT,
            cook_time TEXT,
            ingredients TEXT,
            markdown TEXT NOT NULL,
            combustion_csv TEXT,
            video_url TEXT,
            favorite INTEGER DEFAULT 0,
            owner_id TEXT NOT NULL,
            is_public INTEGER DEFAULT 1,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        )",
        [],
    )?;

    // Create meal_plans table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meal_plans (
            recipe_id TEXT PRIMARY KEY,
            checked INTEGER DEFAULT 0
        )",
        [],
    )?;

    // Seed default admin user if no users exist
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM users")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;

    let admin_id = if count == 0 {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)",
            (&id, &admin_email, &admin_password_hash),
        )?;
        tracing::info!("Seeded default administrator: {} (ID: {})", admin_email, id);
        id
    } else {
        let mut stmt = conn.prepare("SELECT id FROM users LIMIT 1")?;
        stmt.query_row([], |row| row.get::<_, String>(0))?
    };

    // AUTOMATIC DATA MIGRATION FROM FLAT MARKDOWN FILES
    // Clean up any bad legacy migration entries with empty string IDs
    let _ = conn.execute("DELETE FROM recipes WHERE id = ''", []);

    let dir = get_recipes_dir();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut migrated_count = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = match path.file_name().and_then(|s| s.to_str()) {
                Some(f) => f,
                None => continue,
            };

            let (id, is_bak) = if let Some(stripped) = filename.strip_suffix(".md.bak") {
                (stripped.to_string(), true)
            } else if let Some(stripped) = filename.strip_suffix(".md") {
                (stripped.to_string(), false)
            } else {
                continue;
            };

            // Skip special files like ".md"
            if id.is_empty() {
                continue;
            }

            let mut stmt = conn.prepare("SELECT COUNT(*) FROM recipes WHERE id = ?1")?;
            let exists: i64 = stmt.query_row([&id], |row| row.get(0))?;
            if exists == 0 {
                if let Some(mut recipe) = read_recipe_file(&path) {
                    recipe.id = id.clone();
                    recipe.owner_id = admin_id.clone();
                    recipe.is_public = true; // backward compatibility
                    if let Err(e) = save_recipe_db(&conn, &recipe) {
                        tracing::error!(
                            "Failed to migrate recipe {} (ID: {}): {:?}",
                            recipe.title,
                            id,
                            e
                        );
                    } else {
                        migrated_count += 1;
                    }
                }
            }

            // For .md files, rename them to .md.bak to prevent duplicate migration runs in future
            if !is_bak {
                let mut bak_path = path.clone();
                bak_path.set_extension("md.bak");
                let _ = std::fs::rename(&path, bak_path);
            }
        }
        if migrated_count > 0 {
            tracing::info!(
                "Successfully migrated {} Markdown recipes into SQLite!",
                migrated_count
            );
        }
    }

    // AUTOMATIC MEAL PLAN MIGRATION FROM JSON FILE
    let meal_plan_path = std::path::Path::new("data/meal_plan.json");
    if meal_plan_path.exists() {
        if let Ok(content) = std::fs::read_to_string(meal_plan_path) {
            if let Ok(meals) = serde_json::from_str::<Vec<crate::models::PlannedMeal>>(&content) {
                let mut migrated_meals_count = 0;
                for meal in meals {
                    // Check if it already exists in the table to avoid primary key conflict
                    let mut stmt =
                        conn.prepare("SELECT COUNT(*) FROM meal_plans WHERE recipe_id = ?1")?;
                    let exists: i64 = stmt.query_row([&meal.recipe_id], |row| row.get(0))?;
                    if exists == 0 {
                        let checked_int = if meal.checked { 1 } else { 0 };
                        if conn
                            .execute(
                                "INSERT INTO meal_plans (recipe_id, checked) VALUES (?1, ?2)",
                                (&meal.recipe_id, checked_int),
                            )
                            .is_ok()
                        {
                            migrated_meals_count += 1;
                        }
                    }
                }
                if migrated_meals_count > 0 {
                    tracing::info!(
                        "Successfully migrated {} planned meals from JSON into SQLite!",
                        migrated_meals_count
                    );
                }
            }
        }
        // Rename the meal_plan.json to meal_plan.json.bak to prevent duplicate migration runs
        let mut bak_path = meal_plan_path.to_path_buf();
        bak_path.set_extension("json.bak");
        let _ = std::fs::rename(meal_plan_path, bak_path);
    }

    Ok(())
}

fn read_recipe_file(path: &std::path::Path) -> Option<Recipe> {
    let content = std::fs::read_to_string(path).ok()?;
    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() == 3 {
        let frontmatter = parts[1];
        let markdown = parts[2].trim_start().to_string();

        if let Ok(mut recipe) = serde_yaml::from_str::<Recipe>(frontmatter) {
            recipe.markdown = markdown;
            if let Some(img) = &mut recipe.image {
                if img.starts_with("/uploads/") {
                    *img = img[1..].to_string();
                }
            }
            if let Some(csv) = &mut recipe.combustion_csv {
                if csv.starts_with("/uploads/") {
                    *csv = csv[1..].to_string();
                }
            }
            return Some(recipe);
        }
    }
    None
}

pub fn list_recipes() -> Vec<Recipe> {
    list_recipes_for_user(None)
}

pub fn list_recipes_for_user(user_id: Option<&str>) -> Vec<Recipe> {
    let conn = match rusqlite::Connection::open(get_db_path()) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match user_id {
        Some(_) => conn.prepare(
            "SELECT id, title, description, image, source_url, tags, servings, 
                    prep_time, cook_time, ingredients, markdown, combustion_csv, 
                    video_url, favorite, owner_id, is_public 
             FROM recipes WHERE is_public = 1 OR owner_id = ?1",
        ),
        None => conn.prepare(
            "SELECT id, title, description, image, source_url, tags, servings, 
                    prep_time, cook_time, ingredients, markdown, combustion_csv, 
                    video_url, favorite, owner_id, is_public 
             FROM recipes WHERE is_public = 1",
        ),
    }
    .unwrap();

    let row_to_recipe = |row: &rusqlite::Row| {
        let tags_str: String = row.get(5)?;
        let tags = tags_str
            .split(',')
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let ingredients_str: String = row.get(9)?;
        let ingredients = ingredients_str.lines().map(|s| s.to_string()).collect();
        let is_public_int: i32 = row.get(15)?;
        let favorite_int: i32 = row.get(13)?;

        let mut recipe = Recipe {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            image: row.get(3)?,
            source_url: row.get(4)?,
            tags,
            servings: row.get(6)?,
            prep_time: row.get(7)?,
            cook_time: row.get(8)?,
            ingredients,
            markdown: row.get(10)?,
            html: None,
            combustion_csv: row.get(11)?,
            video_url: row.get(12)?,
            favorite: favorite_int != 0,
            owner_id: row.get(14)?,
            is_public: is_public_int != 0,
        };

        let parser = Parser::new(&recipe.markdown);
        let mut html_output = String::new();
        html::push_html(&mut html_output, parser);
        recipe.html = Some(html_output);

        Ok(recipe)
    };

    let params: Vec<&str> = match user_id {
        Some(uid) => vec![uid],
        None => vec![],
    };

    let recipe_iter = stmt
        .query_map(rusqlite::params_from_iter(params), row_to_recipe)
        .unwrap();
    let mut recipes: Vec<Recipe> = recipe_iter.flatten().collect();
    recipes.sort_by(|a, b| a.title.cmp(&b.title));
    recipes
}

pub fn read_recipe(id: &str) -> Option<Recipe> {
    let conn = rusqlite::Connection::open(get_db_path()).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, image, source_url, tags, servings, 
                    prep_time, cook_time, ingredients, markdown, combustion_csv, 
                    video_url, favorite, owner_id, is_public 
             FROM recipes WHERE id = ?1",
        )
        .ok()?;

    let row_to_recipe = |row: &rusqlite::Row| {
        let tags_str: String = row.get(5)?;
        let tags = tags_str
            .split(',')
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let ingredients_str: String = row.get(9)?;
        let ingredients = ingredients_str.lines().map(|s| s.to_string()).collect();
        let is_public_int: i32 = row.get(15)?;
        let favorite_int: i32 = row.get(13)?;

        let mut recipe = Recipe {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            image: row.get(3)?,
            source_url: row.get(4)?,
            tags,
            servings: row.get(6)?,
            prep_time: row.get(7)?,
            cook_time: row.get(8)?,
            ingredients,
            markdown: row.get(10)?,
            html: None,
            combustion_csv: row.get(11)?,
            video_url: row.get(12)?,
            favorite: favorite_int != 0,
            owner_id: row.get(14)?,
            is_public: is_public_int != 0,
        };

        let parser = Parser::new(&recipe.markdown);
        let mut html_output = String::new();
        html::push_html(&mut html_output, parser);
        recipe.html = Some(html_output);

        Ok(recipe)
    };

    stmt.query_row([id], row_to_recipe).ok()
}

pub fn save_recipe(recipe: &Recipe) -> Result<(), std::io::Error> {
    let conn = rusqlite::Connection::open(get_db_path())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    save_recipe_db(&conn, recipe)
}

fn save_recipe_db(conn: &rusqlite::Connection, recipe: &Recipe) -> Result<(), std::io::Error> {
    let tags_str = recipe.tags.join(",");
    let ingredients_str = recipe.ingredients.join("\n");
    let is_public_int = if recipe.is_public { 1 } else { 0 };
    let favorite_int = if recipe.favorite { 1 } else { 0 };

    conn.execute(
        "INSERT OR REPLACE INTO recipes (
            id, title, description, image, source_url, tags, servings, 
            prep_time, cook_time, ingredients, markdown, combustion_csv, 
            video_url, favorite, owner_id, is_public
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        (
            &recipe.id,
            &recipe.title,
            &recipe.description,
            &recipe.image,
            &recipe.source_url,
            &tags_str,
            recipe.servings,
            &recipe.prep_time,
            &recipe.cook_time,
            &ingredients_str,
            &recipe.markdown,
            &recipe.combustion_csv,
            &recipe.video_url,
            favorite_int,
            &recipe.owner_id,
            is_public_int,
        ),
    )
    .map(|_| ())
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
}

pub fn delete_recipe(id: &str) -> Result<(), std::io::Error> {
    let conn = rusqlite::Connection::open(get_db_path())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    conn.execute("DELETE FROM recipes WHERE id = ?1", [id])
        .map(|_| ())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
}

pub fn read_meal_plan() -> Vec<crate::models::PlannedMeal> {
    let conn = match rusqlite::Connection::open(get_db_path()) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare("SELECT recipe_id, checked FROM meal_plans") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let meal_iter = stmt.query_map([], |row| {
        let checked_int: i32 = row.get(1)?;
        Ok(crate::models::PlannedMeal {
            recipe_id: row.get(0)?,
            checked: checked_int != 0,
        })
    });
    match meal_iter {
        Ok(iter) => iter.flatten().collect(),
        Err(_) => Vec::new(),
    }
}

pub fn save_meal_plan(meals: &[crate::models::PlannedMeal]) -> Result<(), std::io::Error> {
    let mut conn = rusqlite::Connection::open(get_db_path())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let tx = conn
        .transaction()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    tx.execute("DELETE FROM meal_plans", [])
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    for meal in meals {
        let checked_int = if meal.checked { 1 } else { 0 };
        tx.execute(
            "INSERT INTO meal_plans (recipe_id, checked) VALUES (?1, ?2)",
            (&meal.recipe_id, checked_int),
        )
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    }

    tx.commit()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
}

pub fn find_user_by_email(email: &str) -> Option<crate::models::User> {
    let conn = rusqlite::Connection::open(get_db_path()).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, email, password_hash, created_at FROM users WHERE LOWER(email) = LOWER(?1)",
        )
        .ok()?;
    stmt.query_row([email], |row| {
        Ok(crate::models::User {
            id: row.get(0)?,
            email: row.get(1)?,
            password_hash: row.get(2)?,
            created_at: row.get(3)?,
        })
    })
    .ok()
}

#[allow(dead_code)]
pub fn find_user_by_id(id: &str) -> Option<crate::models::User> {
    let conn = rusqlite::Connection::open(get_db_path()).ok()?;
    let mut stmt = conn
        .prepare("SELECT id, email, password_hash, created_at FROM users WHERE id = ?1")
        .ok()?;
    stmt.query_row([id], |row| {
        Ok(crate::models::User {
            id: row.get(0)?,
            email: row.get(1)?,
            password_hash: row.get(2)?,
            created_at: row.get(3)?,
        })
    })
    .ok()
}

pub fn save_user(user: &crate::models::User) -> Result<(), std::io::Error> {
    let conn = rusqlite::Connection::open(get_db_path())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    conn.execute(
        "INSERT OR REPLACE INTO users (id, email, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
        (&user.id, &user.email, &user.password_hash, &user.created_at),
    )
    .map(|_| ())
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
}

pub fn process_image(data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let img = image::load_from_memory(data)?;

    let (width, height) = img.dimensions();
    let img = if width > 1200 || height > 1200 {
        img.resize(1200, 1200, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    img.write_to(&mut cursor, ImageFormat::WebP)?;

    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Recipe;

    #[test]
    fn test_save_and_read_recipe() {
        let _ = std::fs::create_dir_all("data");

        db_init(
            "$2b$12$xeIhvWgV.yZ2FMHbwZL39.WZSDZWSKIokohV5S7aIwR.spHXuW72G",
            "dbizsley@googlemail.com",
        )
        .unwrap();

        let admin_id = find_user_by_email("dbizsley@googlemail.com").unwrap().id;

        let test_id = "test-recipe-123";
        let recipe = Recipe {
            id: test_id.to_string(),
            title: "Test Recipe".to_string(),
            description: Some("Test description".to_string()),
            image: None,
            source_url: None,
            tags: vec!["test".to_string()],
            servings: Some(4),
            prep_time: None,
            cook_time: None,
            ingredients: vec!["Ingredient 1".to_string()],
            markdown: "## Directions\n1. Do something".to_string(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
            owner_id: admin_id,
            is_public: true,
        };

        save_recipe(&recipe).unwrap();

        let read = read_recipe(test_id).unwrap();
        assert_eq!(read.title, "Test Recipe");
        assert_eq!(read.tags, vec!["test".to_string()]);
        assert_eq!(read.favorite, false);
        assert_eq!(read.is_public, true);

        delete_recipe(test_id).unwrap();
    }
}
