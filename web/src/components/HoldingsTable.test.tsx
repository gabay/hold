import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HoldingsTable from "./HoldingsTable";
import { PortfolioSummary } from "@/types";

describe("HoldingsTable", () => {
    const makeSummary = (): PortfolioSummary => ({
        currency: "USD",
        totalCost: 2000,
        totalValue: 2500,
        totalRealized: 50,
        totalProfit: 550,
        totalProfitPercentage: 27.5,
        assets: [
            {
                symbol: "MSFT",
                currency: "USD",
                quantity: 5,
                avgBuyPrice: 200,
                currentPrice: 260,
                cost: 1000,
                value: 1300,
                realized: 0,
                profit: 300,
                profitPercentage: 30,
                history: [],
            },
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
            {
                symbol: "CLOSED",
                currency: "USD",
                quantity: 0,
                avgBuyPrice: 50,
                currentPrice: 55,
                cost: 0,
                value: 0,
                realized: 100,
                profit: 100,
                profitPercentage: 0,
                history: [],
            },
        ],
    });

    const baseProps = () => ({
        summary: makeSummary(),
        loading: false,
        displayCurrency: "USD",
        hideInPrivacyMode: (val: string | number) => val.toString(),
    });

    it("renders without crashing", () => {
        render(<HoldingsTable {...baseProps()} />);
        expect(screen.getByText("Current Holdings")).toBeInTheDocument();
    });

    it("shows loading skeleton when loading", () => {
        render(<HoldingsTable {...baseProps()} loading={true} />);
        const skeletons = document.querySelectorAll(".animate-pulse");
        expect(skeletons.length).toBeGreaterThan(0);
    });

    it("shows empty state when no summary", () => {
        render(<HoldingsTable {...baseProps()} summary={null} />);
        expect(
            screen.getByText("No active holdings found. Go ahead and log your first transaction!"),
        ).toBeInTheDocument();
    });

    it("shows empty state when no assets", () => {
        const summary = { ...makeSummary(), assets: [] };
        render(<HoldingsTable {...baseProps()} summary={summary} />);
        expect(
            screen.getByText("No active holdings found. Go ahead and log your first transaction!"),
        ).toBeInTheDocument();
    });

    it("renders asset data in table", () => {
        render(<HoldingsTable {...baseProps()} />);
        expect(screen.getByText("AAPL")).toBeInTheDocument();
        expect(screen.getAllByText("USD").length).toBeGreaterThan(0);
    });

    it("applies privacy mode to values", () => {
        const hideValue = () => "••••••";
        render(<HoldingsTable {...baseProps()} hideInPrivacyMode={hideValue} />);
        const cells = screen.getAllByText("••••••");
        expect(cells.length).toBeGreaterThan(0);
    });

    it("shows profit in green", () => {
        render(<HoldingsTable {...baseProps()} />);
        const profitCell = screen.getByText("$250.00").closest("td");
        expect(profitCell).toHaveClass("text-emerald-400");
    });

    it("shows loss in red", () => {
        const summary = makeSummary();
        summary.assets[1].profit = -250;
        render(<HoldingsTable {...baseProps()} summary={summary} />);
        const profitCell = screen.getByText("-$250.00").closest("td");
        expect(profitCell).toHaveClass("text-rose-400");
    });

    it("sorts rows when clicking column headers", () => {
        render(<HoldingsTable {...baseProps()} />);

        // Click Symbol header -> sorts ascending: AAPL, CLOSED, MSFT
        fireEvent.click(screen.getByRole("button", { name: "Symbol" }));
        const rowsAsc = screen.getAllByRole("row").slice(1);
        expect(rowsAsc[0]).toHaveTextContent("AAPL");
        expect(rowsAsc[1]).toHaveTextContent("CLOSED");
        expect(rowsAsc[2]).toHaveTextContent("MSFT");

        // Click Symbol header again -> sorts descending: MSFT, CLOSED, AAPL
        fireEvent.click(screen.getByRole("button", { name: "Symbol" }));
        const rowsDesc = screen.getAllByRole("row").slice(1);
        expect(rowsDesc[0]).toHaveTextContent("MSFT");
        expect(rowsDesc[2]).toHaveTextContent("AAPL");

        // Click % sort button -> sorts by profitPercentage descending: MSFT (30%), AAPL (25%), CLOSED (0%)
        fireEvent.click(screen.getByRole("button", { name: "%" }));
        const rowsPct = screen.getAllByRole("row").slice(1);
        expect(rowsPct[0]).toHaveTextContent("MSFT");
        expect(rowsPct[1]).toHaveTextContent("AAPL");
        expect(rowsPct[2]).toHaveTextContent("CLOSED");
    });

    it("hides closed positions when toggle is checked", () => {
        render(<HoldingsTable {...baseProps()} />);
        expect(screen.getByText("CLOSED")).toBeInTheDocument();

        const checkbox = screen.getByLabelText("Hide closed positions");
        fireEvent.click(checkbox);

        expect(screen.queryByText("CLOSED")).not.toBeInTheDocument();
        expect(screen.getByText("AAPL")).toBeInTheDocument();
        expect(screen.getByText("MSFT")).toBeInTheDocument();
    });

    it("calls onSelectSymbol when row is clicked", () => {
        const onSelect = vi.fn();
        render(<HoldingsTable {...baseProps()} onSelectSymbol={onSelect} />);
        fireEvent.click(screen.getByText("AAPL"));
        expect(onSelect).toHaveBeenCalledWith("AAPL");
    });
});
