use crate::models::{LdRecipe, Recipe};
use scraper::{Html, Selector};
use serde_json::Value;
use tracing::{info, warn, error};

pub async fn import_recipe_from_url(url: &str) -> Option<Recipe> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8".parse().unwrap());
    headers.insert("accept-language", "en-US,en;q=0.9".parse().unwrap());
    headers.insert("sec-ch-ua", "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"".parse().unwrap());
    headers.insert("sec-ch-ua-mobile", "?0".parse().unwrap());
    headers.insert("sec-ch-ua-platform", "\"Windows\"".parse().unwrap());
    headers.insert("sec-fetch-dest", "document".parse().unwrap());
    headers.insert("sec-fetch-mode", "navigate".parse().unwrap());
    headers.insert("sec-fetch-site", "none".parse().unwrap());
    headers.insert("sec-fetch-user", "?1".parse().unwrap());
    headers.insert("upgrade-insecure-requests", "1".parse().unwrap());

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .default_headers(headers)
        .cookie_store(true)
        .build()
        .ok()?;

    let res = client.get(url).send().await.ok()?;
    let body = res.text().await.ok()?;

    let (ld_recipe, og_image) = {
        let document = Html::parse_document(&body);
        let ld_selector = Selector::parse("script[type=\"application/ld+json\"]").unwrap();
        let mut ld_res = None;

        for element in document.select(&ld_selector) {
            let text = element.inner_html();
            if let Some(recipe_data) = extract_recipe_from_json(&text) {
                let recipe = convert_ld_to_recipe(recipe_data, url);
                // If we got valid ingredients and instructions, return it
                if !recipe.ingredients.is_empty() && !recipe.markdown.is_empty() {
                    ld_res = Some(recipe);
                    break;
                }
            }
        }

        let og_selector = Selector::parse("meta[property=\"og:image\"]").unwrap();
        let og_image = document.select(&og_selector)
            .next()
            .and_then(|el| el.value().attr("content"))
            .map(|s| s.to_string());

        (ld_res, og_image)
    };

    if let Some(recipe) = ld_recipe {
        return Some(recipe);
    }

    // Fallback: Try Gemini on the text content
    info!(
        "LD+JSON failed or incomplete for {}, falling back to Gemini",
        url
    );
    if let Ok(text) = html2text::from_read(body.as_bytes(), 80) {
        if let Some(mut ai_recipe) = import_recipe_from_text(&text).await {
            ai_recipe.source_url = Some(url.to_string());
            if ai_recipe.image.is_none() {
                ai_recipe.image = og_image;
            }
            return Some(ai_recipe);
        }
    }

    None
}

pub async fn import_recipe_from_text(text: &str) -> Option<Recipe> {
    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(key) => key,
        Err(_) => return None,
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={}",
        api_key
    );

    let prompt = format!(
        "You are a professional recipe extractor. Extract the recipe from this text: \n\n{}\n\n \
                  Format the response EXACTLY as a JSON object with no markdown formatting around it. \
                  The JSON should match this schema: \
                  {{ \"title\": \"string\", \"description\": \"string or null\", \"servings\": number or null, \
                  \"prep_time\": \"string or null\", \"cook_time\": \"string or null\", \
                  \"ingredients\": [\"string\"], \"markdown\": \"string (use markdown for instructions)\", \"tags\": [\"string\"] }}",
        text
    );

    let body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    });

    let res = client.post(&url).json(&body).send().await.ok()?;
    let res_json: serde_json::Value = res.json().await.ok()?;

    if let Some(text) = res_json["candidates"][0]["content"]["parts"][0]["text"].as_str() {
        let clean_text = text.trim();
        let clean_text = if clean_text.starts_with("```json") {
            clean_text
                .trim_start_matches("```json")
                .trim_end_matches("```")
                .trim()
        } else {
            clean_text
        };

        if let Ok(gemini) = serde_json::from_str::<GeminiRecipe>(clean_text) {
            let mut id = slug::slugify(&gemini.title);
            if id.is_empty() {
                id = uuid::Uuid::new_v4().to_string();
            }

            return Some(Recipe {
                id,
                title: gemini.title,
                description: gemini.description,
                image: None,
                source_url: None,
                tags: gemini.tags.unwrap_or_default(),
                servings: gemini.servings,
                prep_time: gemini.prep_time,
                cook_time: gemini.cook_time,
                ingredients: gemini.ingredients,
                markdown: gemini.markdown,
                html: None,
                combustion_csv: None,
            });
        }
    }
    None
}

