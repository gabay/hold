import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TransactionsTable from "./TransactionsTable";
import { Transaction } from "@prisma/client";

describe("TransactionsTable", () => {
    const mockTransactions: Transaction[] = [
        {
            id: "1",
            symbol: "AAPL",
            type: "BUY",
            quantity: 10,
            pricePerShare: 150,
            currency: "USD",
            transactionDate: new Date("2024-01-01"),
            portfolioId: "p1",
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        {
            id: "2",
            symbol: "GOOGL",
            type: "SELL",
            quantity: 5,
            pricePerShare: 140,
            currency: "USD",
            transactionDate: new Date("2024-01-02"),
            portfolioId: "p1",
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    ];

    const mockProps = {
        transactions: mockTransactions,
        loading: false,
        hideInPrivacyMode: (val: string | number) => val.toString(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
    };

    it("renders without crashing", () => {
        render(<TransactionsTable {...mockProps} />);
        expect(screen.getByText("Activity History")).toBeInTheDocument();
    });

    it("shows loading skeleton when loading", () => {
        render(<TransactionsTable {...mockProps} loading={true} />);
        const skeletons = document.querySelectorAll(".animate-pulse");
        expect(skeletons.length).toBeGreaterThan(0);
    });

    it("shows empty state when no transactions", () => {
        render(<TransactionsTable {...mockProps} transactions={[]} />);
        expect(
            screen.getByText("No transactions logged yet. Use the quick actions panel to log one!"),
        ).toBeInTheDocument();
    });

    it("renders transaction symbols", () => {
        render(<TransactionsTable {...mockProps} />);
        expect(screen.getByText("AAPL")).toBeInTheDocument();
        expect(screen.getByText("GOOGL")).toBeInTheDocument();
    });

    it("shows BUY badge with correct styling", () => {
        render(<TransactionsTable {...mockProps} />);
        const buyBadge = screen.getByText("BUY");
        expect(buyBadge).toHaveClass("bg-emerald-950");
        expect(buyBadge).toHaveClass("text-emerald-400");
    });

    it("shows SELL badge with correct styling", () => {
        render(<TransactionsTable {...mockProps} />);
        const sellBadge = screen.getByText("SELL");
        expect(sellBadge).toHaveClass("bg-rose-950");
        expect(sellBadge).toHaveClass("text-rose-400");
    });

    it("calls onEdit when Edit button clicked", () => {
        const onEdit = vi.fn();
        render(<TransactionsTable {...mockProps} onEdit={onEdit} />);

        const editButtons = screen.getAllByRole("button", { name: "Edit" });
        fireEvent.click(editButtons[0]);

        expect(onEdit).toHaveBeenCalledWith(mockTransactions[0]);
    });

    it("calls onDelete when Delete button clicked", () => {
        const onDelete = vi.fn();
        render(<TransactionsTable {...mockProps} onDelete={onDelete} />);

        const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
        fireEvent.click(deleteButtons[0]);

        expect(onDelete).toHaveBeenCalledWith("1");
    });

    it("applies privacy mode to values", () => {
        const hideValue = (_val: string | number) => "••••••";
        render(<TransactionsTable {...mockProps} hideInPrivacyMode={hideValue} />);
        const cells = screen.getAllByText("••••••");
        expect(cells.length).toBeGreaterThan(0);
    });

    it("renders all table column headers", () => {
        render(<TransactionsTable {...mockProps} />);
        expect(screen.getByText("Date")).toBeInTheDocument();
        expect(screen.getByText("Symbol")).toBeInTheDocument();
        expect(screen.getByText("Action")).toBeInTheDocument();
        expect(screen.getByText("Shares")).toBeInTheDocument();
        expect(screen.getByText("Price")).toBeInTheDocument();
        expect(screen.getByText("Total")).toBeInTheDocument();
    });
});
