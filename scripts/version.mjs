#!/usr/bin/env node
// Release helpers. The app version lives in three files that must agree:
// src-tauri/tauri.conf.json, src-tauri/Cargo.toml and package.json.
//
//   node scripts/version.mjs set 0.2.0     update all three (and lockfiles)
//   node scripts/version.mjs check v0.2.0  fail unless the tag matches them
//   node scripts/version.mjs notes 0.2.0   print that version's CHANGELOG section
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = (p) => join(root, p);
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Version of the app's own crate (the [package] section, not dependencies). */
function cargoVersion() {
  const match = /^\[package\][\s\S]*?^version = "([^"]+)"/m.exec(
    readFileSync(path("src-tauri/Cargo.toml"), "utf8"),
  );
  return match?.[1];
}

function currentVersions() {
  return {
    "src-tauri/tauri.conf.json": JSON.parse(readFileSync(path("src-tauri/tauri.conf.json"), "utf8")).version,
    "src-tauri/Cargo.toml": cargoVersion(),
    "package.json": JSON.parse(readFileSync(path("package.json"), "utf8")).version,
  };
}

function setVersion(version) {
  if (!SEMVER.test(version ?? "")) fail(`"${version}" is not a version like 1.2.3`);

  for (const file of ["src-tauri/tauri.conf.json", "package.json"]) {
    const text = readFileSync(path(file), "utf8");
    // Replace only the top-level "version" so formatting stays untouched.
    writeFileSync(path(file), text.replace(/^(  "version": )"[^"]+"/m, `$1"${version}"`));
  }
  const cargo = readFileSync(path("src-tauri/Cargo.toml"), "utf8");
  writeFileSync(
    path("src-tauri/Cargo.toml"),
    cargo.replace(/(^\[package\][\s\S]*?^version = )"[^"]+"/m, `$1"${version}"`),
  );

  // Keep lockfiles in sync so CI's `npm ci` and Cargo see the new version.
  execSync("npm install --package-lock-only --silent", { cwd: root, stdio: "inherit" });
  execSync("cargo update --workspace --offline", { cwd: root, stdio: "inherit" });

  const versions = currentVersions();
  for (const [file, v] of Object.entries(versions)) console.log(`${file.padEnd(28)} ${v}`);
  if (Object.values(versions).some((v) => v !== version)) fail("not every file was updated");
  console.log(`\nNext: add a "## [${version}]" section to CHANGELOG.md, commit, then:`);
  console.log(`  git tag v${version} && git push origin v${version}`);
}

function checkTag(tag) {
  const version = (tag ?? "").replace(/^v/, "");
  const versions = currentVersions();
  const mismatched = Object.entries(versions).filter(([, v]) => v !== version);
  if (mismatched.length > 0) {
    fail(
      `tag ${tag} does not match:\n` +
        mismatched.map(([file, v]) => `  ${file}: ${v}`).join("\n") +
        `\nRun "npm run set-version ${version}" and commit before tagging.`,
    );
  }
  console.log(`tag ${tag} matches the app version ${version}`);
}

function releaseNotes(version) {
  const changelog = readFileSync(path("CHANGELOG.md"), "utf8");
  const start = changelog.search(new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m"));
  if (start === -1) fail(`CHANGELOG.md has no "## [${version}]" section`);
  const rest = changelog.slice(start);
  const next = rest.slice(1).search(/^## \[/m);
  const section = (next === -1 ? rest : rest.slice(0, next + 1)).split("\n").slice(1).join("\n").trim();
  console.log(section);
}

const [command, arg] = process.argv.slice(2);
switch (command) {
  case "set":
    setVersion(arg);
    break;
  case "check":
    checkTag(arg);
    break;
  case "notes":
    releaseNotes((arg ?? "").replace(/^v/, ""));
    break;
  default:
    fail("usage: node scripts/version.mjs <set|check|notes> <version>");
}