fn extract_recipe_from_json(json_str: &str) -> Option<LdRecipe> {
    let parsed: Value = serde_json::from_str(json_str).ok()?;

    if let Value::Array(arr) = &parsed {
        for item in arr {
            if is_recipe(item) {
                return serde_json::from_value(item.clone()).ok();
            }
        }
    } else if let Value::Object(obj) = &parsed {
        if obj.contains_key("@graph") {
            if let Some(Value::Array(arr)) = obj.get("@graph") {
                for item in arr {
                    if is_recipe(item) {
                        return serde_json::from_value(item.clone()).ok();
                    }
                }
            }
        }
        if is_recipe(&parsed) {
            return serde_json::from_value(parsed.clone()).ok();
        }
    }
    None
}

fn is_recipe(val: &Value) -> bool {
    if let Some(t) = val.get("@type") {
        if let Some(s) = t.as_str() {
            return s == "Recipe" || s.contains("Recipe");
        } else if let Some(arr) = t.as_array() {
            return arr.iter().any(|v| v.as_str() == Some("Recipe"));
        }
    }
    false
}

fn convert_ld_to_recipe(ld: LdRecipe, url: &str) -> Recipe {
    let mut markdown = String::new();

    if let Some(desc) = &ld.description {
        markdown.push_str(&format!("{}\n\n", decode_html(desc)));
    }
    
    let ingredients: Vec<String> = ld.recipe_ingredient.iter().map(|i| decode_html(i)).collect();

    markdown.push_str("## Instructions\n\n");
    if let Some(instructions) = ld.recipe_instructions {
        let mut step_counter = 1;
        process_instructions(&mut markdown, &instructions, &mut step_counter);
    }

    let mut image_url = None;
    if let Some(img) = ld.image {
        if let Value::String(s) = img {
            image_url = Some(s);
        } else if let Value::Array(arr) = img {
            if let Some(first) = arr.first() {
                if let Value::String(s) = first {
                    image_url = Some(s.clone());
                } else if let Some(url_val) = first.get("url").and_then(|v| v.as_str()) {
                    image_url = Some(url_val.to_string());
                }
            }
        } else if let Value::Object(obj) = img {
            if let Some(url_val) = obj.get("url").and_then(|v| v.as_str()) {
                image_url = Some(url_val.to_string());
            }
        }
    }

    let title = decode_html(&ld.name);
    let mut id = slug::slugify(&title);
    if id.is_empty() {
        id = uuid::Uuid::new_v4().to_string();
    }

    let mut servings = None;
    if let Some(y) = ld.recipe_yield {
        if let Value::String(s) = y {
            // E.g., "4 servings" -> Extract "4"
            if let Some(num_str) = s.split_whitespace().next() {
                servings = num_str.parse::<u32>().ok();
            }
        } else if let Value::Number(n) = y {
            servings = n.as_u64().map(|v| v as u32);
        } else if let Value::Array(arr) = y {
            if let Some(Value::String(s)) = arr.first() {
                if let Some(num_str) = s.split_whitespace().next() {
                    servings = num_str.parse::<u32>().ok();
                }
            }
        }
    }

    Recipe {
        id,
        title,
        description: ld.description.map(|d| decode_html(&d)),
        image: image_url,
        source_url: Some(url.to_string()),
        tags: vec![],
        servings,
        prep_time: ld.prep_time.and_then(|t| parse_iso8601_duration(&t)),
        cook_time: ld.cook_time.and_then(|t| parse_iso8601_duration(&t)),
        ingredients,
        markdown,
        html: None,
        combustion_csv: None,
    }
}

fn decode_html(s: &str) -> String {
    html_escape::decode_html_entities(s).into_owned()
}

fn process_instructions(markdown: &mut String, value: &Value, step_counter: &mut usize) {
    match value {
        Value::Array(arr) => {
            for item in arr {
                process_instructions(markdown, item, step_counter);
            }
        }
        Value::Object(obj) => {
            let type_str = obj.get("@type").and_then(|v| v.as_str()).unwrap_or("");
            
            if type_str == "HowToSection" {
                if let Some(name) = obj.get("name").and_then(|v| v.as_str()) {
                    markdown.push_str(&format!("\n### {}\n\n", decode_html(name)));
                }
                if let Some(items) = obj.get("itemListElement").and_then(|v| v.as_array()) {
                    for item in items {
                        process_instructions(markdown, item, step_counter);
                    }
                }
            } else {
                // Try to get text from 'text' or 'name' or just as string
                let text = obj.get("text").and_then(|v| v.as_str())
                    .or_else(|| obj.get("name").and_then(|v| v.as_str()));
                
                if let Some(t) = text {
                    markdown.push_str(&format!("{}. {}\n", step_counter, decode_html(t)));
                    *step_counter += 1;
                }
            }
        }
        Value::String(s) => {
            markdown.push_str(&format!("{}. {}\n", step_counter, decode_html(s)));
            *step_counter += 1;
        }
        _ => {}
    }
}

