import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmModal from "./ConfirmModal";

describe("ConfirmModal", () => {
    it("renders title and message when open", () => {
        render(
            <ConfirmModal
                isOpen={true}
                title="Delete Portfolio"
                message="Are you sure?"
                confirmLabel="Delete"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.getByText("Delete Portfolio")).toBeInTheDocument();
        expect(screen.getByText("Are you sure?")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("does not render when closed", () => {
        render(
            <ConfirmModal
                isOpen={false}
                title="Delete Portfolio"
                message="Are you sure?"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.queryByText("Delete Portfolio")).not.toBeInTheDocument();
    });

    it("calls onConfirm and onCancel appropriately", () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();

        render(
            <ConfirmModal
                isOpen={true}
                title="Confirm Action"
                message="Proceed?"
                confirmLabel="Yes"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Yes" }));
        expect(onConfirm).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
