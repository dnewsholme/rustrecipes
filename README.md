# Rust Recipe Manager

A lightning-fast, highly-customizable recipe manager built in Rust. It's designed to be a central hub for all your recipes with advanced features tailored specifically for home cooks and BBQ enthusiasts.

![Kamado Theme](https://img.shields.io/badge/Theme-Kamado_BBQ-orange?style=flat-square)
![Built with Rust](https://img.shields.io/badge/Built_with-Rust-black?style=flat-square&logo=rust)

## ✨ Features

- **Blazing Fast**: Powered by Rust, Axum, and Askama templates.
- **Dynamic Ingredient Scaling**: Easily multiply recipe yields (e.g., 0.5x, 2x, 3x) with real-time updates directly in the text.
- **Smart Unit Conversion**: Seamlessly toggle entire recipes between Original, Metric, and Imperial systems (instantly converts measurements embedded within markdown text!).
- **Combustion Inc. Integration**: Upload Combustion Inc. predictive thermometer CSV exports directly to a recipe to visualize your cook's core, surface, and ambient temperatures over time with interactive Chart.js graphs.
- **Import from Anywhere**:
  - Automatically scrape recipes by pasting a URL from popular cooking sites.
  - Import bulk archives (`.paprikarecipes`) from Paprika Recipe Manager.
  - **AI Photo Import**: Take a photo of a cookbook page, and the built-in Gemini AI Vision integration will automatically extract the title, ingredients, and instructions!
- **Beautiful Dark/Light Mode**: Premium aesthetic featuring a custom Kamado BBQ logo and vibrant orange accents.

---

## 🚀 Running Locally (Development)

To use the AI Photo Import feature, you'll need a free Gemini API key:
1. Go to Google AI Studio (https://aistudio.google.com/app/apikey).
2. Create an API Key.
3. Export it as an environment variable before running the app.

Ensure you have Rust and Cargo installed, then:

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

## 🔄 Automated Builds (GitHub Actions)

This repository is configured with a GitHub Actions workflow (`.github/workflows/docker.yml`). 
Every time code is pushed to the `main` branch, it automatically builds a new multi-stage Docker image and publishes it to Docker Hub as `dnewsholme/recipemanager:latest`.

**Required Repository Secrets:**
To enable this automation, ensure the following secrets are configured in your GitHub repository:
- `DOCKERHUB_USERNAME`: Your Docker Hub username.
- `DOCKERHUB_TOKEN`: A Docker Hub Personal Access Token (PAT).
