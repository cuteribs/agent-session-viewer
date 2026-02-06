import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    outDir: '../dist/server',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    external: ['open'],
    clean: true,
    bundle: true,
    sourcemap: true,
    noExternal: ['shared'], // Inline the shared package
    dts: false,
    banner: {
        js: '#!/usr/bin/env node',
    },
});
