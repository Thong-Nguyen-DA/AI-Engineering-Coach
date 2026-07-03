#!/usr/bin/env bash
set -euo pipefail

ORIGINAL_BRANCH=$(git branch --show-current)
CUSTOM_BRANCH="${1:-feature/cline-integration}"

git fetch upstream

git checkout main
git merge upstream/main
git push origin main

git checkout "$CUSTOM_BRANCH"
git merge main
git push origin "$CUSTOM_BRANCH"

git checkout "$ORIGINAL_BRANCH"

echo "✅ Sync complete"
