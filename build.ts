import { execSync } from 'node:child_process'
import { rmSync, cpSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })

execSync('npm run build -w client', { stdio: 'inherit' })
execSync('npm run build -w server', { stdio: 'inherit' })

cpSync('packages/server/dist', 'dist', { recursive: true })
cpSync('packages/client/dist', 'dist/public', { recursive: true })