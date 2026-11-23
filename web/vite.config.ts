import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-oxc";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        {
            name: "preserve-gitkeep",
            closeBundle() {
                fs.writeFileSync(path.resolve(import.meta.dirname, "dist/.gitkeep"), "");
            },
        },
    ],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "./src"),
        },
    },
    server: {
        proxy: {
            "/api": {
                target: "http://localhost:3000",
                changeOrigin: true,
            },
        },
    },
});
