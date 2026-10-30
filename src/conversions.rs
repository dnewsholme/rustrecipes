#![allow(clippy::items_after_test_module)]
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
    static ref UNITS_REGEX_STR: &'static str = "cup|cups|c|tsp|teaspoon|teaspoons|tbsp|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|kilogram|kilograms|ml|milliliter|milliliters|l|liter|liters|pt|pint|pints|qt|quart|quarts|gal|gallon|gallons|pinch|pinches|dash|dashes|clove|cloves|slice|slices|can|cans|package|packages|pkg|stick|sticks";
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
        add(&["lb", "lbs", "pound", "pounds"], "g", 453.6, "metric");
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
    } else if u == "lb" || u == "lbs" || u == "pound" || u == "pounds" {
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

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ConvertedRecipe {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub source_url: Option<String>,
    pub tags: Vec<String>,
    pub prep_time: Option<String>,
    pub cook_time: Option<String>,
    pub ingredients: Vec<String>,
    pub structured_ingredients: Vec<crate::models::RecipeIngredient>,
    pub steps: Vec<crate::models::RecipeStep>,
    pub markdown: String,
    pub html: String,
    pub servings: Option<u32>,
    pub overall_hydration: Option<f64>,
    pub combustion_csv: Option<String>,
    pub video_url: Option<String>,
    pub youtube_id: Option<String>,
    pub favorite: bool,
    pub is_public: bool,
    pub owner_id: String,
    pub owner_email: Option<String>,
    pub is_owner: bool,
    pub leaven_type: Option<String>,
    pub leaven_amount: Option<f64>,
    pub total_flour: f64,
    pub total_water: f64,
}

pub struct RecipeTotals {
    pub total_flour: f64,
    pub total_water: f64,
    pub detected_yeast: f64,
    pub detected_starter: f64,
}

pub fn calculate_totals(ingredients: &[String], scale: f64) -> RecipeTotals {
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

    let mut totals = RecipeTotals {
        total_flour: 0.0,
        total_water: 0.0,
        detected_yeast: 0.0,
        detected_starter: 0.0,
    };

    for ingredient in ingredients {
        if is_ingredient_header(ingredient) {
            continue;
        }
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
                totals.total_flour += grams * 0.5;
                totals.total_water += grams * 0.5;
                totals.detected_starter += grams;
            } else if is_yeast {
                totals.detected_yeast += grams;
            } else if is_flour {
                totals.total_flour += grams;
            } else if is_water {
                totals.total_water += grams;
            }
        }
    }
    totals
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

    let totals = calculate_totals(&recipe.ingredients, scale);
    let total_flour = totals.total_flour;
    let total_water = totals.total_water;
    let detected_yeast = totals.detected_yeast;
    let detected_starter = totals.detected_starter;

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
        .map(|i| {
            if is_ingredient_header(i) {
                i.clone()
            } else {
                replace_text(i, true)
            }
        })
        .collect();
    recipe.markdown = replace_text(&recipe.markdown, false);
    let description = recipe.description.as_ref().map(|d| replace_text(d, false));

    let parser = pulldown_cmark::Parser::new(&recipe.markdown);
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, parser);
    let html = html_output;

    let structured_ingredients: Vec<crate::models::RecipeIngredient> = recipe
        .ingredients
        .iter()
        .enumerate()
        .map(|(idx, line)| parse_ingredient_line(line, idx as i32))
        .collect();

    let youtube_id = recipe.youtube_id();

    let parsed_md_steps = parse_recipe_steps(&recipe.markdown);
    let steps = if !parsed_md_steps.is_empty() {
        parsed_md_steps
    } else {
        recipe
            .steps
            .into_iter()
            .map(|mut s| {
                s.instruction = replace_text(&s.instruction, false);
                s
            })
            .collect()
    };

    ConvertedRecipe {
        id: recipe.id,
        title: recipe.title,
        description,
        image: recipe.image,
        source_url: recipe.source_url,
        tags: recipe.tags,
        prep_time: recipe.prep_time,
        cook_time: recipe.cook_time,
        ingredients: recipe.ingredients,
        structured_ingredients,
        steps,
        markdown: recipe.markdown,
        html,
        servings: recipe.servings,
        overall_hydration: if total_flour > 0.0 {
            Some(total_water / total_flour)
        } else {
            None
        },
        combustion_csv: recipe.combustion_csv,
        video_url: recipe.video_url,
        youtube_id,
        favorite: recipe.favorite,
        is_public: recipe.is_public,
        owner_id: recipe.owner_id,
        owner_email: recipe.owner_email,
        is_owner: false,
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
        total_flour,
        total_water,
    }
}

