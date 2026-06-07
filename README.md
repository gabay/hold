# Simple Portfolio Manager

A lightweight, dark-mode portfolio tracking application built with **Next.js 16 (App Router)**, **TypeScript**, **Tailwind CSS v4**, **Prisma**, and **SQLite**.

## Features
- **Transaction Logging**: Log ETF/Stock buy and sell activities.
- **Dynamic Valuations**: Tracks portfolio cost basis, current valuations, and returns over time.
- **Dynamic Charts**: Interactive time-series performance charts (1M, YTD, 1Y, 5Y, MAX) with a Brush timeline slider for zooming and seeking.
- **Multi-Currency Valuations**: Format calculations dynamically in **USD ($)**, **EUR (€)**, **GBP (£)**, or **ILS (₪)** using cached exchange rates.
- **CSV Data Portability**: Bulk-import transaction histories or export logs to CSV.
- **Flexible Auth**: Support for generic OIDC (OpenID Connect) providers, with a fallback credentials login for easy local development.

---

## Getting Started

### 1. Installation
Clone the repository, navigate to this folder, and install dependencies:
```bash
npm install --legacy-peer-deps
```

### 2. Configure Environment Variables
Create a `.env` file in the root of the project:
```env
# Absolute path to your SQLite database file
DATABASE_URL="file:/path/to/your/project/prisma/hold.db"

# NextAuth secret key for encrypting sessions
AUTH_SECRET="your-super-secret-random-key"

# Enable local credentials-based fallback login (true/false)
ALLOW_DEV_LOGIN="true"

# (Optional) OpenID Connect OIDC provider configuration
AUTH_OIDC_ISSUER="https://accounts.google.com"
AUTH_OIDC_CLIENT_ID="your-client-id"
AUTH_OIDC_CLIENT_SECRET="your-client-secret"
AUTH_OIDC_NAME="Google Account" # Name displayed on the login button
```

### 3. Initialize Database
Apply the migrations to setup your SQLite database file:
```bash
npx prisma migrate dev
```

### 4. Run the Development Server
Start Next.js locally:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

---

## Configuring OIDC (OpenID Connect)

This app supports **any generic OpenID Connect provider** (e.g., Keycloak, Auth0, Okta, Google Identity) using OpenID Discovery. 

To enable OIDC login, append the following configurations to your `.env` file:

### Example: Sign-in with Google Identity
1. Create OAuth credentials on the [Google Cloud Console](https://console.cloud.google.com/).
2. Set the redirect URI to: `http://localhost:3000/api/auth/callback/oidc`.
3. Add these variables to `.env`:
   ```env
   AUTH_OIDC_ISSUER="https://accounts.google.com"
   AUTH_OIDC_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
   AUTH_OIDC_CLIENT_SECRET="your-google-client-secret"
   AUTH_OIDC_NAME="Google Workspace"
   ```

### Example: Sign-in with Keycloak
1. Configure a Client in your Keycloak Realm (ensure Client Protocol is `openid-connect`).
2. Add these variables to `.env` (pointing to your realm issuer configuration):
   ```env
   AUTH_OIDC_ISSUER="https://<your-keycloak-domain>/realms/<realm-name>"
   AUTH_OIDC_CLIENT_ID="portfolio-manager-client"
   AUTH_OIDC_CLIENT_SECRET="your-keycloak-client-secret"
   AUTH_OIDC_NAME="Keycloak Login"
   ```

*   **OIDC Login**: Only visible if `AUTH_OIDC_ISSUER` and `AUTH_OIDC_CLIENT_ID` are configured in your `.env` file.
*   **Developer Demo Login**: Only visible if `ALLOW_DEV_LOGIN="true"` is configured in your `.env` file. Set this to `"false"` or omit it in production to completely disable credentials-based mock authentication.

---

## Running in Docker (Minimal Production Image)

This application supports minimal production packaging using multi-stage builds and Next.js standalone output. The final image size is optimized to **~130MB**.

### 1. Build the Docker Image
Execute the build helper script:
```bash
./docker-build.sh
```

### 2. Run the Container
Start the container with your `.env` configuration file loaded:
```bash
docker run -d \
  -p 3000:3000 \
  --name portfolio-manager \
  --env-file .env \
  -v /absolute/path/to/local/db-folder:/app/prisma \
  portfolio-manager:latest
```

> [!IMPORTANT]
> **SQLite Database Volume Persistence**:
> Since SQLite uses a local file, any logged transactions are written inside the container's directory `/app/data`. To prevent data loss when the container is stopped or restarted, you **must** mount a host folder to `/app/data` containing your `hold.db` database.

