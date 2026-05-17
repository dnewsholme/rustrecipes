use crate::models::Recipe;
use serde::Serialize;
// use tracing::error;

use image::{GenericImageView, ImageFormat};
use pulldown_cmark::{Parser, html};
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

const RECIPES_DIR: &str = "data/recipes";

pub fn get_recipes_dir() -> PathBuf {
    PathBuf::from(RECIPES_DIR)
}

pub async fn list_recipes() -> Vec<Recipe> {
    let mut recipes = Vec::new();
    let dir = get_recipes_dir();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md")
                && let Some(id) = path.file_stem().and_then(|s| s.to_str())
                && let Some(recipe) = read_recipe(id).await
            {
                recipes.push(recipe);
            }
        }
    }
    recipes.sort_by(|a, b| a.title.cmp(&b.title));
    recipes
}

pub async fn read_recipe(id: &str) -> Option<Recipe> {
    let path = get_recipes_dir().join(format!("{}.md", id));
    let content = fs::read_to_string(&path).ok()?;

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() == 3 {
        let frontmatter = parts[1];
        let markdown = parts[2].trim_start().to_string();

        if let Ok(mut recipe) = serde_yaml::from_str::<Recipe>(frontmatter) {
            recipe.id = id.to_string();
            recipe.markdown = markdown;

            // Fix legacy absolute paths for images and csvs
            if let Some(img) = &mut recipe.image
                && img.starts_with("/uploads/")
            {
                *img = img[1..].to_string();
            }
            if let Some(csv) = &mut recipe.combustion_csv
                && csv.starts_with("/uploads/")
            {
                *csv = csv[1..].to_string();
            }

            let parser = Parser::new(&recipe.markdown);
            let mut html_output = String::new();
            html::push_html(&mut html_output, parser);
            recipe.html = Some(html_output);

            return Some(recipe);
        }
    }
    None
}

#[derive(Serialize)]
struct RecipeFrontmatter<'a> {
    title: &'a str,
    description: &'a Option<String>,
    image: &'a Option<String>,
    source_url: &'a Option<String>,
    tags: &'a Vec<String>,
    servings: &'a Option<u32>,
    prep_time: &'a Option<String>,
    cook_time: &'a Option<String>,
    ingredients: &'a Vec<String>,
    combustion_csv: &'a Option<String>,
    video_url: &'a Option<String>,
    favorite: bool,
}

pub async fn save_recipe(recipe: &Recipe) -> Result<(), std::io::Error> {
    let path = get_recipes_dir().join(format!("{}.md", recipe.id));

    let fm = RecipeFrontmatter {
        title: &recipe.title,
        description: &recipe.description,
        image: &recipe.image,
        source_url: &recipe.source_url,
        tags: &recipe.tags,
        servings: &recipe.servings,
        prep_time: &recipe.prep_time,
        cook_time: &recipe.cook_time,
        ingredients: &recipe.ingredients,
        combustion_csv: &recipe.combustion_csv,
        video_url: &recipe.video_url,
        favorite: recipe.favorite,
    };

    // Create frontmatter
    let frontmatter = serde_yaml::to_string(&fm)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let content = format!("---\n{}---\n{}", frontmatter, recipe.markdown);

    fs::write(path, content)
}

pub async fn delete_recipe(id: &str) -> Result<(), std::io::Error> {
    let path = get_recipes_dir().join(format!("{}.md", id));
    fs::remove_file(path)
}

const MEAL_PLAN_FILE: &str = "data/meal_plan.json";

pub async fn read_meal_plan() -> Vec<crate::models::PlannedMeal> {
    let path = std::path::Path::new(MEAL_PLAN_FILE);
    if !path.exists() {
        return Vec::new();
    }

    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| Vec::new()),
        Err(_) => Vec::new(),
    }
}

pub async fn save_meal_plan(meals: &[crate::models::PlannedMeal]) -> Result<(), std::io::Error> {
    let path = std::path::Path::new(MEAL_PLAN_FILE);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string(meals)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(path, content)
}

pub fn process_image(data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let img = image::load_from_memory(data)?;

    // Resize if larger than 1200px in either dimension while maintaining aspect ratio
    let (width, height) = img.dimensions();
    let img = if width > 1200 || height > 1200 {
        img.resize(1200, 1200, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);

    // Save as WebP for better compression
    // We use the webp crate for more control or just ImageFormat::Webp if supported by the image crate
    img.write_to(&mut cursor, ImageFormat::WebP)?;

    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Recipe;
    use std::fs;

    #[tokio::test]
    async fn test_save_and_read_recipe() {
        // Ensure the real recipes directory exists for the test in CI
        fs::create_dir_all(get_recipes_dir()).unwrap();

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
        };

        // We'll temporarily point to a test file in the real dir or just use a unique ID
        save_recipe(&recipe).await.unwrap();

        let read = read_recipe(test_id).await.unwrap();
        assert_eq!(read.title, "Test Recipe");
        assert_eq!(read.tags, vec!["test".to_string()]);
        assert_eq!(read.favorite, false);

        delete_recipe(test_id).await.unwrap();
    }
}
