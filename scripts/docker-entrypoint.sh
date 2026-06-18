#!/bin/sh
set -e

# Path to the database file in the runtime environment
DB_PATH="/app/data/hold.db"
TEMPLATE_PATH="/app/prisma/hold.db"

# Check if the database file exists
if [ ! -f "$DB_PATH" ]; then
  echo "Initializing database at ${DB_PATH} from template..."

  if [ ! -f "$TEMPLATE_PATH" ]; then
      echo "Error: Template database not found at $TEMPLATE_PATH. Cannot initialize database."
      exit 1
  fi

  # Ensure the directory exists
  mkdir -p "$(dirname "$DB_PATH")"

  cp "$TEMPLATE_PATH" "$DB_PATH"
  echo "Database initialized successfully."
fi

export DATABASE_URL="file:${DB_PATH}"
export AUTH_TRUST_HOST=true

# Execute the main container command
exec "$@"
