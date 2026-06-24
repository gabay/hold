import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "./Dashboard";

// Mock child components to avoid DOM complexity
vi.mock("./Chart", () => ({
    default: () => <div data-testid="chart">Chart Component</div>,
}));

vi.mock("./HoldingsTable", () => ({
    default: () => <div data-testid="holdings-table">HoldingsTable Component</div>,
}));

vi.mock("./TransactionsTable", () => ({
    default: () => <div data-testid="transactions-table">TransactionsTable Component</div>,
}));

vi.mock("./TransactionModal", () => ({
    default: () => <div data-testid="transaction-modal">TransactionModal Component</div>,
}));

vi.mock("./CurrencySearchBox", () => ({
    default: () => <div data-testid="currency-search">CurrencySearchBox Component</div>,
}));

vi.mock("next-auth/react", async () => {
    const actual = await vi.importActual("next-auth/react");
    return {
        ...actual,
        signOut: vi.fn(),
    };
});

describe("Dashboard", () => {
    const mockUser = {
        name: "Test User",
        email: "test@example.com",
    };

    beforeEach(() => {
        // Mock localStorage
        const localStorageMock = {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            length: 0,
            key: vi.fn(),
        };
        global.localStorage = localStorageMock;

        // Mock fetch
        global.fetch = vi.fn();
    });

    it("renders without crashing with valid user", async () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => [{ id: "1", name: "Test Portfolio" }],
        } as Response);

        render(<Dashboard user={mockUser} />);

        expect(screen.getByText("Hold")).toBeInTheDocument();
    });

    it("renders header with user info", () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => [{ id: "1", name: "Test Portfolio" }],
        } as Response);

        render(<Dashboard user={mockUser} />);

        expect(screen.getByText("Test User")).toBeInTheDocument();
        expect(screen.getByText("test@example.com")).toBeInTheDocument();
    });

    it("renders main child components", async () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => [{ id: "1", name: "Test Portfolio" }],
        } as Response);

        render(<Dashboard user={mockUser} />);

        await waitFor(() => {
            expect(screen.getByTestId("chart")).toBeInTheDocument();
            expect(screen.getByTestId("holdings-table")).toBeInTheDocument();
            expect(screen.getByTestId("transactions-table")).toBeInTheDocument();
        });
    });

    it("fetches portfolio data on mount", async () => {
        const fetchSpy = vi.mocked(global.fetch);
        fetchSpy.mockResolvedValue({
            ok: true,
            json: async () => [{ id: "1", name: "Test Portfolio" }],
        } as Response);

        render(<Dashboard user={mockUser} />);

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledWith("/api/portfolio");
        });
    });

    it("displays error message on failed portfolio fetch", async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: "Failed" }),
        } as Response);

        render(<Dashboard user={mockUser} />);

        await waitFor(() => {
            expect(screen.getByText("Failed to load portfolio")).toBeInTheDocument();
        });
    });

    it("has logout button in header", () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => [{ id: "1", name: "Test Portfolio" }],
        } as Response);

        render(<Dashboard user={mockUser} />);

        const logoutButton = screen.getByRole("button", { name: "Logout" });
        expect(logoutButton).toBeInTheDocument();
    });

    it("has privacy toggle button in header", () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: true,
            json: async () => [{ id: "1", name: "Test Portfolio" }],
        } as Response);

        render(<Dashboard user={mockUser} />);

        const privacyButton = screen.getByRole("button", {
            name: "Hide Balances",
        });
        expect(privacyButton).toBeInTheDocument();
    });
});