pub fn parse_ingredient_line(raw: &str, sort_order: i32) -> crate::models::RecipeIngredient {
    let mut trimmed = raw.trim();
    while trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        trimmed = trimmed[2..].trim();
    }

    if is_ingredient_header(trimmed) {
        return crate::models::RecipeIngredient {
            id: None,
            recipe_id: None,
            raw_text: raw.trim().to_string(),
            amount: None,
            unit: None,
            name: format_ingredient_header(trimmed),
            is_header: true,
            sort_order,
        };
    }

    if let Some(cap) = START_AMOUNT_REGEX.captures(trimmed) {
        let full_match = cap.get(0).unwrap().as_str();
        let num_str = cap.get(1).map_or("", |m| m.as_str());
        let unit_str = cap.get(2).map(|m| m.as_str().to_string());
        let amount = Some(parse_num_str(num_str));

        let remainder = trimmed[full_match.len()..].trim();
        let name = remainder
            .trim_start_matches(['-', ',', ' ', ':'])
            .trim()
            .to_string();

        crate::models::RecipeIngredient {
            id: None,
            recipe_id: None,
            raw_text: raw.trim().to_string(),
            amount,
            unit: unit_str,
            name: if name.is_empty() {
                trimmed.to_string()
            } else {
                name
            },
            is_header: false,
            sort_order,
        }
    } else {
        crate::models::RecipeIngredient {
            id: None,
            recipe_id: None,
            raw_text: raw.trim().to_string(),
            amount: None,
            unit: None,
            name: trimmed.to_string(),
            is_header: false,
            sort_order,
        }
    }
}

