#!/usr/bin/env node

/**
 * Sets the product name in package.json based on environment variables
 * Used during build to support different app names (Bob vs Jeff)
 */

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Get app name from environment or config
const jeffMode = process.env.JEFF_MODE === 'true';
const appName = jeffMode ? 'Jeff' : (process.env.APP_NAME || 'Bob');

// Update product name in build config
if (packageJson.build) {
  packageJson.build.productName = appName;
  console.log(`Setting product name to: ${appName}`);

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log('Product name updated successfully');
} else {
  console.error('No build configuration found in package.json');
  process.exit(1);
}