fn parse_iso8601_duration(duration: &str) -> Option<String> {
    let mut result = String::new();
    let mut current_num = String::new();

    for c in duration.chars() {
        if c.is_digit(10) {
            current_num.push(c);
        } else {
            match c {
                'H' => {
                    if !current_num.is_empty() {
                        result.push_str(&format!("{}h ", current_num));
                        current_num.clear();
                    }
                }
                'M' => {
                    if !current_num.is_empty() {
                        result.push_str(&format!("{}m ", current_num));
                        current_num.clear();
                    }
                }
                'S' => {
                    if !current_num.is_empty() {
                        result.push_str(&format!("{}s ", current_num));
                        current_num.clear();
                    }
                }
                _ => {
                    current_num.clear();
                }
            }
        }
    }

    let trimmed = result.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub async fn import_paprika_archive(bytes: &[u8]) -> Vec<Recipe> {
    use crate::models::PaprikaRecipe;
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    use std::io::Read;
    use zip::ZipArchive;

    let mut imported = Vec::new();

    let cursor = Cursor::new(bytes);
    if let Ok(mut archive) = ZipArchive::new(cursor) {
        for i in 0..archive.len() {
            if let Ok(mut file) = archive.by_index(i) {
                if file.name().ends_with(".paprikarecipe") {
                    let mut compressed_data = Vec::new();
                    if file.read_to_end(&mut compressed_data).is_ok() {
                        let mut gz = GzDecoder::new(Cursor::new(compressed_data));
                        let mut json_str = String::new();
                        if gz.read_to_string(&mut json_str).is_ok() {
                            if let Ok(paprika) = serde_json::from_str::<PaprikaRecipe>(&json_str) {
                                let mut id = slug::slugify(&paprika.name);
                                if id.is_empty() {
                                    id = uuid::Uuid::new_v4().to_string();
                                }

                                let servings = if let Some(s) = &paprika.servings {
                                    s.split_whitespace()
                                        .next()
                                        .and_then(|num| num.parse::<u32>().ok())
                                } else {
                                    None
                                };

                                let ingredients = paprika
                                    .ingredients
                                    .unwrap_or_default()
                                    .lines()
                                    .map(|s| s.trim().to_string())
                                    .filter(|s| !s.is_empty())
                                    .collect();

                                let mut final_image = paprika.photo_url.clone();
                                let mut base64_strings = Vec::new();
                                if let Some(d) = paprika.photo_large {
                                    base64_strings.push(d);
                                }
                                if let Some(d) = paprika.photo_data {
                                    base64_strings.push(d);
                                }

                                for mut b64 in base64_strings {
                                    if b64.starts_with("data:image") {
                                        if let Some(idx) = b64.find(',') {
                                            b64 = b64[idx + 1..].to_string();
                                        }
                                    }
                                    b64 = b64.replace("\n", "").replace("\r", "").replace(" ", "");

                                    use base64::{Engine as _, engine::general_purpose};
                                    if let Ok(bytes) = general_purpose::STANDARD.decode(&b64) {
                                        let new_filename = format!("{}.jpg", uuid::Uuid::new_v4());
                                        let filepath = format!("data/uploads/{}", new_filename);
                                        if std::fs::write(&filepath, bytes).is_ok() {
                                            final_image = Some(format!("uploads/{}", new_filename));
                                            break;
                                        }
                                    }
                                }

                                let recipe = Recipe {
                                    id,
                                    title: paprika.name,
                                    description: paprika.description,
                                    image: final_image,
                                    source_url: paprika.source_url,
                                    tags: paprika.categories,
                                    servings,
                                    prep_time: paprika.prep_time,
                                    cook_time: paprika.cook_time,
                                    ingredients,
                                    markdown: paprika.directions.unwrap_or_default(),
                                    html: None,
                                    combustion_csv: None,
                                };
                                imported.push(recipe);
                            }
                        }
                    }
                }
            }
        }
    }
    imported
}

#[derive(serde::Deserialize)]
struct GeminiRecipe {
    title: String,
    description: Option<String>,
    servings: Option<u32>,
    ingredients: Vec<String>,
    markdown: String,
    tags: Option<Vec<String>>,
    prep_time: Option<String>,
    cook_time: Option<String>,
}

pub async fn import_recipe_from_photo(mime_type: &str, image_data: &[u8]) -> Option<Recipe> {
    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(key) => key,
        Err(e) => {
            println!("Error reading GEMINI_API_KEY: {:?}", e);
            return None;
        }
    };

    use base64::{Engine as _, engine::general_purpose};
    let b64 = general_purpose::STANDARD.encode(image_data);

    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={}",
        api_key
    );

    let prompt = "You are a professional recipe extractor. Extract the recipe from this image. \
                  Format the response EXACTLY as a JSON object with no markdown formatting around it. \
                  The JSON should match this schema: \
                  { \"title\": \"string\", \"description\": \"string or null\", \"servings\": number or null, \
                  \"prep_time\": \"string or null\", \"cook_time\": \"string or null\", \
                  \"ingredients\": [\"string\"], \"markdown\": \"string (use markdown for instructions)\", \"tags\": [\"string\"] }";

    let body = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": b64
                    }
                }
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    });

    let res = match client.post(&url).json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            println!("Request to Gemini failed: {:?}", e);
            return None;
        }
    };

    let status = res.status();
    let res_json: serde_json::Value = match res.json().await {
        Ok(v) => v,
        Err(e) => {
            println!("Failed to parse Gemini response as JSON: {:?}", e);
            return None;
        }
    };

    if !status.is_success() {
        error!(
            "Gemini API returned error status {}: {:?}",
            status, res_json
        );
        return None;
    }

    if let Some(text) = res_json["candidates"][0]["content"]["parts"][0]["text"].as_str() {
        let clean_text = text.trim();
        // Sometimes LLMs still wrap in ```json ... ``` despite instructions
        let clean_text = if clean_text.starts_with("```json") {
            clean_text
                .trim_start_matches("```json")
                .trim_end_matches("```")
                .trim()
        } else {
            clean_text
        };

        match serde_json::from_str::<GeminiRecipe>(clean_text) {
            Ok(gemini) => {
                let mut id = slug::slugify(&gemini.title);
                if id.is_empty() {
                    id = uuid::Uuid::new_v4().to_string();
                }

                return Some(Recipe {
                    id,
                    title: gemini.title,
                    description: gemini.description,
                    image: None,
                    source_url: None,
                    tags: gemini.tags.unwrap_or_default(),
                    servings: gemini.servings,
                    prep_time: gemini.prep_time,
                    cook_time: gemini.cook_time,
                    ingredients: gemini.ingredients,
                    markdown: gemini.markdown,
                    html: None,
                    combustion_csv: None,
                });
            }
            Err(e) => {
                error!(
                    "Failed to deserialize Gemini response into GeminiRecipe: {:?}",
                    e
                );
                info!("Raw JSON was: {}", clean_text);
            }
        }
    } else {
        warn!("Unexpected response structure from Gemini: {:?}", res_json);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_iso8601_duration() {
        assert_eq!(parse_iso8601_duration("PT1H30M"), Some("1h 30m".to_string()));
        assert_eq!(parse_iso8601_duration("PT45M"), Some("45m".to_string()));
        assert_eq!(parse_iso8601_duration("PT2H"), Some("2h".to_string()));
        assert_eq!(parse_iso8601_duration("PT10S"), Some("10s".to_string()));
        assert_eq!(parse_iso8601_duration("P1DT1H"), Some("1h".to_string()));
        assert_eq!(parse_iso8601_duration("P0D"), None);
    }

    #[test]
    fn test_extract_recipe_from_json() {
        let json = r#"{
            "@context": "https://schema.org",
            "@type": "Recipe",
            "name": "Test Recipe",
            "recipeIngredient": ["1 cup water"],
            "recipeInstructions": [{"@type": "HowToStep", "text": "Boil water"}]
        }"#;
        let extracted = extract_recipe_from_json(json);
        assert!(extracted.is_some());
        let ld = extracted.unwrap();
        assert_eq!(ld.name, "Test Recipe");
    }
}
