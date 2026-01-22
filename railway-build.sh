#!/bin/bash
echo "🔨 Building TrueForm Bridge..."

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install

# Install server dependencies  
echo "📦 Installing server dependencies..."
cd server && npm install && cd ..

# Install and build web app
echo "📦 Installing web dependencies..."
cd web && npm install

echo "🏗️  Building web app..."
npm run build

echo "✅ Build complete!"
