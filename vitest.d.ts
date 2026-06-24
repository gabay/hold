/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

declare global {
    namespace Vi {
        interface Matchers<R> {
            toBeInTheDocument(): R;
            toHaveClass(className: string): R;
        }
    }
}
