#!/bin/bash

# Install git hooks for the project

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(git rev-parse --show-toplevel)/.git/hooks"

echo "Installing git hooks..."

# Install pre-commit hook
cp "$SCRIPT_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

echo "✓ pre-commit hook installed"
echo ""
echo "Git hooks installed successfully!"
