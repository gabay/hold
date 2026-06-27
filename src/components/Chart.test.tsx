import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Chart from "./Chart";
import { ChartDataPoint } from "@/lib/portfolio";

describe("Chart", () => {
    const mockData: ChartDataPoint[] = [
        { date: "2024-01-01", valuation: 1000, invested: 900, realized: 0 },
        { date: "2024-01-02", valuation: 1100, invested: 900, realized: 0 },
        { date: "2024-01-03", valuation: 1050, invested: 900, realized: 0 },
    ];

    const mockProps = {
        data: mockData,
        loading: false,
        privacyMode: false,
        timeRange: "30",
        onTimeRangeChange: vi.fn(),
        formatOrHideCurrency: (val: number) => `$${val.toFixed(2)}`,
    };

    it("renders without crashing", () => {
        render(<Chart {...mockProps} />);
        expect(screen.getByText("Portfolio Valuation")).toBeInTheDocument();
    });

    it("shows loading state", () => {
        render(<Chart {...mockProps} loading={true} />);
        expect(screen.getByRole("status", { hidden: true })).toBeInTheDocument();
    });

    it("shows empty state when no data", () => {
        render(<Chart {...mockProps} data={[]} />);
        expect(
            screen.getByText("Add transactions to start generating charts."),
        ).toBeInTheDocument();
    });

    it("calls onTimeRangeChange when time range button clicked", () => {
        const onChange = vi.fn();
        render(<Chart {...mockProps} onTimeRangeChange={onChange} />);

        const ytdButton = screen.getByRole("button", { name: "YTD" });
        fireEvent.click(ytdButton);

        expect(onChange).toHaveBeenCalledWith("ytd");
    });

    it("highlights active time range", () => {
        render(<Chart {...mockProps} timeRange="365" />);
        const oneYearButton = screen.getByRole("button", { name: "1Y" });
        expect(oneYearButton).toHaveClass("bg-sky-600");
    });

    it("renders all time range buttons", () => {
        render(<Chart {...mockProps} />);
        expect(screen.getByRole("button", { name: "1M" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "YTD" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "1Y" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "5Y" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "MAX" })).toBeInTheDocument();
    });
});
