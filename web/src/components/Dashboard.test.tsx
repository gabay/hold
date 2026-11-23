import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Dashboard from "./Dashboard";

const mockLogout = vi.fn();

vi.mock("@/auth/AuthContext", () => ({
    useAuth: () => ({
        logout: mockLogout,
    }),
}));

vi.mock("./Chart", () => ({
    default: ({
        onTimeRangeChange,
        title,
        onClearSymbolFilter,
    }: {
        onTimeRangeChange: (r: string) => void;
        title?: string;
        onClearSymbolFilter?: () => void;
    }) => (
        <div data-testid="chart">
            <span>{title ? `${title} Chart` : "Chart Component"}</span>
            <button type="button" onClick={() => onTimeRangeChange("365")}>
                Set 1Y
            </button>
            {onClearSymbolFilter && (
                <button type="button" onClick={onClearSymbolFilter}>
                    Clear Chart Filter
                </button>
            )}
        </div>
    ),
}));

vi.mock("./HoldingsTable", () => ({
    default: ({ onSelectSymbol }: { onSelectSymbol?: (s: string) => void }) => (
        <div data-testid="holdings-table">
            <button type="button" onClick={() => onSelectSymbol?.("AAPL")}>
                Select AAPL
            </button>
        </div>
    ),
}));

vi.mock("./TransactionsTable", () => ({
    default: ({
        onDelete,
        selectedSymbol,
    }: {
        onDelete: (id: string) => void;
        selectedSymbol?: string | null;
    }) => (
        <div data-testid="transactions-table">
            <span>{selectedSymbol ? `Filtered:${selectedSymbol}` : "AllTransactions"}</span>
            <button type="button" onClick={() => onDelete("tx-1")}>
                Delete tx-1
            </button>
        </div>
    ),
}));

vi.mock("./CurrencySearchBox", () => ({
    default: () => <div data-testid="currency-search">CurrencySearchBox Component</div>,
}));

const samplePortfolioData = {
    portfolioId: "1",
    name: "Test Portfolio",
    summary: {
        currency: "USD",
        totalCost: 1000,
        totalValue: 1200,
        totalRealized: 0,
        totalProfit: 200,
        totalProfitPercentage: 20,
        assets: [],
    },
    transactions: [],
    history: [],
};

describe("Dashboard", () => {
    const mockUser = {
        id: "u1",
        name: "Test User",
        email: "test@example.com",
    };

    let storage: Record<string, string>;

    beforeEach(() => {
        vi.clearAllMocks();
        storage = {};
        const localStorageMock = {
            getItem: vi.fn((k: string) => storage[k] ?? null),
            setItem: vi.fn((k: string, v: string) => {
                storage[k] = v;
            }),
            removeItem: vi.fn((k: string) => {
                delete storage[k];
            }),
            clear: vi.fn(() => {
                storage = {};
            }),
            length: 0,
            key: vi.fn(),
        };
        globalThis.localStorage = localStorageMock;
        globalThis.fetch = vi.fn();
    });

    const mockSuccessfulFetch = (portfolios = [{ id: "1", name: "Test Portfolio" }]) => {
        vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url === "/api/portfolio") {
                return { ok: true, json: async () => portfolios } as Response;
            }
            if (url.includes("/data")) {
                return { ok: true, json: async () => samplePortfolioData } as Response;
            }
            return { ok: true, json: async () => ({ success: true }) } as Response;
        });
    };

    it("renders without crashing with valid user", async () => {
        mockSuccessfulFetch();
        render(<Dashboard user={mockUser} />);
        expect(await screen.findByText("Hold")).toBeInTheDocument();
    });

    it("renders header with user info", async () => {
        mockSuccessfulFetch();
        render(<Dashboard user={mockUser} />);
        expect(await screen.findByText("Test User")).toBeInTheDocument();
        expect(screen.getByText("test@example.com")).toBeInTheDocument();
    });

    it("renders main child components", async () => {
        mockSuccessfulFetch();
        render(<Dashboard user={mockUser} />);

        await waitFor(() => {
            expect(screen.getByTestId("chart")).toBeInTheDocument();
            expect(screen.getByTestId("holdings-table")).toBeInTheDocument();
            expect(screen.getByTestId("transactions-table")).toBeInTheDocument();
        });
    });

    it("validates saved hold_portfolioId and falls back to first portfolio when stale", async () => {
        storage["hold_portfolioId"] = "stale-id";
        mockSuccessfulFetch([{ id: "real-1", name: "Primary" }]);

        render(<Dashboard user={mockUser} />);

        await waitFor(() => {
            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith(
                "hold_portfolioId",
                "real-1",
            );
        });
    });

    it("saves timeRange using hold_timeRange key", async () => {
        mockSuccessfulFetch();
        render(<Dashboard user={mockUser} />);

        const btn = await screen.findByRole("button", { name: "Set 1Y" });
        fireEvent.click(btn);

        expect(globalThis.localStorage.setItem).toHaveBeenCalledWith("hold_timeRange", "365");
    });

    it("displays dismissible error message on failed portfolio fetch", async () => {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: "Failed" }),
        } as Response);

        render(<Dashboard user={mockUser} />);

        const errorText = await screen.findByText("Failed to load portfolio");
        expect(errorText).toBeInTheDocument();

        const dismissBtn = screen.getByRole("button", { name: "Dismiss error" });
        fireEvent.click(dismissBtn);
        expect(screen.queryByText("Failed to load portfolio")).not.toBeInTheDocument();
    });

    it("opens themed ConfirmModal when deleting a transaction", async () => {
        mockSuccessfulFetch();
        render(<Dashboard user={mockUser} />);

        const deleteBtn = await screen.findByRole("button", { name: "Delete tx-1" });
        fireEvent.click(deleteBtn);

        expect(await screen.findByText("Delete Transaction")).toBeInTheDocument();
        expect(
            screen.getByText("Are you sure you want to delete this transaction?"),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        await waitFor(() => {
            expect(globalThis.fetch).toHaveBeenCalledWith(
                "/api/portfolio/1/transactions/tx-1",
                expect.objectContaining({ method: "DELETE" }),
            );
        });
    });

    it("has logout and privacy toggle buttons in header", async () => {
        mockSuccessfulFetch();
        render(<Dashboard user={mockUser} />);

        expect(await screen.findByRole("button", { name: "Logout" })).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "Hide Balances" })).toBeInTheDocument();
    });
});
