import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from "path";

export default defineConfig({
    root: path.join(__dirname, 'src'),
    build: {
        outDir: path.join(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: path.join(__dirname, 'src/mainConfig.html')
        }
    },
    plugins: [react()],
    server: {
        port: 3000
    }
})


