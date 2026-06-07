#!/bin/sh
set -e

# Path to the database file in the runtime environment
DB_PATH="/app/data/hold.db"
export DATABASE_URL="file:${DB_PATH}"
TEMPLATE_PATH="/app/prisma/hold.db"

# Check if the database file exists
if [ ! -f "$DB_PATH" ]; then
  echo "Database not found at $DB_PATH. Initializing from template..."

  # Ensure the directory exists
  mkdir -p "$(dirname "$DB_PATH")"

  if [ -f "$TEMPLATE_PATH" ]; then
    cp "$TEMPLATE_PATH" "$DB_PATH"
    echo "Database initialized successfully."
  else
    echo "Error: Template database not found at $TEMPLATE_PATH. Cannot initialize database."
    exit 1
  fi
fi

# Execute the main container command
exec "$@"
