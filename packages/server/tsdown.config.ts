import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts'],
    outDir: './dist',
    format: ['esm'],
    platform: 'node',
    fixedExtension: false,
    target: 'node20',
    clean: true,
    unbundle: false,
    sourcemap: false,
    dts: false,
    deps: {
        neverBundle: ['open', 'better-sqlite3'],
        alwaysBundle: ['shared'],
    },
    banner: {
        js: '#!/usr/bin/env node',
    },
});
