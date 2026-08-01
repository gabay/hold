-- CreateTable
CREATE TABLE "StockPrice" (
    "symbol" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "price" REAL NOT NULL,
    "dividend" REAL,
    "split" REAL,

    PRIMARY KEY ("symbol", "date")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "baseCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "rate" REAL NOT NULL,

    PRIMARY KEY ("baseCurrency", "targetCurrency", "date")
);