pub fn parse_recipe_steps(markdown: &str) -> Vec<crate::models::RecipeStep> {
    let mut steps = Vec::new();
    let mut step_num = 1;
    let mut current_section: Option<String> = None;
    let step_num_re = regex::Regex::new(r"^(?:(?i:step)\s+)?\d+[\.:\)]\s*").ok();

    // Ensure markdown heading lines (e.g. "## Marinade", "### Dough") are separated into their own blocks
    // even when written without blank lines before or after them.
    let re_heading_line = regex::Regex::new(r"(?m)^[ \t]*(#{1,6}[ \t]+[^\r\n]+)\r?$").unwrap();
    let with_headings_isolated = re_heading_line.replace_all(markdown, "\n\n$1\n\n");

    // Ensure steps with numbers (e.g. "1. Mix\n2. Rest") or bullets have paragraph breaks so they parse properly
    // even without double line breaks.
    let re_single_break =
        regex::Regex::new(r"([^\n])\r?\n(\s*(?:(?:(?i:step)\s+)?\d+[\.:\)]|[-\*]\s+))").unwrap();
    let normalized = re_single_break.replace_all(&with_headings_isolated, "$1\n\n$2");

    for block in normalized.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        // Handle heading blocks: skip generic top-level "Instructions"/"Directions" headers,
        // and treat stage headings (e.g. "## Marinade", "## Dough") as stage separators that reset step numbering.
        if block.starts_with('#') && !block.contains('\n') {
            let heading_text = block
                .trim_start_matches('#')
                .trim()
                .trim_end_matches(':')
                .trim();
            let lower = heading_text.to_lowercase();
            if matches!(
                lower.as_str(),
                "instructions"
                    | "instruction"
                    | "directions"
                    | "direction"
                    | "method"
                    | "steps"
                    | "preparation"
            ) && current_section.is_none()
                && steps.is_empty()
            {
                continue;
            }
            if !heading_text.is_empty() {
                current_section = Some(heading_text.to_string());
                step_num = 1;
            }
            continue;
        }

        let lines: Vec<&str> = block
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        let all_numbered = !lines.is_empty()
            && lines
                .iter()
                .all(|l| l.chars().next().is_some_and(|c| c.is_ascii_digit()) && l.contains('.'));

        if all_numbered && lines.len() > 1 {
            for line in lines {
                let text = if let Some(idx) = line.find('.') {
                    line[idx + 1..].trim()
                } else {
                    line
                };
                if !text.is_empty() {
                    steps.push(crate::models::RecipeStep {
                        id: None,
                        recipe_id: None,
                        step_number: step_num,
                        instruction: text.to_string(),
                        section: current_section.clone(),
                    });
                    step_num += 1;
                }
            }
        } else {
            let mut text = block;
            if let Some(cap) = step_num_re.as_ref().and_then(|r| r.find(block)) {
                text = &block[cap.end()..];
            } else if let Some(stripped) = block.strip_prefix("- ") {
                text = stripped;
            } else if let Some(stripped) = block.strip_prefix("* ") {
                text = stripped;
            }

            steps.push(crate::models::RecipeStep {
                id: None,
                recipe_id: None,
                step_number: step_num,
                instruction: text.trim().to_string(),
                section: current_section.clone(),
            });
            step_num += 1;
        }
    }

    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_recipe_steps_without_blank_lines() {
        let md = "1. Mix flour, water, and salt.\n2. Rest for 30 minutes.\n3. Bake at 450°F.";
        let steps = parse_recipe_steps(md);
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[0].instruction, "Mix flour, water, and salt.");
        assert_eq!(steps[0].section, None);
        assert_eq!(steps[1].instruction, "Rest for 30 minutes.");
        assert_eq!(steps[2].instruction, "Bake at 450°F.");

        let md_with_heading = "### Instructions\n1. Mix flour\n2. Bake";
        let steps2 = parse_recipe_steps(md_with_heading);
        assert_eq!(steps2.len(), 2);
        assert_eq!(steps2[0].instruction, "Mix flour");
        assert_eq!(steps2[0].section, None);
        assert_eq!(steps2[1].instruction, "Bake");

        let md_stages = "## Marinade\n1. Whisk soy sauce and garlic.\n2. Coat chicken for 30 minutes.\n## Dough\n1. Combine flour and water.\n2. Knead for 10 minutes.";
        let stage_steps = parse_recipe_steps(md_stages);
        assert_eq!(stage_steps.len(), 4);
        assert_eq!(stage_steps[0].section.as_deref(), Some("Marinade"));
        assert_eq!(stage_steps[0].step_number, 1);
        assert_eq!(stage_steps[0].instruction, "Whisk soy sauce and garlic.");
        assert_eq!(stage_steps[1].section.as_deref(), Some("Marinade"));
        assert_eq!(stage_steps[1].step_number, 2);
        assert_eq!(stage_steps[1].instruction, "Coat chicken for 30 minutes.");
        assert_eq!(stage_steps[2].section.as_deref(), Some("Dough"));
        assert_eq!(stage_steps[2].step_number, 1);
        assert_eq!(stage_steps[2].instruction, "Combine flour and water.");
        assert_eq!(stage_steps[3].section.as_deref(), Some("Dough"));
        assert_eq!(stage_steps[3].step_number, 2);
        assert_eq!(stage_steps[3].instruction, "Knead for 10 minutes.");
    }

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
            description: Some("Bake at 350°F".into()),
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
            markdown: "rise at a warm room temperature (70°F to 75°F) for 1 hour. preheat the oven to 475°F.".into(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
            owner_id: "admin".to_string(),
            is_public: true,
            owner_email: None,
            ..Default::default()
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
        assert!(metric.markdown.contains("21°C")); // 70 F -> 21 C
        assert!(metric.markdown.contains("24°C")); // 75 F -> 24 C
        assert!(metric.markdown.contains("246°C")); // 475 F -> 246 C
        assert_eq!(metric.description, Some("Bake at 177°C".into())); // Verify description also converts!

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
            owner_id: "admin".to_string(),
            is_public: true,
            owner_email: None,
            ..Default::default()
        };

        let bakers = convert_recipe(r.clone(), None, None, None, true);
        assert!(bakers.ingredients[0].contains("100.0%"));
        assert!(bakers.ingredients[1].contains("60.0%"));
        assert_eq!(bakers.overall_hydration, Some(0.6));
    }

    #[test]
    fn test_shopping_list() {
        let r1 = Recipe {
            id: "1".into(),
            title: "Test 1".into(),
            description: None,
            image: None,
            source_url: None,
            tags: vec![],
            servings: Some(2),
            prep_time: None,
            cook_time: None,
            ingredients: vec!["1 cup flour".into(), "100 g sugar".into()],
            markdown: "".into(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
            owner_id: "admin".to_string(),
            is_public: true,
            owner_email: None,
            ..Default::default()
        };

        let r2 = Recipe {
            id: "2".into(),
            title: "Test 2".into(),
            description: None,
            image: None,
            source_url: None,
            tags: vec![],
            servings: Some(4),
            prep_time: None,
            cook_time: None,
            ingredients: vec![
                "2 cups flour".into(),
                "100 g sugar".into(),
                "1 apple".into(),
            ],
            markdown: "".into(),
            html: None,
            combustion_csv: None,
            video_url: None,
            favorite: false,
            owner_id: "admin".to_string(),
            is_public: true,
            owner_email: None,
            ..Default::default()
        };

        let res = crate::conversions::generate_combined_shopping_list(vec![r1, r2], 4, "metric");
        assert_eq!(res.len(), 3);
        // 1 cup (240ml) * 2 = 480ml. 2 cups (480ml) * 1 = 480ml. Total = 960ml flour.
        // 100g * 2 = 200g. 100g * 1 = 100g. Total = 300g sugar.
        // 1 apple * 1 = 1 apple.
        assert!(res.contains(&"960 ml flour".to_string()));
        assert!(res.contains(&"300 g sugar".to_string()));
        assert!(res.contains(&"1 apple".to_string()));
    }

    #[test]
    fn test_combine_shopping_items_with_different_units_and_bullets() {
        let existing = vec![
            crate::models::ShoppingItem {
                name: "500 g flour".to_string(),
                checked: false,
            },
            crate::models::ShoppingItem {
                name: "2 eggs".to_string(),
                checked: false,
            },
        ];

        let r = Recipe {
            id: "1".into(),
            title: "Test Recipe".into(),
            servings: Some(1),
            ingredients: vec![
                "- 1 kg flour".into(),
                "- 3 eggs".into(),
                "Bread Flour 500g".into(),
            ],
            ..Default::default()
        };

        let combined = combine_shopping_items_with_recipes(existing, vec![r], None, "metric");
        // 500g + 1kg (1000g) = 1500 g flour
        // 2 eggs + 3 eggs = 5 eggs
        // Bread Flour 500g = 500 g Bread Flour
        let names: Vec<String> = combined.iter().map(|it| it.name.clone()).collect();
        assert!(names.contains(&"1500 g flour".to_string()));
        assert!(names.contains(&"5 eggs".to_string()));
        assert!(
            names
                .iter()
                .any(|n| n.contains("500 g") && n.to_lowercase().contains("bread flour"))
        );
    }
}

