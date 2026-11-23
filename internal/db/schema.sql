CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    email      TEXT UNIQUE,
    image      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS portfolios (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id               TEXT PRIMARY KEY,
    portfolio_id     TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    symbol           TEXT NOT NULL,
    type             TEXT NOT NULL CHECK(type IN ('BUY', 'SELL')),
    quantity         REAL NOT NULL,
    price_per_share  REAL NOT NULL,
    currency         TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_prices (
    symbol   TEXT NOT NULL,
    date     TEXT NOT NULL,
    price    REAL NOT NULL,
    dividend REAL,
    split    REAL,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS exchange_rates (
    base_currency   TEXT NOT NULL,
    target_currency TEXT NOT NULL,
    date            TEXT NOT NULL,
    rate            REAL NOT NULL,
    PRIMARY KEY (base_currency, target_currency, date)
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_date ON transactions(portfolio_id, transaction_date);
