#!/bin/bash

set -euo pipefail

# Get the version from web/package.json
FULL_VERSION=$(jq -r .version web/package.json)
MINOR_VERSION=${FULL_VERSION%.*}
MAJOR_VERSION=${FULL_VERSION%%.*}
echo "* Full Version:  $FULL_VERSION"
echo "* Minor Version: $MINOR_VERSION"
echo "* Major Version: $MAJOR_VERSION"

# Check if the tag already exists
if `git tag | grep "$FULL_VERSION" >/dev/null`; then
    echo "* Error: Tag $FULL_VERSION already exists"
    exit 1
fi

# Docker - build
IMAGE_NAME="gabay/hold"
echo "* Build docker image"
TAGS="$MAJOR_VERSION $MINOR_VERSION $FULL_VERSION latest"

for tag in $TAGS; do
    echo "* Tag & Push $IMAGE_NAME:$tag"
    docker buildx build --platform linux/amd64,linux/arm64 -t $IMAGE_NAME:$tag --push .
done

# Git - tag & push
git tag "$FULL_VERSION"
git push --tags