pub fn normalize_ingredient_name(name: &str) -> String {
    let mut cleaned = name.trim().to_lowercase();
    while cleaned.starts_with("- ") || cleaned.starts_with("* ") || cleaned.starts_with("+ ") {
        cleaned = cleaned[2..].trim().to_string();
    }
    let trimmed = cleaned
        .trim_matches(['-', '*', '+', ',', ':', ';', '.', ' '])
        .trim();
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    if words.is_empty() {
        return String::new();
    }
    let mut result_words = Vec::new();
    for (i, w) in words.iter().enumerate() {
        if i == words.len() - 1
            && w.len() > 3
            && w.ends_with('s')
            && !w.ends_with("ss")
            && !w.ends_with("us")
            && !w.ends_with("is")
        {
            if let Some(stem) = w.strip_suffix("ies") {
                result_words.push(format!("{}y", stem));
            } else if (w.ends_with("ches") || w.ends_with("shes") || w.ends_with("xes"))
                && let Some(stem) = w.strip_suffix("es")
            {
                result_words.push(stem.to_string());
            } else if !w.ends_with("es")
                && let Some(stem) = w.strip_suffix('s')
            {
                result_words.push(stem.to_string());
            } else {
                result_words.push(w.to_string());
            }
        } else {
            result_words.push(w.to_string());
        }
    }
    result_words.join(" ")
}

