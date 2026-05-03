# Rust Recipe Manager

A lightning-fast, highly-customizable recipe manager built in Rust. It's designed to be a central hub for all your recipes with advanced features tailored specifically for home cooks and BBQ enthusiasts.

![Kamado Theme](https://img.shields.io/badge/Theme-Kamado_BBQ-orange?style=flat-square)
![Built with Rust](https://img.shields.io/badge/Built_with-Rust-black?style=flat-square&logo=rust)

## ✨ Features

- **Blazing Fast**: Powered by Rust, Axum, and Askama templates for a near-instant user experience.
- **Mobile Optimized UX**:
  - **Tabbed Interface**: Switch seamlessly between Ingredients, Directions, and Cook Graphs on mobile devices.
  - **No-Lock Cooking**: Integrated **Wake Lock API** prevents your screen from locking while you cook.
  - **Space Saving**: Collapsible recipe photos and a streamlined header specifically for small screens.
- **Dynamic Ingredient Scaling**: Easily multiply recipe yields (e.g., 0.5x, 2x, 3x) with real-time updates directly in the text.
- **Smart Unit Conversion**: Seamlessly toggle entire recipes between Original, Metric, and Imperial systems (instantly converts measurements embedded within markdown text!).
- **Baker's Percentage Mode**: Automatically activated for recipes tagged with `bread` or `dough`. It calculates the total flour weight as 100% and displays all other ingredients as a relative percentage—essential for analyzing hydration levels and salt ratios.
- **Combustion Inc. Integration**: Upload Combustion Inc. predictive thermometer CSV exports directly to a recipe to visualize your cook's core, surface, and ambient temperatures over time with interactive Chart.js graphs.
- **Fermentation Calculator**: Intelligent tool for bread bakers. It automatically detects yeast or sourdough starter amounts in your ingredients and estimates proofing times based on your current kitchen temperature.
- **YouTube Video Integration**: 
  - **URL Import**: Paste a YouTube link and the app will use Gemini AI to "watch" the video via its transcript and generate a full recipe.
  - **Integrated Player**: Watch the original video directly inside a dedicated tab in the recipe view—perfect for following along on mobile.
- **Smart Import from Anywhere**:
  - **URL Import**: Automatically scrape recipes from URLs using LD+JSON or a robust Gemini AI fallback for sites without structured data.
  - **Paprika Import**: Bulk import archives (`.paprikarecipes`) from Paprika Recipe Manager.
  - **AI Photo Import**: Take a photo of a cookbook page, and the built-in Gemini AI Vision integration will automatically extract the title, ingredients, and instructions!
- **Interactive Tagging**: Add tags to your recipes and click them on the dashboard to instantly filter your collection.
- **Prep & Cook Times**: Automated extraction of durations from imports, or manual entry with visual indicators.
- **Beautiful Dark/Light Mode**: Premium aesthetic featuring a custom Kamado BBQ logo and vibrant orange accents.

---

## 🚀 Running Locally (Development)

**Environment Variables**:
- `GEMINI_API_KEY`: Required if you want to use the AI Photo Import feature. You can get a free key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- `APP_BASE`: (Optional) Set this if you are hosting the app behind a reverse proxy on a subpath (e.g. `APP_BASE="/recipes"`).

To run locally:
1. Ensure you have Rust and Cargo installed.
2. Run the following:

```bash
# Clone the repository
git clone https://github.com/dnewsholme/recipemanager.git
cd recipemanager

# Run the server locally
export GEMINI_API_KEY="your_api_key_here"
cargo run
```

The application will be available at `http://localhost:3000`.

---

## 🐳 Running with Docker (Production)

The application is containerized using a multi-stage Docker build, resulting in an incredibly small and secure runtime image. 

The easiest way to run the application is via Docker. Be sure to map a volume to `/app/data` to ensure your recipes and uploaded images persist across container restarts.

```bash
docker run -d \
  --name recipemanager \
  -p 3000:3000 \
  -e GEMINI_API_KEY="your_api_key_here" \
  -v /path/to/your/local/data:/app/data \
  dnewsholme/recipemanager:latest
```

### Data Directory Structure
The `/app/data` volume contains two critical subdirectories:
- `recipes/`: Contains the markdown files (`.md`) representing your saved recipes.
- `uploads/`: Contains any images or Combustion CSV files you have uploaded.

---