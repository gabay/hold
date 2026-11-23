export interface User {
    id: string;
    name: string;
    email: string;
    image?: string;
}

export interface AuthProviderInfo {
    id: string;
    name: string;
}

export interface AuthProviders {
    oidc?: AuthProviderInfo;
    credentials?: AuthProviderInfo;
}

export interface PortfolioRef {
    id: string;
    name: string;
    userId?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface Transaction {
    id: string;
    portfolioId: string;
    symbol: string;
    type: string;
    quantity: number;
    pricePerShare: number;
    currency: string;
    transactionDate: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ChartDataPoint {
    date: string;
    valuation: number;
    invested: number;
    realized: number;
}

export interface AssetData {
    symbol: string;
    currency: string;
    quantity: number;
    avgBuyPrice: number;
    currentPrice: number;
    cost: number;
    value: number;
    realized: number;
    profit: number;
    profitPercentage: number;
    history: ChartDataPoint[];
}

export interface PortfolioSummary {
    currency: string;
    totalCost: number;
    totalValue: number;
    totalRealized: number;
    totalProfit: number;
    totalProfitPercentage: number;
    assets: AssetData[];
}

export interface PortfolioData {
    portfolioId: string;
    name: string;
    summary: PortfolioSummary;
    transactions: Transaction[];
    history: ChartDataPoint[];
}

export interface SearchAssetResult {
    symbol: string;
    name: string;
    type: string;
}
