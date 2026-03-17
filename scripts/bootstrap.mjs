#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const rootDir = process.cwd();

console.log('🚀 Bootstrapping kilocode workspace...');

// Check if we're in the right directory
if (!existsSync(join(rootDir, 'package.json'))) {
  console.error('❌ Error: package.json not found. Are you in the root directory?');
  process.exit(1);
}

// Check if pnpm-workspace.yaml exists
if (!existsSync(join(rootDir, 'pnpm-workspace.yaml'))) {
  console.error('❌ Error: pnpm-workspace.yaml not found.');
  process.exit(1);
}

try {
  // Skip bootstrap if we're already in an install process
  if (process.env.npm_config_user_agent?.includes('pnpm') && process.env.npm_lifecycle_event === 'preinstall') {
    console.log('📦 Skipping bootstrap during preinstall hook...');
    process.exit(0);
  }
  
  // Install dependencies for all workspace packages (without triggering preinstall hooks)
  console.log('📦 Installing dependencies...');
  execSync('pnpm install --frozen-lockfile --ignore-scripts', { stdio: 'inherit', cwd: rootDir });
  
  console.log('✅ Bootstrap completed successfully!');
} catch (error) {
  console.error('❌ Bootstrap failed:', error.message);
  process.exit(1);
}