pub fn parse_shopping_item_raw(raw: &str) -> Option<(f64, String, String)> {
    let mut s = raw.trim();
    while s.starts_with("- ") || s.starts_with("* ") || s.starts_with("+ ") {
        s = s[2..].trim();
    }
    if is_ingredient_header(s) || s.is_empty() {
        return None;
    }

    if let Some(cap) = START_AMOUNT_REGEX.captures(s) {
        let num_str = cap.get(1).map_or("", |m| m.as_str());
        let unit_str = cap.get(2).map_or("", |m| m.as_str());
        let amount = parse_num_str(num_str);
        let m = cap.get(0).unwrap();
        let remainder = s[m.end()..].trim();
        let name = remainder.trim_start_matches(['-', ',', ' ', ':']).trim();
        if !name.is_empty() {
            return Some((amount, unit_str.to_string(), name.to_string()));
        }
    }

    // Check reversed ingredient: e.g. "Bread Flour 500g" or "Water 300ml"
    if let Some(cap) = UNIT_REGEX.captures(s) {
        let m = cap.get(0).unwrap();
        let leading = cap.get(1).map_or("", |m| m.as_str());
        let num_str = cap.get(2).map_or("", |m| m.as_str());
        let unit_str = cap.get(3).map_or("", |m| m.as_str());
        let amount = parse_num_str(num_str);
        let match_start = m.start() + leading.len();
        let prefix = s[..match_start].trim();
        let suffix = s[m.end()..].trim();
        let name = format!("{} {}", prefix, suffix)
            .trim()
            .trim_start_matches(['-', ',', ' ', ':'])
            .trim()
            .to_string();
        if !name.is_empty() {
            return Some((amount, unit_str.to_string(), name));
        }
    }

    None
}

fn normalize_unit_and_amount(amount: f64, unit: &str, unit_system: &str) -> (f64, String) {
    let u = unit.trim().to_lowercase();
    if unit_system == "metric" {
        match u.as_str() {
            "kg" | "kilogram" | "kilograms" => (amount * 1000.0, "g".to_string()),
            "l" | "liter" | "liters" => (amount * 1000.0, "ml".to_string()),
            "cup" | "cups" | "c" => (amount * 240.0, "ml".to_string()),
            "oz" | "ounce" | "ounces" => (amount * 28.35, "g".to_string()),
            "lb" | "lbs" | "pound" | "pounds" => (amount * 453.6, "g".to_string()),
            "stick" | "sticks" => (amount * 113.0, "g".to_string()),
            "pt" | "pint" | "pints" => (amount * 473.0, "ml".to_string()),
            "qt" | "quart" | "quarts" => (amount * 946.0, "ml".to_string()),
            "gal" | "gallon" | "gallons" => (amount * 3785.0, "ml".to_string()),
            "tbsp" | "tablespoon" | "tablespoons" => (amount, "tbsp".to_string()),
            "tsp" | "teaspoon" | "teaspoons" => (amount, "tsp".to_string()),
            "g" | "gram" | "grams" => (amount, "g".to_string()),
            "ml" | "milliliter" | "milliliters" => (amount, "ml".to_string()),
            other => (amount, other.to_string()),
        }
    } else {
        match u.as_str() {
            "cup" | "cups" | "c" => (amount, "cup".to_string()),
            "tbsp" | "tablespoon" | "tablespoons" => (amount, "tbsp".to_string()),
            "tsp" | "teaspoon" | "teaspoons" => (amount, "tsp".to_string()),
            "oz" | "ounce" | "ounces" => (amount, "oz".to_string()),
            "lb" | "lbs" | "pound" | "pounds" => (amount, "lb".to_string()),
            other => (amount, other.to_string()),
        }
    }
}

