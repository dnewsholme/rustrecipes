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

impl Recipe {
    pub fn has_tag(&self, tag: &str) -> bool {
        self.tags.iter().any(|t| t == tag)
    }

    pub fn leaven_info(&self) -> (bool, &'static str) {
        let yeast_regex = regex::Regex::new(r"(?i)\byeast\b").unwrap();
        let starter_regex =
            regex::Regex::new(r"(?i)\b(sourdough starter|levain|starter culture)\b").unwrap();

        let mut found_starter = false;
        let mut found_yeast = false;

        for ing in &self.ingredients {
            let lower = ing.to_lowercase();
            if lower.contains("nutritional") {
                continue;
            }
            if starter_regex.is_match(ing) {
                found_starter = true;
            }
            if yeast_regex.is_match(ing) {
                found_yeast = true;
            }
        }

        if found_starter {
            (true, "starter")
        } else if found_yeast {
            (true, "yeast")
        } else {
            (false, "none")
        }
    }
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
