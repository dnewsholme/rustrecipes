use recipemanager::models::Recipe;
use recipemanager::conversions::generate_combined_shopping_list;

fn main() {
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
        ingredients: vec!["2 cups flour".into(), "100 g sugar".into(), "1 apple".into()],
        markdown: "".into(),
        html: None,
        combustion_csv: None,
        video_url: None,
        favorite: false,
    };

    let res = generate_combined_shopping_list(vec![r1, r2], 4, "metric");
    println!("{:#?}", res);
}
