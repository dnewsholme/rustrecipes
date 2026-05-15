use crate::models::Recipe;
use lazy_static::lazy_static;
use regex::Regex;
use std::collections::HashMap;

lazy_static! {
    static ref FRACTION_STR: &'static str = "½|⅓|⅔|¼|¾|⅕|⅖|⅗|⅘|⅙|⅚|⅛|⅜|⅝|⅞";
    static ref NUMBER_REGEX_STR: String = format!(
        r"(?:\d+[\s\-]+\d+\s*[\\/⁄]\s*\d+|\d+\s*[\\/⁄]\s*\d+|\d*\.\d+|\d+[\s\-]*(?:{})|(?:{})|\d+)",
        *FRACTION_STR, *FRACTION_STR
    );
    static ref UNITS_REGEX_STR: &'static str = "cup|cups|c|tsp|teaspoon|teaspoons|tbsp|tablespoon|tablespoons|oz|ounce|ounces|lb|pound|pounds|g|gram|grams|kg|kilogram|kilograms|ml|milliliter|milliliters|l|liter|liters|pt|pint|pints|qt|quart|quarts|gal|gallon|gallons|pinch|pinches|dash|dashes|clove|cloves|slice|slices|can|cans|package|packages|pkg|stick|sticks";
    static ref UNIT_REGEX: Regex = Regex::new(&format!(
        r"(?i)(^|\s|\()({})\s*({})\b",
        *NUMBER_REGEX_STR, *UNITS_REGEX_STR
    ))
    .unwrap();
    static ref TEMP_REGEX: Regex = Regex::new(
        r"(?i)(^|\s|\()(\d+(?:\s*[\-–—]\s*\d+)?)\s*(?:°|degrees?\s+)?(c|f|celsius|fahrenheit)\b"
    )
    .unwrap();
    static ref START_AMOUNT_REGEX: Regex = Regex::new(&format!(
        r"(?i)^({})(?:\s*({}))?\b",
        *NUMBER_REGEX_STR, *UNITS_REGEX_STR
    ))
    .unwrap();
}

#[derive(Clone)]
struct ConversionRule {
    to: &'static str,
    ratio: f64,
    sys: &'static str,
}

lazy_static! {
    static ref CONVERSION_MAP: HashMap<&'static str, ConversionRule> = {
        let mut m = HashMap::new();
        // Imperial to Metric
        let mut add = |keys: &[&'static str], to: &'static str, ratio: f64, sys: &'static str| {
            for k in keys {
                m.insert(*k, ConversionRule { to, ratio, sys });
            }
        };
        add(&["cup", "cups", "c"], "ml", 240.0, "metric");
        add(&["oz", "ounce", "ounces"], "g", 28.35, "metric");
        add(&["lb", "pound", "pounds"], "g", 453.6, "metric");
        add(&["pt", "pint", "pints"], "ml", 473.0, "metric");
        add(&["qt", "quart", "quarts"], "ml", 946.0, "metric");
        add(&["gal", "gallon", "gallons"], "l", 3.785, "metric");
        add(&["stick", "sticks"], "g", 113.0, "metric");

        // Metric to Imperial
        add(&["g", "gram", "grams"], "oz", 0.035274, "imperial");
        add(&["kg", "kilogram", "kilograms"], "lb", 2.20462, "imperial");
        add(&["ml", "milliliter", "milliliters"], "cup", 0.00422675, "imperial");
        add(&["l", "liter", "liters"], "cups", 4.22675, "imperial");

        m
    };
}

fn parse_fraction(frac: &str) -> f64 {
    let parts: Vec<&str> = frac.split(&['/', '⁄'][..]).collect();
    if parts.len() == 2 {
        let n: f64 = parts[0].trim().parse().unwrap_or(0.0);
        let d: f64 = parts[1].trim().parse().unwrap_or(1.0);
        if d != 0.0 {
            return n / d;
        }
    }
    0.0
}

