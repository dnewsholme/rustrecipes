# Stage 1: Build the Rust application
FROM rust:slim-bookworm AS builder

# Install required system dependencies (like OpenSSL for reqwest)
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

ARG APP_VERSION=0.1.0

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY Cargo.toml Cargo.lock ./

# Create a dummy src/main.rs to pre-build dependencies
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Copy the actual source code, templates, and static files
# Note: Askama requires templates to be present during compilation!
COPY src src
COPY templates templates
COPY static static

# Touch main.rs to force recompilation of the actual code
RUN touch src/main.rs && APP_VERSION=$APP_VERSION cargo build --release

# Stage 2: Create a minimal runtime image
FROM debian:bookworm-slim

# Install runtime dependencies (OpenSSL is needed for HTTPS requests)
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary from the builder
COPY --from=builder /app/target/release/recipemanager ./

# Copy static assets (served directly by axum)
COPY --from=builder /app/static ./static

# Ensure the data directories exist and set appropriate permissions
RUN mkdir -p data/recipes data/uploads

# Expose the application port
EXPOSE 3000

# Set required environment variables
ENV HOST=0.0.0.0
ENV PORT=3000

# Run the binary
CMD ["./recipemanager"]
