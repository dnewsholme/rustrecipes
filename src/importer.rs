use crate::models::{LdRecipe, Recipe};
use reqwest::StatusCode;
use scraper::{Html, Selector};
use serde_json::Value;
use thiserror::Error;
use tracing::{error, info, warn};
use yt_transcript_rs::YouTubeTranscriptApi;

#[derive(Debug, Error)]
pub enum ImportError {
    #[error("Failed to fetch URL: {0}")]
    FetchFailed(String),
    #[error("Failed to parse recipe from page")]
    ParseFailed,
    #[error("Gemini AI rate limit reached. Please try again later.")]
    RateLimited,
    #[error("Gemini API key not set")]
    NoApiKey,
    #[error("AI failed to extract recipe: {0}")]
    AiFailed(String),
}

fn is_safe_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ipv4) => {
            !ipv4.is_loopback()
                && !ipv4.is_private()
                && !ipv4.is_link_local()
                && !ipv4.is_unspecified()
                && !ipv4.is_broadcast()
        }
        std::net::IpAddr::V6(ipv6) => !ipv6.is_loopback() && !ipv6.is_unspecified(),
    }
}

async fn validate_url_host(url_str: &str) -> Result<(), ImportError> {
    let parsed = url::Url::parse(url_str)
        .map_err(|e| ImportError::FetchFailed(format!("Invalid URL: {}", e)))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| ImportError::FetchFailed("Missing host in URL".to_string()))?;
    let port = parsed
        .port()
        .unwrap_or_else(|| if parsed.scheme() == "https" { 443 } else { 80 });

    let addr_str = format!("{}:{}", host, port);
    let addrs = tokio::net::lookup_host(&addr_str)
        .await
        .map_err(|e| ImportError::FetchFailed(format!("DNS lookup failed for {}: {}", host, e)))?;

    for addr in addrs {
        if !is_safe_ip(addr.ip()) {
            warn!(
                "Blocked fetch request to unsafe host IP: {} (from host {})",
                addr.ip(),
                host
            );
            return Err(ImportError::FetchFailed(
                "Access to private/local networks is forbidden".to_string(),
            ));
        }
    }

    Ok(())
}

pub async fn import_recipe_from_url(url: &str) -> Result<Recipe, ImportError> {
    if url.contains("youtube.com") || url.contains("youtu.be") {
        return import_recipe_from_youtube(url).await;
    }

    validate_url_host(url).await?;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8".parse().unwrap());
    headers.insert("accept-language", "en-US,en;q=0.9".parse().unwrap());
    headers.insert(
        "sec-ch-ua",
        "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\""
            .parse()
            .unwrap(),
    );
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
        .map_err(|e| ImportError::FetchFailed(e.to_string()))?;

    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| ImportError::FetchFailed(e.to_string()))?;
    if !res.status().is_success() {
        warn!("Failed to fetch URL {}: Status {}", url, res.status());
        return Err(ImportError::FetchFailed(res.status().to_string()));
    }
    let body = res
        .text()
        .await
        .map_err(|e| ImportError::FetchFailed(e.to_string()))?;

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
        let og_image = document
            .select(&og_selector)
            .next()
            .and_then(|el| el.value().attr("content"))
            .map(decode_html);

        (ld_res, og_image)
    };

    if let Some(recipe) = ld_recipe {
        return Ok(recipe);
    }

    // Fallback: Try Gemini on the text content
    info!(
        "LD+JSON failed or incomplete for {}, falling back to Gemini",
        url
    );

    let text = match html2text::from_read(body.as_bytes(), 80) {
        Ok(t) => t,
        Err(e) => {
            warn!("Failed to convert HTML to text: {:?}", e);
            return Err(ImportError::ParseFailed);
        }
    };
    info!("Extracted {} characters of text for Gemini", text.len());

    match import_recipe_from_text(&text).await {
        Ok(mut ai_recipe) => {
            ai_recipe.source_url = Some(url.to_string());
            if ai_recipe.image.is_none() {
                ai_recipe.image = og_image;
            }
            Ok(ai_recipe)
        }
        Err(e) => {
            warn!("Gemini fallback failed for {}: {:?}", url, e);
            Err(e)
        }
    }
}