fn parse_num_str(num_str: &str) -> f64 {
    let num_str = num_str.trim().replace('⁄', "/");

    let unicode_fractions = HashMap::from([
        ('½', 0.5),
        ('⅓', 0.333),
        ('⅔', 0.666),
        ('¼', 0.25),
        ('¾', 0.75),
        ('⅕', 0.2),
        ('⅖', 0.4),
        ('⅗', 0.6),
        ('⅘', 0.8),
        ('⅙', 0.166),
        ('⅚', 0.833),
        ('⅛', 0.125),
        ('⅜', 0.375),
        ('⅝', 0.625),
        ('⅞', 0.875),
    ]);

    let mut chars = num_str.chars();
    let last_char = chars.next_back().unwrap_or(' ');

    if let Some(&frac_val) = unicode_fractions.get(&last_char) {
        let rest = num_str[..num_str.len() - last_char.len_utf8()].trim();
        if rest.is_empty() {
            return frac_val;
        } else if let Ok(n) = rest.parse::<f64>() {
            return n + frac_val;
        } else {
            let rest_clean = rest.trim_end_matches('-');
            if let Ok(n) = rest_clean.parse::<f64>() {
                return n + frac_val;
            }
        }
    }

    if num_str.contains('/') && (num_str.contains(' ') || num_str.contains('-')) {
        let parts: Vec<&str> = num_str
            .split(&[' ', '-'][..])
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() == 2
            && let Ok(n) = parts[0].parse::<f64>()
        {
            return n + parse_fraction(parts[1]);
        }
    }

    if num_str.contains('/') {
        return parse_fraction(&num_str);
    }

    num_str.parse().unwrap_or(0.0)
}

fn get_grams(amount: f64, unit: &str) -> f64 {
    let u = unit.to_lowercase();
    let mut grams = amount;
    if u == "kg" {
        grams *= 1000.0;
    } else if u == "oz" || u == "ounce" || u == "ounces" {
        grams *= 28.35;
    } else if u == "lb" || u == "pound" || u == "pounds" {
        grams *= 453.6;
    } else if u == "ml" || u == "l" || u == "cup" || u == "cups" || u == "c" {
        if u == "l" {
            grams *= 1000.0;
        } else if u == "cup" || u == "cups" || u == "c" {
            grams *= 240.0;
        }
    }
    grams
}

#[derive(serde::Serialize, Debug)]
pub struct ConvertedRecipe {
    pub id: String,
    pub title: String,
    pub ingredients: Vec<String>,
    pub markdown: String,
    pub html: String,
    pub servings: Option<u32>,
    pub overall_hydration: Option<f64>,
    pub combustion_csv: Option<String>,
    pub leaven_type: Option<String>,
    pub leaven_amount: Option<f64>,
}

fn format_number(num: f64) -> String {
    if num.fract() == 0.0 {
        format!("{:.0}", num)
    } else {
        let s = format!("{:.2}", num);
        let s = s.trim_end_matches('0');
        if s.ends_with('.') {
            s.trim_end_matches('.').to_string()
        } else {
            s.to_string()
        }
    }
}

