use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Recipe {
    #[serde(skip)] // Don't serialize id into frontmatter
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub source_url: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub servings: Option<u32>,
    pub prep_time: Option<String>,
    pub cook_time: Option<String>,
    #[serde(default)]
    pub ingredients: Vec<String>,
    #[serde(skip)]
    pub markdown: String,
    #[serde(skip)]
    pub html: Option<String>,
    pub combustion_csv: Option<String>,
}

// Minimal representations for extracting LD+JSON Recipe data
#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct LdRecipe {
    pub name: String,
    pub description: Option<String>,
    pub image: Option<serde_json::Value>,
    #[serde(alias = "recipeIngredient")]
    pub recipe_ingredient: Vec<String>,
    #[serde(alias = "recipeInstructions")]
    pub recipe_instructions: Option<serde_json::Value>,
    #[serde(alias = "recipeYield")]
    pub recipe_yield: Option<serde_json::Value>,
    #[serde(alias = "prepTime")]
    pub prep_time: Option<String>,
    #[serde(alias = "cookTime")]
    pub cook_time: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct PaprikaRecipe {
    #[serde(default)]
    pub name: String,
    pub description: Option<String>,
    pub ingredients: Option<String>,
    pub directions: Option<String>,
    pub servings: Option<String>,
    pub source_url: Option<String>,
    pub photo_url: Option<String>,
    pub photo_data: Option<String>,
    pub photo_large: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    pub prep_time: Option<String>,
    pub cook_time: Option<String>,
}
