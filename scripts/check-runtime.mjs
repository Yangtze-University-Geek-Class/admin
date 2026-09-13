#!/usr/bin/env node
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 13) {
  console.error(`Expected Node 22 >=22.13; received ${process.version}. Use the version in .nvmrc and reinstall native dependencies after changing Node.`);
  process.exitCode = 1;
} else console.log(`Runtime baseline passed: ${process.version}`);
