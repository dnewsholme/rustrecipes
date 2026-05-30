use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Recipe {
    #[serde(default)]
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
    #[serde(default)]
    pub markdown: String,
    #[serde(skip)]
    pub html: Option<String>,
    pub combustion_csv: Option<String>,
    #[serde(default)]
    pub video_url: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub owner_id: String,
    #[serde(default = "default_true")]
    pub is_public: bool,
    #[serde(default)]
    pub owner_email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub created_at: String,
}

impl Recipe {
    pub fn is_owned_by(&self, user_id: &Option<String>) -> bool {
        if let Some(uid) = user_id {
            &self.owner_id == uid
        } else {
            false
        }
    }
    pub fn has_tag(&self, tag: &str) -> bool {
        self.tags
            .iter()
            .any(|t| t.to_lowercase() == tag.to_lowercase())
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

    pub fn youtube_id(&self) -> Option<String> {
        let re = regex::Regex::new(r"(?i)(?:v=|\/|embed\/|youtu\.be\/)([0-9A-Za-z_-]{11})").ok()?;

        if let Some(url) = &self.video_url
            && let Some(caps) = re.captures(url)
        {
            return caps.get(1).map(|m| m.as_str().to_string());
        }

        if let Some(url) = &self.source_url
            && (url.to_lowercase().contains("youtube.com")
                || url.to_lowercase().contains("youtu.be"))
            && let Some(caps) = re.captures(url)
        {
            return caps.get(1).map(|m| m.as_str().to_string());
        }

        None
    }

    pub fn has_video(&self) -> bool {
        self.youtube_id().is_some()
    }

    pub fn has_combustion(&self) -> bool {
        self.combustion_csv
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    }

    pub fn hydration(&self) -> Option<f64> {
        let totals = crate::conversions::calculate_totals(&self.ingredients, 1.0);
        if totals.total_flour > 0.0 {
            Some(totals.total_water / totals.total_flour)
        } else {
            None
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlannedMeal {
    pub recipe_id: String,
    pub checked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ShoppingItem {
    pub name: String,
    pub checked: bool,
}
