import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    clean: true,
    bundle: true,
    sourcemap: true,
    noExternal: ['shared'], // Inline the shared package
    dts: false,
    outDir: 'dist',
    banner: {
        js: '#!/usr/bin/env node',
    },
});
