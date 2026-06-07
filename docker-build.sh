#!/bin/bash
set -e

IMAGE_NAME="hold"
TAG="latest"

echo "Building minimal Docker image for ${IMAGE_NAME}:${TAG}..."
docker build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "============================================="
echo "Build complete! Listing image details:"
echo "============================================="
docker images | grep "${IMAGE_NAME}"
echo "============================================="
echo "To run the container locally, execute:"
echo "docker run -p 3000:3000 --env-file .env ${IMAGE_NAME}:${TAG}"
echo "============================================="
