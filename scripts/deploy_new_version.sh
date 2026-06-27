#!/bin/bash

set -euo pipefail

# Get the version from package.json
FULL_VERSION=$(cat package.json | jq -r .version | sed s/\"//g)
MINOR_VERSION=${FULL_VERSION%.*}
MAJOR_VERSION=${FULL_VERSION%%.*}
echo "Full Version:  $FULL_VERSION"
echo "Minor Version: $MINOR_VERSION"
echo "Major Version: $MAJOR_VERSION"

# Check if the tag already exists
if `git tag | grep "$FULL_VERSION" >/dev/null`; then
    echo "Error: Tag $FULL_VERSION already exists"
    exit 1
fi

# Docker - build
IMAGE_NAME="gabay/hold"
echo "* Build docker image"
docker build -t $IMAGE_NAME .

# Docker - tag & push
TAGS="latest $FULL_VERSION $MINOR_VERSION $MAJOR_VERSION"
for tag in $TAGS; do
    echo "Tag & Push $IMAGE_NAME:$tag"
    docker tag $IMAGE_NAME "$IMAGE_NAME:$tag"
    docker push "$IMAGE_NAME:$tag"
done

# Git - tag & push
git tag "$FULL_VERSION"
git push origin
