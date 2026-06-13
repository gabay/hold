![Hold icon](/public/icon.png)
# 📈 Hold - Simple Portfolio Tracker

Hold lets you track your passive investment portfolio as easily as possible - log your BUY orders and let it handle the rest.

> NOTE: This project is developed using AI.

---

## 🌟 Features

- **Simple** - you log your activity, and Hold does the rest.
- **Open** - import/export all of your activity in a click to CSV format.
- **Visually appealing** - Chart for tracking performance over time.
- **Privacy mode** - hide sensitive data.
- **Multi-Currency Support** - both transactions and final overview can be done in any currency you choose. Historical rates ensure accurate valuations.
- **Stock-split aware** - Automatically adjusts holdings based on stock splits.
- **Dividends aware** - Tracks your dividend payouts.
- **Multi-user** - OIDC by default, optional demo user for first impression.

---

## 🛠️ Tech Stack

- **Frontend**: Next.js 16 (App Router, Client Components), Tailwind CSS v4, Recharts (Interactive Charts), Lucide React (Icons)
- **Backend**: Next.js Route Handlers (API Routes)
- **Database**: SQLite via Prisma ORM
- **Authentication**: NextAuth.js (v5 Beta) - Support for OIDC and Mock Developer Login
- **External APIs**: Yahoo Finance (Asset prices via `yahoo-finance2`), Frankfurter API (Exchange rates)

---

## 🏗️ Architecture & Data Flow

The following diagram illustrates how the application components interact:

```mermaid
graph TD
    User([User Browser]) -->|HTTPS| Frontend[Next.js Frontend UI]
    Frontend -->|Interacts| ClientState[React State / Recharts]
    Frontend -->|API Calls| Backend[Next.js API Routes]

    subgraph Backend Services
        Backend -->|Auth Session| NextAuth[NextAuth.js]
        Backend -->|Queries| Prisma[Prisma ORM]
        Prisma -->|Read/Write| SQLite[(SQLite Database)]

        Backend -->|Fetch Prices| FinanceLib[Finance Helper Lib]
        FinanceLib -->|Cache Lookup| SQLite
        FinanceLib -->|Live Quote / Search| YahooFinance[Yahoo Finance API]
        FinanceLib -->|Rates Lookup| Frankfurter[Frankfurter API]
    end

    NextAuth -->|OIDC| ExternalOIDC[OIDC Provider e.g. Google]
```

---

## 📁 Project Structure

```
/
├── prisma/                  # Database schema & migrations
│   ├── schema.prisma        # Prisma schema definition
│   └── migrations/          # SQLite database migrations
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── api/             # Backend API Route Handlers
│   │   │   ├── auth/        # NextAuth API configuration
│   │   │   ├── finance/     # Live stock search endpoints
│   │   │   ├── portfolio/   # Portfolio summary, history, import/export
│   │   │   └── transactions/# Individual transaction operations
│   │   ├── globals.css      # Global Styles (Tailwind v4 imports)
│   │   ├── layout.tsx       # Root layout & providers
│   │   └── page.tsx         # Dashboard main page (UI & client logic)
│   ├── components/          # Shared React components
│   │   └── Providers.tsx    # NextAuth Session Provider wrapper
│   ├── lib/                 # Business logic & utilities
│   │   ├── db.ts            # Prisma client instance
│   │   ├── finance.ts       # Yahoo Finance & Frankfurter API clients
│   │   └── portfolio.ts     # Portfolio aggregation & performance math
│   └── auth.ts              # NextAuth configuration & handlers
├── public/                  # Static assets
├── Dockerfile               # Multi-stage production build
└── package.json             # Project dependencies and scripts
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v20.x` or higher
- **Package Manager**: `pnpm` (recommended) or `npm`

### 1. Installation

Clone the repository and navigate to the root directory.

```bash
pnpm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root of the project:

```env
# Connection string for SQLite database (resolved relative to prisma/ directory)
DATABASE_URL="file:hold.db"

# NextAuth secret key for encrypting session cookies (Generate with: `openssl rand -base64 32`)
AUTH_SECRET="replace-this-message-with-64-byte-long-secret-password-right-now"

# Enable local credentials-based fallback login (set to "false" in production)
ALLOW_DEMO_LOGIN=true

