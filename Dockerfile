# Use a lightweight Node.js image
FROM node:20-slim

# Set environment variables
ENV NODE_ENV=production
ENV PORT=4000
ENV MODEL_NAME=Xenova/bge-reranker-base
ENV TRANSFORMERS_CACHE=/app/.cache

# Create app directory
WORKDIR /app

# Install system dependencies if needed (e.g., for certain native modules)
# RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Pre-download the model during build to ensure fast stars and offline capability
# We run a small script to trigger the download
RUN node -e "import { pipeline } from '@xenova/transformers'; await pipeline('text-classification', process.env.MODEL_NAME);"

# Expose the port
EXPOSE 4000

# Start the application
CMD ["node", "server.js"]