pub fn combine_shopping_items_with_recipes(
    existing: Vec<crate::models::ShoppingItem>,
    recipes: Vec<Recipe>,
    portions: Option<u32>,
    unit_system: &str,
) -> Vec<crate::models::ShoppingItem> {
    let mut combined: HashMap<(String, String), f64> = HashMap::new();
    let mut display_names: HashMap<String, String> = HashMap::new();
    let mut uncombined: Vec<String> = Vec::new();
    let mut checked_items: Vec<crate::models::ShoppingItem> = Vec::new();

    // 1. Process existing unchecked shopping list items
    for item in existing {
        if item.checked {
            checked_items.push(item);
            continue;
        }
        if let Some((amount, unit, name)) = parse_shopping_item_raw(&item.name) {
            let (norm_amount, norm_unit) = normalize_unit_and_amount(amount, &unit, unit_system);
            let norm_name = normalize_ingredient_name(&name);
            display_names.entry(norm_name.clone()).or_insert(name);
            *combined.entry((norm_name, norm_unit)).or_insert(0.0) += norm_amount;
        } else if !item.name.trim().is_empty() {
            uncombined.push(item.name.trim().to_string());
        }
    }

    // 2. Process new recipes
    for recipe in recipes {
        let scale = match portions {
            Some(p) if p > 0 => p as f64 / recipe.servings.unwrap_or(1) as f64,
            _ => 1.0,
        };
        let converted = convert_recipe(recipe, Some(unit_system), None, Some(scale), false);

        for ingredient in converted.ingredients {
            if is_ingredient_header(&ingredient) {
                continue;
            }
            if let Some((amount, unit, name)) = parse_shopping_item_raw(&ingredient) {
                let (norm_amount, norm_unit) =
                    normalize_unit_and_amount(amount, &unit, unit_system);
                let norm_name = normalize_ingredient_name(&name);
                display_names.entry(norm_name.clone()).or_insert(name);
                *combined.entry((norm_name, norm_unit)).or_insert(0.0) += norm_amount;
            } else {
                let mut clean = ingredient.trim();
                while clean.starts_with("- ") || clean.starts_with("* ") || clean.starts_with("+ ")
                {
                    clean = clean[2..].trim();
                }
                if !clean.is_empty() {
                    uncombined.push(clean.to_string());
                }
            }
        }
    }

    let mut result_items = Vec::new();
    let mut keys: Vec<(String, String)> = combined.keys().cloned().collect();
    keys.sort();

    for (norm_name, unit) in keys {
        let amount = combined[&(norm_name.clone(), unit.clone())];
        let formatted_amount = format_number(amount);
        let display_name = display_names.get(&norm_name).cloned().unwrap_or(norm_name);

        let item_str = if unit.is_empty() {
            if amount > 1.0 && !display_name.ends_with('s') {
                format!("{} {}s", formatted_amount, display_name)
            } else {
                format!("{} {}", formatted_amount, display_name)
            }
        } else {
            format!("{} {} {}", formatted_amount, unit, display_name)
        };

        result_items.push(crate::models::ShoppingItem {
            name: item_str,
            checked: false,
        });
    }

    uncombined.dedup();
    for u in uncombined {
        result_items.push(crate::models::ShoppingItem {
            name: u,
            checked: false,
        });
    }

    result_items.extend(checked_items);
    result_items
}

#[allow(dead_code)]
pub fn generate_combined_shopping_list(
    recipes: Vec<Recipe>,
    portions: u32,
    unit_system: &str,
) -> Vec<String> {
    combine_shopping_items_with_recipes(vec![], recipes, Some(portions), unit_system)
        .into_iter()
        .map(|it| it.name)
        .collect()
}

pub fn is_ingredient_header(line: &str) -> bool {
    let mut trimmed = line.trim();
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        trimmed = trimmed[2..].trim();
    } else if trimmed.starts_with("-") && !trimmed.starts_with("--") {
        trimmed = trimmed[1..].trim();
    }

    if trimmed.is_empty() {
        return false;
    }
    trimmed.starts_with('#')
        || (trimmed.starts_with("--") && trimmed.ends_with("--"))
        || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with("--") && trimmed.len() > 2)
        || trimmed.ends_with(':')
}

pub fn format_ingredient_header(line: &str) -> String {
    let mut trimmed = line.trim();
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        trimmed = trimmed[2..].trim();
    } else if trimmed.starts_with("-") && !trimmed.starts_with("--") {
        trimmed = trimmed[1..].trim();
    }

    while trimmed.starts_with('#') {
        trimmed = trimmed[1..].trim();
    }
    if trimmed.starts_with("--") {
        trimmed = trimmed[2..].trim();
    }
    if trimmed.ends_with("--") {
        trimmed = trimmed[..trimmed.len() - 2].trim();
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        trimmed = trimmed[1..trimmed.len() - 1].trim();
    }
    if trimmed.ends_with(':') {
        trimmed = trimmed[..trimmed.len() - 1].trim();
    }
    trimmed.to_string()
}