pub async fn import_recipe_from_text(text: &str) -> Result<Recipe, ImportError> {
    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(key) => key,
        Err(_) => {
            warn!("GEMINI_API_KEY not set, cannot use Gemini fallback");
            return Err(ImportError::NoApiKey);
        }
    };

    let prompt = format!(
        "You are a professional recipe extractor. Extract the recipe from this text: \n\n{}\n\n \
                  Format the response EXACTLY as a JSON object with no markdown formatting around it. \
                  The JSON should match this schema: \
                  {{ \"title\": \"string\", \"description\": \"string or null\", \"servings\": number or null, \
                  \"prep_time\": \"string or null\", \"cook_time\": \"string or null\", \
                  \"ingredients\": [\"string\"], \"markdown\": \"string (use markdown for instructions)\", \"tags\": [\"string\"] }}",
        text
    );

    let parts = vec![serde_json::json!({ "text": prompt })];
    let gemini = call_gemini_api(&api_key, parts).await?;
    Ok(gemini_recipe_to_recipe(gemini))
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
        if obj.contains_key("@graph")
            && let Some(Value::Array(arr)) = obj.get("@graph")
        {
            for item in arr {
                if is_recipe(item) {
                    return serde_json::from_value(item.clone()).ok();
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

    let ingredients: Vec<String> = ld
        .recipe_ingredient
        .iter()
        .map(|i| decode_html(i))
        .collect();

    markdown.push_str("## Instructions\n\n");
    if let Some(instructions) = ld.recipe_instructions {
        let mut step_counter = 1;
        process_instructions(&mut markdown, &instructions, &mut step_counter);
    }

    let mut image_url = None;
    if let Some(img) = ld.image {
        if let Value::String(s) = img {
            image_url = Some(decode_html(&s));
        } else if let Value::Array(arr) = img {
            if let Some(first) = arr.first() {
                if let Value::String(s) = first {
                    image_url = Some(decode_html(s));
                } else if let Some(url_val) = first.get("url").and_then(|v| v.as_str()) {
                    image_url = Some(decode_html(url_val));
                }
            }
        } else if let Value::Object(obj) = img
            && let Some(url_val) = obj.get("url").and_then(|v| v.as_str())
        {
            image_url = Some(decode_html(url_val));
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
        } else if let Value::Array(arr) = y
            && let Some(Value::String(s)) = arr.first()
            && let Some(num_str) = s.split_whitespace().next()
        {
            servings = num_str.parse::<u32>().ok();
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
        video_url: None,
        favorite: false,
        owner_id: "admin".to_string(),
        is_public: true,
        owner_email: None,
        ..Default::default()
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
                    markdown.push_str(&format!("\n## {}\n\n", decode_html(name)));
                }
                *step_counter = 1;
                if let Some(items) = obj.get("itemListElement").and_then(|v| v.as_array()) {
                    for item in items {
                        process_instructions(markdown, item, step_counter);
                    }
                }
            } else {
                // Try to get text from 'text' or 'name' or just as string
                let text = obj
                    .get("text")
                    .and_then(|v| v.as_str())
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
        if c.is_ascii_digit() {
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
            if let Ok(mut file) = archive.by_index(i)
                && file.name().ends_with(".paprikarecipe")
            {
                let mut compressed_data = Vec::new();
                if file.read_to_end(&mut compressed_data).is_ok() {
                    let mut gz = GzDecoder::new(Cursor::new(compressed_data));
                    let mut json_str = String::new();
                    if gz.read_to_string(&mut json_str).is_ok()
                        && let Ok(paprika) = serde_json::from_str::<PaprikaRecipe>(&json_str)
                    {
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

                        let mut final_image = paprika.photo_url.clone();
                        let mut base64_strings = Vec::new();
                        if let Some(d) = paprika.photo_large {
                            base64_strings.push(d);
                        }
                        if let Some(d) = paprika.photo_data {
                            base64_strings.push(d);
                        }

                        for mut b64 in base64_strings {
                            if b64.starts_with("data:image")
                                && let Some(idx) = b64.find(',')
                            {
                                b64 = b64[idx + 1..].to_string();
                            }
                            b64 = b64.replace("\n", "").replace("\r", "").replace(" ", "");

                            use base64::Engine as _;
                            use base64::engine::general_purpose;
                            if let Ok(decoded_bytes) = general_purpose::STANDARD.decode(&b64) {
                                // Process image: resize and compress
                                let processed_data =
                                    match crate::storage::process_image(&decoded_bytes) {
                                        Ok(d) => d,
                                        Err(e) => {
                                            warn!("Failed to process Paprika image: {:?}", e);
                                            decoded_bytes // Fallback to original bytes
                                        }
                                    };

                                let new_filename = format!("{}.jpg", uuid::Uuid::new_v4());
                                let filepath = format!("data/uploads/{}", new_filename);
                                if std::fs::write(&filepath, processed_data).is_ok() {
                                    final_image = Some(format!("uploads/{}", new_filename));
                                    break;
                                }
                            }
                        }

                        let recipe = Recipe {
                            id,
                            title: decode_html(&paprika.name),
                            description: paprika.description.map(|d| decode_html(&d)),
                            image: final_image,
                            source_url: paprika.source_url,
                            tags: paprika.categories,
                            servings,
                            prep_time: paprika.prep_time,
                            cook_time: paprika.cook_time,
                            ingredients: paprika
                                .ingredients
                                .unwrap_or_default()
                                .lines()
                                .map(|s| decode_html(s.trim()))
                                .filter(|s| !s.is_empty())
                                .collect(),
                            markdown: decode_html(&paprika.directions.unwrap_or_default()),
                            html: None,
                            combustion_csv: None,
                            video_url: None,
                            favorite: false,
                            owner_id: "admin".to_string(),
                            is_public: true,
                            owner_email: None,
                            ..Default::default()
                        };
                        imported.push(recipe);
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
    #[serde(default, deserialize_with = "deserialize_optional_u32")]
    servings: Option<u32>,
    #[serde(default)]
    ingredients: Vec<String>,
    markdown: String,
    #[serde(default)]
    tags: Option<Vec<String>>,
    prep_time: Option<String>,
    cook_time: Option<String>,
}

fn deserialize_optional_u32<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v: Option<Value> = serde::Deserialize::deserialize(deserializer)?;
    match v {
        Some(Value::Number(n)) => Ok(n.as_u64().map(|v| v as u32)),
        Some(Value::String(s)) => Ok(s.parse::<u32>().ok()),
        _ => Ok(None),
    }
}

fn gemini_recipe_to_recipe(gemini: GeminiRecipe) -> Recipe {
    let title = decode_html(&gemini.title);
    let mut id = slug::slugify(&title);
    if id.is_empty() {
        id = uuid::Uuid::new_v4().to_string();
    }

    Recipe {
        id,
        title,
        description: gemini.description.map(|d| decode_html(&d)),
        image: None,
        source_url: None,
        tags: gemini.tags.unwrap_or_default(),
        servings: gemini.servings,
        prep_time: gemini.prep_time,
        cook_time: gemini.cook_time,
        ingredients: gemini.ingredients.iter().map(|i| decode_html(i)).collect(),
        markdown: decode_html(&gemini.markdown),
        html: None,
        combustion_csv: None,
        video_url: None,
        favorite: false,
        owner_id: "admin".to_string(),
        is_public: true,
        owner_email: None,
        ..Default::default()
    }
}

async fn call_gemini_api(
    api_key: &str,
    parts: Vec<serde_json::Value>,
) -> Result<GeminiRecipe, ImportError> {
    let client = reqwest::Client::new();
    let custom_model = std::env::var("GEMINI_MODEL").ok();
    let mut candidate_models = Vec::new();
    if let Some(ref m) = custom_model {
        candidate_models.push(m.as_str());
    }
    // gemini-3.5-flash and gemini-3.5-flash-lite are primary; gemini-flash-lite-latest and gemini-flash-latest as fallbacks
    for m in &[
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
    ] {
        if !candidate_models.contains(m) {
            candidate_models.push(m);
        }
    }

    let body = serde_json::json!({
        "contents": [{
            "parts": parts
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    });

    let mut last_error_msg = String::new();

    for model in &candidate_models {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, api_key
        );

        for attempt in 0..2 {
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            }

            let res = match client.post(&url).json(&body).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_error_msg = format!("Network request failed: {e}");
                    continue;
                }
            };

            let status = res.status();
            let res_json: serde_json::Value = match res.json().await {
                Ok(v) => v,
                Err(e) => {
                    last_error_msg = format!("Failed to parse response JSON: {e}");
                    continue;
                }
            };

            if !status.is_success() {
                let error_status = res_json["error"]["status"].as_str().unwrap_or("");
                let error_message = res_json["error"]["message"].as_str().unwrap_or("");

                if error_status == "RESOURCE_EXHAUSTED" || status == StatusCode::TOO_MANY_REQUESTS {
                    last_error_msg = format!("Rate limit reached: {error_message}");
                    warn!("Gemini model {model} rate limited: {error_message}");
                    continue;
                }

                if status == StatusCode::SERVICE_UNAVAILABLE || status.as_u16() == 503 {
                    last_error_msg = format!("Model {model} high demand (503): {error_message}");
                    warn!("{}", last_error_msg);
                    continue;
                }

                if status == StatusCode::NOT_FOUND || status.as_u16() == 404 {
                    last_error_msg = format!("Model {model} unavailable (404): {error_message}");
                    warn!("{}", last_error_msg);
                    break;
                }

                last_error_msg = format!("API error ({status}): {error_message}");
                warn!("{}", last_error_msg);
                continue;
            }

            if let Some(text) = res_json["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                let clean_text = text.trim();
                let clean_text = if clean_text.starts_with("```json") {
                    clean_text
                        .trim_start_matches("```json")
                        .trim_end_matches("```")
                        .trim()
                } else if clean_text.starts_with("```") {
                    clean_text
                        .trim_start_matches("```")
                        .trim_end_matches("```")
                        .trim()
                } else {
                    clean_text
                };

                match serde_json::from_str::<GeminiRecipe>(clean_text) {
                    Ok(gemini) => return Ok(gemini),
                    Err(e) => {
                        error!(
                            "Failed to deserialize Gemini response: {:?}. Raw: {}",
                            e, clean_text
                        );
                        return Err(ImportError::AiFailed(format!(
                            "Failed to parse recipe JSON from AI: {e}"
                        )));
                    }
                }
            } else {
                warn!(
                    "Gemini response did not contain expected text field: {:?}",
                    res_json
                );
                last_error_msg = "Gemini response did not contain text content".to_string();
            }
        }
    }

    if last_error_msg.contains("Rate limit") || last_error_msg.contains("RESOURCE_EXHAUSTED") {
        Err(ImportError::RateLimited)
    } else {
        Err(ImportError::AiFailed(if last_error_msg.is_empty() {
            "All Gemini AI models failed to respond".to_string()
        } else {
            last_error_msg
        }))
    }
}

pub async fn import_recipe_from_photo(
    mime_type: &str,
    image_data: &[u8],
) -> Result<Recipe, ImportError> {
    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(key) => key,
        Err(e) => {
            println!("Error reading GEMINI_API_KEY: {:?}", e);
            return Err(ImportError::NoApiKey);
        }
    };

    use base64::{Engine as _, engine::general_purpose};
    let b64 = general_purpose::STANDARD.encode(image_data);

    let prompt = "You are a professional recipe extractor. Extract the recipe from this image. \
                  Format the response EXACTLY as a JSON object with no markdown formatting around it. \
                  The JSON should match this schema: \
                  { \"title\": \"string\", \"description\": \"string or null\", \"servings\": number or null, \
                  \"prep_time\": \"string or null\", \"cook_time\": \"string or null\", \
                  \"ingredients\": [\"string\"], \"markdown\": \"string (use markdown for instructions)\", \"tags\": [\"string\"] }";

    let parts = vec![
        serde_json::json!({ "text": prompt }),
        serde_json::json!({
            "inline_data": {
                "mime_type": mime_type,
                "data": b64
            }
        }),
    ];

    let gemini = call_gemini_api(&api_key, parts).await?;
    Ok(gemini_recipe_to_recipe(gemini))
}

fn extract_youtube_description(html: &str) -> Option<String> {
    let key = r#""shortDescription":""#;
    let idx = html.find(key)?;
    let after = &html[idx + key.len()..];
    let end_marker = r#"","isCrawlable""#;
    let end_idx = after.find(end_marker)?;
    let raw = &after[..end_idx];

    let unescaped = raw
        .replace(r#"\n"#, "\n")
        .replace(r#"\r"#, "")
        .replace(r#"\""#, "\"")
        .replace(r#"\\/"#, "/")
        .replace(r#"\\"#, "\\");

    if unescaped.trim().is_empty() {
        None
    } else {
        Some(unescaped)
    }
}

fn extract_recipe_url_from_description(desc: &str) -> Option<String> {
    let re =
        regex::Regex::new(r#"https?://[^\s\"<>]+(?:recipe|blog|food|cook|bake)[^\s\"<>]*"#).ok()?;
    re.find(desc).map(|m| {
        m.as_str()
            .trim_end_matches('.')
            .trim_end_matches('/')
            .to_string()
    })
}

pub async fn import_recipe_from_youtube(url: &str) -> Result<Recipe, ImportError> {
    let video_id = extract_youtube_id(url).ok_or(ImportError::ParseFailed)?;

    info!("Fetching transcript for YouTube video: {}", video_id);
    let api = YouTubeTranscriptApi::new(None, None, None).map_err(|_| ImportError::ParseFailed)?;

    // Try English first, then any other language
    let transcript_res = api.fetch_transcript(&video_id, &["en"], true).await;

    let transcript_text = match transcript_res {
        Ok(t) => t.text(),
        Err(e) => {
            warn!(
                "Failed to fetch transcript: {}. Falling back to metadata only.",
                e
            );
            String::new()
        }
    };

    // Extract title, description, and possible linked recipe URL from page HTML
    let client = reqwest::Client::new();
    let mut page_text = format!("YouTube Video ID: {}\n", video_id);
    let mut recipe_link: Option<String> = None;

    if let Ok(res) = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .send()
        .await
        && let Ok(body) = res.text().await
    {
        let document = Html::parse_document(&body);
        let title_selector = Selector::parse("title").unwrap();
        if let Some(title_el) = document.select(&title_selector).next() {
            let raw_title = title_el.inner_html();
            let clean_title = raw_title.trim_end_matches(" - YouTube").trim();
            page_text.push_str(&format!("Video Title: {}\n", clean_title));
        }

        let full_desc = extract_youtube_description(&body);
        let desc = full_desc.or_else(|| {
            let desc_selector = Selector::parse("meta[name=\"description\"]").unwrap();
            document
                .select(&desc_selector)
                .next()
                .and_then(|el| el.value().attr("content"))
                .map(|s| s.to_string())
        });

        if let Some(ref d) = desc {
            page_text.push_str(&format!("Video Description:\n{}\n", d));
            recipe_link = extract_recipe_url_from_description(d);
        }
    }

    // If description has a direct link to the recipe (common when captions are missing/disabled),
    // attempt to import directly from the creator's recipe page!
    if let Some(ref linked_url) = recipe_link
        && !linked_url.contains("youtube.com")
        && !linked_url.contains("youtu.be")
    {
        info!(
            "Found recipe link in video description: {}. Attempting direct import.",
            linked_url
        );
        match Box::pin(import_recipe_from_url(linked_url)).await {
            Ok(mut linked_recipe) => {
                linked_recipe.source_url = Some(url.to_string());
                linked_recipe.video_url = Some(url.to_string());
                if linked_recipe.image.is_none() {
                    linked_recipe.image = Some(format!(
                        "https://i.ytimg.com/vi/{}/maxresdefault.jpg",
                        video_id
                    ));
                }
                return Ok(linked_recipe);
            }
            Err(e) => {
                warn!(
                    "Failed to import from linked recipe URL {}: {:?}. Continuing with video metadata.",
                    linked_url, e
                );
            }
        }
    }

    if !transcript_text.is_empty() {
        page_text.push_str("\nTranscript:\n");
        page_text.push_str(&transcript_text);
    }

    if page_text.len() < 30 && transcript_text.is_empty() {
        warn!(
            "Could not extract enough information from YouTube video {}",
            video_id
        );
        return Err(ImportError::ParseFailed);
    }

    let mut recipe = import_recipe_from_text(&page_text).await?;

    recipe.source_url = Some(url.to_string());
    recipe.video_url = Some(url.to_string());
    recipe.image = Some(format!(
        "https://i.ytimg.com/vi/{}/maxresdefault.jpg",
        video_id
    ));

    Ok(recipe)
}

fn extract_youtube_id(url: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?:v=|\/|embed\/|youtu\.be\/)([0-9A-Za-z_-]{11})").ok()?;
    re.captures(url)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_iso8601_duration() {
        assert_eq!(
            parse_iso8601_duration("PT1H30M"),
            Some("1h 30m".to_string())
        );
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

    #[test]
    fn test_extract_youtube_description_and_recipe_link() {
        let fake_html = r#"<script>var ytInitialData = {"shortDescription":"Sticky toffee pudding recipe!\n\nRecipe: https://www.example.com/recipes/sticky-toffee\n\nEnjoy!","isCrawlable":true};</script>"#;
        let desc = extract_youtube_description(fake_html);
        assert!(desc.is_some());
        let desc_text = desc.unwrap();
        assert!(desc_text.contains("Sticky toffee pudding"));

        let link = extract_recipe_url_from_description(&desc_text);
        assert_eq!(
            link,
            Some("https://www.example.com/recipes/sticky-toffee".to_string())
        );
    }

    #[tokio::test]
    #[ignore]
    async fn test_live_youtube_import() {
        let res = import_recipe_from_youtube("https://www.youtube.com/watch?v=Ngrx3pU_fqk").await;
        assert!(res.is_ok(), "Import failed: {:?}", res.err());
        let recipe = res.unwrap();
        assert!(!recipe.title.is_empty());
        assert!(!recipe.ingredients.is_empty());
    }
}
