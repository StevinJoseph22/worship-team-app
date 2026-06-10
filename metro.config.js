const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Add .cjs to source extensions to support modern Firebase JS SDK bundling
config.resolver.sourceExts.push("cjs");

// Disable package exports to bypass Metro resolution incompatibility with modular Firebase
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
