use crate::models::Recipe;

use pulldown_cmark::{html, Parser};
use std::fs;
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
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Some(recipe) = read_recipe(id).await {
                        recipes.push(recipe);
                    }
                }
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
            
            let parser = Parser::new(&recipe.markdown);
            let mut html_output = String::new();
            html::push_html(&mut html_output, parser);
            recipe.html = Some(html_output);
            
            return Some(recipe);
        }
    }
    None
}

pub async fn save_recipe(recipe: &Recipe) -> Result<(), std::io::Error> {
    let path = get_recipes_dir().join(format!("{}.md", recipe.id));
    
    // Create frontmatter
    let frontmatter = serde_yaml::to_string(&recipe)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let content = format!("---\n{}---\n{}", frontmatter, recipe.markdown);
    
    fs::write(path, content)
}

pub async fn delete_recipe(id: &str) -> Result<(), std::io::Error> {
    let path = get_recipes_dir().join(format!("{}.md", id));
    fs::remove_file(path)
}
