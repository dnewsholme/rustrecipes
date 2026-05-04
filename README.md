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
- **Cooking Temperatures & Safety**: 
  - **Meat Temp Reference**: A dedicated reference page for internal meat temperatures and doneness levels, covering everything from rare steak to low & slow BBQ brisket.
  - **USDA Log 7 Calculator**: Interactive calculator for poultry safety. Achieve perfectly juicy chicken at lower temperatures by calculating the required hold time for safe Salmonella lethality.
- **Secure Admin Login**: Protect your recipes from unauthorized edits or imports. Set an `ADMIN_PASSWORD_HASH` environment variable to restrict modifying actions to yourself while keeping the site read-only for guests.
- **Interactive Tagging**: Add tags to your recipes and click them on the dashboard to instantly filter your collection.
- **Prep & Cook Times**: Automated extraction of durations from imports, or manual entry with visual indicators.
- **Beautiful Dark/Light Mode**: Premium aesthetic featuring a custom Kamado BBQ logo and vibrant orange accents.

---

## 🔐 Generating an Admin Password Hash

To secure your recipe manager, you need to set the `ADMIN_PASSWORD_HASH` environment variable. This prevents anyone else from editing or importing recipes. 

You can generate this hash using the included utility script:

**If you have Rust installed locally:**
```bash
cargo run --bin hash_password "my_secure_password"
```

**If you are using Docker:**
```bash
docker run --rm dnewsholme/recipemanager:latest ./hash_password "my_secure_password"
```

Copy the output (e.g., `$2y$12$...`) and use it as the value for `ADMIN_PASSWORD_HASH` when starting your server.

---

## 🚀 Running Locally (Development)

**Environment Variables**:
- `ADMIN_PASSWORD_HASH`: Required for secure login. See the section above to generate your hash. If omitted, the default temporary password is "admin".
- `SESSION_SECRET`: (Optional but recommended) A long random string used to cryptographically sign session cookies. If omitted, sessions will reset every time the server restarts.
- `GEMINI_API_KEY`: Required if you want to use the AI Photo Import or Video URL Import features. You can get a free key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- `APP_BASE`: (Optional) Set this if you are hosting the app behind a reverse proxy on a subpath (e.g. `APP_BASE="/recipes"`).

To run locally:
1. Ensure you have Rust and Cargo installed.
2. Run the following:

```bash
# Clone the repository
git clone https://github.com/dnewsholme/recipemanager.git
cd recipemanager

# Run the server locally
export ADMIN_PASSWORD_HASH='<your_generated_hash>'
export SESSION_SECRET='your_random_secret_string'
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
  -e ADMIN_PASSWORD_HASH='<your_generated_hash>' \
  -e SESSION_SECRET='your_random_secret_string' \
  -e GEMINI_API_KEY="your_api_key_here" \
  -v /path/to/your/local/data:/app/data \
  dnewsholme/recipemanager:latest
```

### Data Directory Structure
The `/app/data` volume contains two critical subdirectories:
- `recipes/`: Contains the markdown files (`.md`) representing your saved recipes.
- `uploads/`: Contains any images or Combustion CSV files you have uploaded.

---