pub fn convert_recipe(
    mut recipe: Recipe,
    unit: Option<&str>,
    temp: Option<&str>,
    scale: Option<f64>,
    bakers: bool,
) -> ConvertedRecipe {
    let scale = scale.unwrap_or(1.0);
    let unit = unit.unwrap_or("original");
    let temp = temp.unwrap_or("original");

    // Scale servings
    if let Some(s) = recipe.servings {
        let new_s = (s as f64 * scale).round() as u32;
        recipe.servings = Some(new_s);
    }

    let flour_keywords = [
        "flour",
        "spelt",
        "rye",
        "wholemeal",
        "whole wheat",
        "semolina",
        "bread flour",
        "all-purpose",
        "all purpose",
    ];
    let starter_keywords = ["starter", "levain", "leaven"];
    let water_keywords = [
        "water",
        "milk",
        "cream",
        "buttermilk",
        "beer",
        "cider",
        "juice",
    ];

    let mut total_flour = 0.0;
    let mut total_water = 0.0;
    let mut detected_yeast = 0.0;
    let mut detected_starter = 0.0;

    for ingredient in &recipe.ingredients {
        let lower_text = ingredient.to_lowercase();
        let mut replacements = Vec::new();
        if let Some(cap) = START_AMOUNT_REGEX.captures(ingredient)
            && let Some(m) = cap.get(0)
        {
            replacements.push((
                m.start(),
                m.end(),
                cap[1].to_string(),
                cap.get(2).map_or("", |m| m.as_str()).to_string(),
            ));
        }
        for cap in UNIT_REGEX.captures_iter(ingredient) {
            let m = cap.get(0).unwrap();
            let leading = cap.get(1).map_or("", |m| m.as_str());
            if !replacements.is_empty() && replacements[0].0 == m.start() + leading.len() {
                continue;
            }
            replacements.push((
                m.start() + leading.len(),
                m.end(),
                cap[2].to_string(),
                cap[3].to_string(),
            ));
        }

        for (_, _, num_str, unit_str) in replacements {
            let amount = parse_num_str(&num_str) * scale;
            let grams = get_grams(amount, &unit_str);

            let is_starter = starter_keywords.iter().any(|k| lower_text.contains(k));
            let is_flour = flour_keywords.iter().any(|k| lower_text.contains(k))
                && !lower_text.contains("flourish");
            let is_water = water_keywords.iter().any(|k| lower_text.contains(k));
            let is_yeast = lower_text.contains("yeast") && !lower_text.contains("nutritional");

            if is_starter {
                total_flour += grams * 0.5;
                total_water += grams * 0.5;
                detected_starter += grams;
            } else if is_yeast {
                detected_yeast += grams;
            } else if is_flour {
                total_flour += grams;
            } else if is_water {
                total_water += grams;
            }
        }
    }

    let replace_text = |text: &str, is_ingredient: bool| -> String {
        let mut final_result = String::new();
        let mut last_index = 0;
        let mut replacements = Vec::new();

        if is_ingredient
            && let Some(cap) = START_AMOUNT_REGEX.captures(text)
            && let Some(m) = cap.get(0)
        {
            replacements.push((
                m.start(),
                m.end(),
                cap[1].to_string(),
                cap.get(2).map_or("", |m| m.as_str()).to_string(),
                true,
            ));
        }

        for cap in UNIT_REGEX.captures_iter(text) {
            let m = cap.get(0).unwrap();
            let leading = cap.get(1).map_or("", |m| m.as_str());
            if is_ingredient
                && !replacements.is_empty()
                && replacements[0].0 == m.start() + leading.len()
            {
                continue;
            }

            replacements.push((
                m.start() + leading.len(),
                m.end(),
                cap[2].to_string(),
                cap[3].to_string(),
                false,
            ));
        }

        for cap in TEMP_REGEX.captures_iter(text) {
            let m = cap.get(0).unwrap();
            let leading = cap.get(1).map_or("", |m| m.as_str());

            replacements.push((
                m.start() + leading.len(),
                m.end(),
                cap[2].to_string(),
                cap[3].to_string(),
                false,
            ));
        }

        replacements.sort_by_key(|r| r.0);
        let mut filtered_replacements = Vec::new();
        let mut current_end = 0;
        for r in replacements {
            if r.0 >= current_end {
                filtered_replacements.push(r.clone());
                current_end = r.1;
            }
        }

        for r in filtered_replacements {
            let start = r.0;
            let end = r.1;
            let num_str = &r.2;
            let unit_str = &r.3;

            final_result.push_str(&text[last_index..start]);

            let lower_unit = unit_str.to_lowercase();
            let is_temp = lower_unit == "c"
                || lower_unit == "f"
                || lower_unit == "celsius"
                || lower_unit == "fahrenheit";

            if is_temp {
                if temp != "original" {
                    let is_c = unit_str.to_lowercase().starts_with('c');
                    let parts: Vec<f64> = num_str
                        .split(&['-', '–', '—'][..])
                        .map(|p| p.trim().parse::<f64>().unwrap_or(0.0))
                        .collect();

                    let mut converted_parts = Vec::new();
                    for p in parts {
                        let mut cp = p;
                        if temp == "c" && !is_c {
                            cp = (p - 32.0) * 5.0 / 9.0;
                        } else if temp == "f" && is_c {
                            cp = (p * 9.0 / 5.0) + 32.0;
                        }
                        converted_parts.push(format!("{:.0}", cp.round()));
                    }
                    final_result.push_str(&converted_parts.join("-"));
                    final_result.push_str(if temp == "c" { "°C" } else { "°F" });
                } else {
                    final_result.push_str(&text[start..end]);
                }
            } else {
                let amount = parse_num_str(num_str) * scale;
                let mut final_val = amount;
                let mut final_unit = unit_str.to_string();

                if unit != "original"
                    && let Some(rule) = CONVERSION_MAP.get(lower_unit.as_str())
                    && rule.sys == unit
                {
                    final_val = amount * rule.ratio;
                    final_unit = rule.to.to_string();
                }

                if bakers && is_ingredient && total_flour > 0.0 {
                    let grams = get_grams(amount, unit_str);
                    let percentage = (grams / total_flour) * 100.0;
                    final_result.push_str(&format!("{:.1}%", percentage));
                } else if final_unit.is_empty() {
                    final_result.push_str(&format_number(final_val));
                } else {
                    final_result.push_str(&format!("{} {}", format_number(final_val), final_unit));
                }
            }
            last_index = end;
        }

        final_result.push_str(&text[last_index..]);
        final_result
    };

    recipe.ingredients = recipe
        .ingredients
        .iter()
        .map(|i| replace_text(i, true))
        .collect();
    recipe.markdown = replace_text(&recipe.markdown, false);

    let parser = pulldown_cmark::Parser::new(&recipe.markdown);
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, parser);
    let html = html_output;

    ConvertedRecipe {
        id: recipe.id,
        title: recipe.title,
        ingredients: recipe.ingredients,
        markdown: recipe.markdown,
        html,
        servings: recipe.servings,
        overall_hydration: if total_flour > 0.0 {
            Some(total_water / total_flour)
        } else {
            None
        },
        combustion_csv: recipe.combustion_csv,
        leaven_type: if detected_starter > 0.0 {
            Some("starter".to_string())
        } else if detected_yeast > 0.0 {
            Some("yeast".to_string())
        } else {
            None
        },
        leaven_amount: if total_flour > 0.0 {
            if detected_starter > 0.0 {
                Some((detected_starter / total_flour) * 100.0)
            } else if detected_yeast > 0.0 {
                Some((detected_yeast / total_flour) * 100.0)
            } else {
                None
            }
        } else {
            None
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_num_str() {
        assert_eq!(parse_num_str("1.5"), 1.5);
        assert_eq!(parse_num_str("1/2"), 0.5);
        assert_eq!(parse_num_str("1 1/2"), 1.5);
        assert_eq!(parse_num_str("1 ½"), 1.5);
        assert_eq!(parse_num_str("½"), 0.5);
    }

    #[test]
    fn test_convert_recipe() {
        let r = Recipe {
            id: "1".into(),
            title: "Test".into(),
            description: None,
            image: None,
            source_url: None,
            tags: vec![],
            servings: Some(4),
            prep_time: None,
            cook_time: None,
            ingredients: vec![
                "1 cup flour".into(),
                "2 cups water".into(),
                "1/2 tsp salt".into(),
            ],
            markdown: "Bake at 350°F for 1 1/2 hours.".into(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
        };

        // Scale by 2
        let scaled = convert_recipe(r.clone(), None, None, Some(2.0), false);
        assert_eq!(scaled.servings, Some(8));
        assert!(
            scaled.ingredients[0].contains("2 cups") || scaled.ingredients[0].contains("2 cup")
        );
        // 2 cups water (480g) / 1 cup flour (240g) = 200% hydration
        assert_eq!(scaled.overall_hydration, Some(2.0));

        // Metric conversion
        let metric = convert_recipe(r.clone(), Some("metric"), Some("c"), Some(1.0), false);
        assert!(metric.ingredients[0].contains("240 ml")); // 1 cup -> 240 ml
        assert!(metric.markdown.contains("177°C")); // 350 F -> 177 C

        // Baker's Percentage
        let bakers = convert_recipe(r.clone(), None, None, None, true);
        assert!(bakers.ingredients[0].contains("100.0%")); // Flour is 100%
        assert!(bakers.ingredients[1].contains("200.0%")); // 2 cups water (480g) / 240g flour = 200%
    }

    #[test]
    fn test_convert_recipe_reversed() {
        let r = Recipe {
            id: "2".into(),
            title: "Reversed".into(),
            description: None,
            image: None,
            source_url: None,
            tags: vec![],
            servings: Some(1),
            prep_time: None,
            cook_time: None,
            ingredients: vec!["Bread Flour 500g".into(), "Water 300g".into()],
            markdown: "".into(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
        };

        let bakers = convert_recipe(r.clone(), None, None, None, true);
        assert!(bakers.ingredients[0].contains("100.0%"));
        assert!(bakers.ingredients[1].contains("60.0%"));
    }
}
