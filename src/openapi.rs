use axum::{
    Json,
    response::{Html, IntoResponse, Response},
};
use serde_json::json;

pub async fn openapi_json() -> impl IntoResponse {
    let spec = json!({
        "openapi": "3.0.3",
        "info": {
            "title": "Recipe Manager API",
            "description": "RESTful API for Recipe Manager with structured recipes, ingredient scaling, sourdough hydration, temperature conversions, meal planning, and shopping lists.",
            "version": "1.0.0"
        },
        "servers": [
            {
                "url": "/api/v1",
                "description": "API v1 Endpoint"
            }
        ],
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "API Token"
                },
                "cookieAuth": {
                    "type": "apiKey",
                    "in": "cookie",
                    "name": "admin_session"
                }
            },
            "schemas": {
                "RecipeIngredient": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "integer", "nullable": true },
                        "recipe_id": { "type": "string", "nullable": true },
                        "raw_text": { "type": "string" },
                        "amount": { "type": "number", "format": "double", "nullable": true },
                        "unit": { "type": "string", "nullable": true },
                        "name": { "type": "string" },
                        "is_header": { "type": "boolean" },
                        "sort_order": { "type": "integer" }
                    },
                    "required": ["raw_text", "name", "is_header", "sort_order"]
                },
                "RecipeStep": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "integer", "nullable": true },
                        "recipe_id": { "type": "string", "nullable": true },
                        "step_number": { "type": "integer" },
                        "instruction": { "type": "string" },
                        "section": { "type": "string", "nullable": true }
                    },
                    "required": ["step_number", "instruction"]
                },
                "Recipe": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "title": { "type": "string" },
                        "description": { "type": "string", "nullable": true },
                        "image": { "type": "string", "nullable": true },
                        "source_url": { "type": "string", "nullable": true },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "servings": { "type": "integer", "nullable": true },
                        "prep_time": { "type": "string", "nullable": true },
                        "cook_time": { "type": "string", "nullable": true },
                        "ingredients": { "type": "array", "items": { "type": "string" } },
                        "structured_ingredients": { "type": "array", "items": { "$ref": "#/components/schemas/RecipeIngredient" } },
                        "steps": { "type": "array", "items": { "$ref": "#/components/schemas/RecipeStep" } },
                        "markdown": { "type": "string" },
                        "html": { "type": "string", "nullable": true },
                        "combustion_csv": { "type": "string", "nullable": true },
                        "video_url": { "type": "string", "nullable": true },
                        "youtube_id": { "type": "string", "nullable": true },
                        "favorite": { "type": "boolean" },
                        "is_public": { "type": "boolean" },
                        "owner_id": { "type": "string" },
                        "owner_email": { "type": "string", "nullable": true },
                        "is_owner": { "type": "boolean" },
                        "overall_hydration": { "type": "number", "format": "double", "nullable": true },
                        "leaven_type": { "type": "string", "nullable": true },
                        "leaven_amount": { "type": "number", "format": "double", "nullable": true },
                        "total_flour": { "type": "number", "format": "double" },
                        "total_water": { "type": "number", "format": "double" }
                    },
                    "required": ["id", "title", "ingredients", "markdown"]
                },
                "RecipeInput": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "description": { "type": "string", "nullable": true },
                        "image": { "type": "string", "nullable": true },
                        "source_url": { "type": "string", "nullable": true },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "servings": { "type": "integer", "nullable": true },
                        "prep_time": { "type": "string", "nullable": true },
                        "cook_time": { "type": "string", "nullable": true },
                        "ingredients": { "type": "array", "items": { "type": "string" } },
                        "markdown": { "type": "string" },
                        "combustion_csv": { "type": "string", "nullable": true },
                        "video_url": { "type": "string", "nullable": true },
                        "is_public": { "type": "boolean", "nullable": true }
                    },
                    "required": ["title", "markdown"]
                },
                "ShoppingListItem": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "checked": { "type": "boolean" }
                    },
                    "required": ["name", "checked"]
                },
                "MealPlanItem": {
                    "type": "object",
                    "properties": {
                        "recipe_id": { "type": "string" },
                        "title": { "type": "string" },
                        "checked": { "type": "boolean" },
                        "image": { "type": "string", "nullable": true }
                    },
                    "required": ["recipe_id", "title", "checked"]
                },
                "ErrorResponse": {
                    "type": "object",
                    "properties": {
                        "error": {
                            "type": "object",
                            "properties": {
                                "code": { "type": "string" },
                                "message": { "type": "string" }
                            },
                            "required": ["code", "message"]
                        }
                    },
                    "required": ["error"]
                }
            }
        },
        "paths": {
            "/recipes": {
                "get": {
                    "summary": "List recipes",
                    "description": "Retrieve a list of recipes visible to the current caller.",
                    "parameters": [
                        { "name": "tag", "in": "query", "schema": { "type": "string" }, "description": "Filter by tag" },
                        { "name": "q", "in": "query", "schema": { "type": "string" }, "description": "Search query matching title or ingredients" },
                        { "name": "favorite", "in": "query", "schema": { "type": "boolean" }, "description": "Filter favorite recipes only" },
                        { "name": "page", "in": "query", "schema": { "type": "integer", "default": 1 }, "description": "Page number" },
                        { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 50 }, "description": "Page size limit" }
                    ],
                    "responses": {
                        "200": {
                            "description": "List of recipes",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "recipes": { "type": "array", "items": { "$ref": "#/components/schemas/Recipe" } },
                                            "total": { "type": "integer" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "post": {
                    "summary": "Create recipe",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": { "schema": { "$ref": "#/components/schemas/RecipeInput" } }
                        }
                    },
                    "responses": {
                        "201": {
                            "description": "Recipe created",
                            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Recipe" } } }
                        },
                        "400": { "$ref": "#/components/schemas/ErrorResponse" },
                        "401": { "$ref": "#/components/schemas/ErrorResponse" }
                    }
                }
            },
            "/recipes/{id}": {
                "get": {
                    "summary": "Get recipe with server-side conversions and scaling",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "scale", "in": "query", "schema": { "type": "number", "default": 1.0 }, "description": "Recipe yield scaling multiplier" },
                        { "name": "unit", "in": "query", "schema": { "type": "string", "enum": ["original", "metric", "imperial"] }, "description": "Unit system conversion" },
                        { "name": "temp", "in": "query", "schema": { "type": "string", "enum": ["original", "c", "f"] }, "description": "Temperature scale conversion" },
                        { "name": "bakers", "in": "query", "schema": { "type": "boolean", "default": false }, "description": "Calculate and append Baker's Percentages" }
                    ],
                    "responses": {
                        "200": {
                            "description": "Recipe details with server-computed conversions",
                            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Recipe" } } }
                        },
                        "404": { "$ref": "#/components/schemas/ErrorResponse" }
                    }
                },
                "put": {
                    "summary": "Update recipe",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/RecipeInput" } } }
                    },
                    "responses": {
                        "200": { "description": "Recipe updated", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Recipe" } } } },
                        "401": { "$ref": "#/components/schemas/ErrorResponse" },
                        "403": { "$ref": "#/components/schemas/ErrorResponse" },
                        "404": { "$ref": "#/components/schemas/ErrorResponse" }
                    }
                },
                "delete": {
                    "summary": "Delete recipe",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "204": { "description": "Recipe deleted successfully" },
                        "401": { "$ref": "#/components/schemas/ErrorResponse" },
                        "403": { "$ref": "#/components/schemas/ErrorResponse" },
                        "404": { "$ref": "#/components/schemas/ErrorResponse" }
                    }
                }
            },
            "/recipes/{id}/notes": {
                "get": {
                    "summary": "Get personal notes for a recipe",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": { "notes": { "type": "string" } }
                                    }
                                }
                            }
                        }
                    }
                },
                "post": {
                    "summary": "Save personal notes for a recipe",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": { "notes": { "type": "string" } },
                                    "required": ["notes"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Notes saved" }
                    }
                }
            },
            "/shopping-list": {
                "get": {
                    "summary": "Get current saved shopping list",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": { "$ref": "#/components/schemas/ShoppingListItem" }
                                    }
                                }
                            }
                        }
                    }
                },
                "post": {
                    "summary": "Generate combined shopping list from recipe IDs",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "recipe_ids": { "type": "array", "items": { "type": "string" } },
                                        "servings": { "type": "integer", "nullable": true },
                                        "unit": { "type": "string", "enum": ["original", "metric", "imperial"], "default": "metric" }
                                    },
                                    "required": ["recipe_ids"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": { "$ref": "#/components/schemas/ShoppingListItem" }
                                    }
                                }
                            }
                        }
                    }
                },
                "put": {
                    "summary": "Update and persist shopping list items",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "array",
                                    "items": { "$ref": "#/components/schemas/ShoppingListItem" }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Shopping list updated" }
                    }
                },
                "delete": {
                    "summary": "Clear shopping list",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "responses": {
                        "204": { "description": "Shopping list cleared" }
                    }
                }
            },
            "/meal-plan": {
                "get": {
                    "summary": "Get user meal plan items",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": { "$ref": "#/components/schemas/MealPlanItem" }
                                    }
                                }
                            }
                        }
                    }
                },
                "post": {
                    "summary": "Add recipe to meal plan",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": { "recipe_id": { "type": "string" } },
                                    "required": ["recipe_id"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Recipe added to meal plan" }
                    }
                },
                "delete": {
                    "summary": "Clear meal plan",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "responses": {
                        "204": { "description": "Meal plan cleared" }
                    }
                }
            },
            "/meal-plan/toggle": {
                "post": {
                    "summary": "Toggle planned meal checked state",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": { "recipe_id": { "type": "string" } },
                                    "required": ["recipe_id"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Meal checked state toggled" }
                    }
                }
            },
            "/meal-plan/{id}": {
                "delete": {
                    "summary": "Remove recipe from meal plan",
                    "security": [{ "cookieAuth": [] }, { "bearerAuth": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": {
                        "204": { "description": "Removed from meal plan" }
                    }
                }
            },
            "/ferment": {
                "get": {
                    "summary": "Calculate sourdough fermentation times",
                    "parameters": [
                        { "name": "type", "in": "query", "required": true, "schema": { "type": "string", "enum": ["starter", "yeast"] } },
                        { "name": "amount", "in": "query", "required": true, "schema": { "type": "number" } },
                        { "name": "temp", "in": "query", "required": true, "schema": { "type": "number" } }
                    ],
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "bulk_hours": { "type": "number" },
                                            "proof_hours": { "type": "number" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/temps": {
                "get": {
                    "summary": "Get culinary cooking and meat doneness temperatures",
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "category": { "type": "string" },
                                                "item": { "type": "string" },
                                                "target_c": { "type": "number" },
                                                "target_f": { "type": "number" },
                                                "notes": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/spices": {
                "get": {
                    "summary": "List available spices and pantry ingredients",
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/auth/me": {
                "get": {
                    "summary": "Get current session user and system capabilities",
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "user": {
                                                "type": "object",
                                                "nullable": true,
                                                "properties": {
                                                    "id": { "type": "string" },
                                                    "email": { "type": "string" },
                                                    "is_admin": { "type": "boolean" }
                                                }
                                            },
                                            "config": {
                                                "type": "object",
                                                "properties": {
                                                    "app_base": { "type": "string" },
                                                    "google_auth_enabled": { "type": "boolean" },
                                                    "oidc_auth_enabled": { "type": "boolean" },
                                                    "oidc_provider_name": { "type": "string" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    Json(spec)
}

pub async fn swagger_ui(app_base: &str) -> Response {
    let spec_url = if app_base.is_empty() {
        "/api/v1/openapi.json".to_string()
    } else {
        format!("{}/api/v1/openapi.json", app_base)
    };

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Recipe Manager - API Documentation</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
    <style>
        body {{
            margin: 0;
            background: #0f172a;
        }}
        .swagger-ui .topbar {{
            display: none;
        }}
        .swagger-ui {{
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        }}
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
    <script>
        window.onload = () => {{
            window.ui = SwaggerUIBundle({{
                url: '{spec_url}',
                dom_id: '#swagger-ui',
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: "BaseLayout",
                deepLinking: true
            }});
        }};
    </script>
</body>
</html>"#
    );

    Html(html).into_response()
}
