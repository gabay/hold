import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HoldingsTable from "./HoldingsTable";
import { PortfolioSummary } from "@/lib/portfolio";

describe("HoldingsTable", () => {
    const mockSummary: PortfolioSummary = {
        currency: "USD",
        totalCost: 1000,
        totalValue: 1200,
        totalRealized: 50,
        totalProfit: 250,
        totalProfitPercentage: 25,
        assets: [
            {
                symbol: "AAPL",
                currency: "USD",
                quantity: 10,
                avgBuyPrice: 100,
                currentPrice: 120,
                cost: 1000,
                value: 1200,
                realized: 50,
                profit: 250,
                profitPercentage: 25,
                history: [],
            },
        ],
    };

    const mockProps = {
        summary: mockSummary,
        loading: false,
        displayCurrency: "USD",
        hideInPrivacyMode: (val: string | number) => val.toString(),
    };

    it("renders without crashing", () => {
        render(<HoldingsTable {...mockProps} />);
        expect(screen.getByText("Current Holdings")).toBeInTheDocument();
    });

    it("shows loading skeleton when loading", () => {
        render(<HoldingsTable {...mockProps} loading={true} />);
        const skeletons = document.querySelectorAll(".animate-pulse");
        expect(skeletons.length).toBeGreaterThan(0);
    });

    it("shows empty state when no summary", () => {
        render(<HoldingsTable {...mockProps} summary={null} />);
        expect(
            screen.getByText("No active holdings found. Go ahead and log your first transaction!"),
        ).toBeInTheDocument();
    });

    it("shows empty state when no assets", () => {
        render(<HoldingsTable {...mockProps} summary={{ ...mockSummary, assets: [] }} />);
        expect(
            screen.getByText("No active holdings found. Go ahead and log your first transaction!"),
        ).toBeInTheDocument();
    });

    it("renders asset data in table", () => {
        render(<HoldingsTable {...mockProps} />);
        expect(screen.getByText("AAPL")).toBeInTheDocument();
        expect(screen.getByText("USD")).toBeInTheDocument();
    });

    it("applies privacy mode to values", () => {
        const hideValue = (_val: string | number) => "••••••";
        render(<HoldingsTable {...mockProps} hideInPrivacyMode={hideValue} />);
        // Value should be hidden by privacy function
        const cells = screen.getAllByText("••••••");
        expect(cells.length).toBeGreaterThan(0);
    });

    it("shows profit in green", () => {
        render(<HoldingsTable {...mockProps} />);
        const profitCell = screen.getByText("$250.00").closest("td");
        expect(profitCell).toHaveClass("text-emerald-400");
    });
    it("shows loss in red", () => {
        mockProps.summary.assets[0].profit = -250;
        render(<HoldingsTable {...mockProps} />);
        const profitCell = screen.getByText("-$250.00").closest("td");
        expect(profitCell).toHaveClass("text-rose-400");
    });
});