# (Optional) OpenID Connect OIDC provider configuration
# AUTH_OIDC_ISSUER="https://AUTH_PROVIDER"
# AUTH_OIDC_CLIENT_ID="AUTH_PROVIDER_CLIENT_ID"
# AUTH_OIDC_CLIENT_SECRET="AUTH_PROVIDER_CLIENT_SECRET"
# AUTH_OIDC_NAME="AUTH_PROVIDER_NAME"
```

### 3. Initialize the Database

Apply migrations to setup your SQLite database file. This will automatically create the `prisma/` folder and initialize `hold.db`:

```bash
npx prisma migrate dev
```

### 4. Run the Development Server

Start the Next.js development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🐳 Running in Docker (Production)

The project includes a multi-stage Dockerfile that builds an optimized production image (~100MB).

### 1. Get the image

```bash
docker build -t hold .
```

Or

```bash
docker pull gabay/hold
```

### 2. Run the Container (with Persistence)

To prevent data loss when the container restarts, mount a host directory to `/app/data` where the SQLite database file (`hold.db`) is stored:

```bash
docker run -d \
  -p 3000:3000 \
  --name hold \
  --env-file .env \
  -v /absolute/path/to/local/db-folder:/app/data \
  hold:latest
```

> [!IMPORTANT]
> **Database Host Directory Permissions**:
> The container runs as a non-root user (`node`, UID `1000`). Ensure your host directory `/absolute/path/to/local/db-folder` is writeable by UID `1000` or has appropriate read/write permissions.

> [!NOTE]
> **Automatic Database Initialization**:
> If the mounted host directory is empty on first startup, the container's entrypoint script will automatically copy a pre-migrated template database (`hold.db`) into it. Subsequent starts will preserve and use your existing data.

---

## 🗃️ CSV Import Format

You can import transaction history in bulk via a CSV file. The CSV file must contain a header row.

| Column            | Required | Description                                                           | Example Values             |
| :---------------- | :------: | :-------------------------------------------------------------------- | :------------------------- |
| `symbol`          | **Yes**  | Stock ticker symbol compatible with Yahoo Finance                     | `AAPL`, `VOO`, `CSPX.L`    |
| `type`            | **Yes**  | Transaction type (case-insensitive)                                   | `BUY`, `SELL`              |
| `quantity`        | **Yes**  | Number of shares transacted (float)                                   | `10`, `2.5`                |
| `pricePerShare`   | **Yes**  | Price per share in the transaction currency (float). _Alias: `price`_ | `175.50`, `94.20`          |
| `currency`        |    No    | Currency of the transaction. Default to ticker symbol                 | `USD`, `EUR`, `GBP`        |
| `transactionDate` |    No    | Date of the transaction. Defaults to today. _Alias: `date`_           | `2023-10-25`, `2024-01-12` |

### Example CSV Content

```csv
symbol,type,quantity,pricePerShare,currency,transactionDate
AAPL,BUY,10,175.50,USD,2026-01-01
VOO,SELL,2,220.00,USD,2026-01-02
CSPX.L,BUY,5,102.30,EUR,2026-01-03
```

---

## 🔐 Configuring OIDC (OpenID Connect)

The application supports standard OIDC providers (e.g., Google Identity, Keycloak, Auth0, Okta).
OIDC is configured through the environment variables.

### Example: Google Identity Setup

1. Create OAuth 2.0 Credentials on the [Google Cloud Console](https://console.cloud.google.com/).
2. Set the Authorized Redirect URI to: `http://localhost:3000/api/auth/callback/oidc`.
3. Configure these variables in `.env`:
    ```env
    AUTH_OIDC_ISSUER="https://accounts.google.com"
    AUTH_OIDC_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
    AUTH_OIDC_CLIENT_SECRET="your-google-client-secret"
    AUTH_OIDC_NAME="Google Account"
    ```

### Example: authentik Identity Setup

1. Create OAuth 2.0 Provider in the authentik admin interface.
2. Set the Authorized Redirect URI to: `http://localhost:3000/api/auth/callback/oidc` (or your hold instance's URL).
3. Configure these variables in `.env`:
    ```env
    AUTH_OIDC_ISSUER="https://AUTHENTIK_DOMAIN"
    AUTH_OIDC_CLIENT_ID="AUTHENTIK_CLIENT_ID"
    AUTH_OIDC_CLIENT_SECRET="AUTHENTIK_CLIENT_SECRET"
    AUTH_OIDC_NAME="authentik"
    ```

---

## 🔧 Useful Development Commands

- **Run Linter**: `npm run lint` or `pnpm lint`
- **Open Database Studio**: `npx prisma studio` (Visual explorer for your SQLite database)
- **Generate Prisma Client**: `npx prisma generate` (Run this after making changes to `schema.prisma`)
- **Create a Database Migration**: `npx prisma migrate dev --name <migration_name>`

---
