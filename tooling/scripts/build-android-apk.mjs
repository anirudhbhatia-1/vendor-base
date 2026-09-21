#!/usr/bin/env node
/**
 * Builds an installable Android APK for the app in the current directory.
 *
 * `expo prebuild` writes the native project from app.json (Continuous Native
 * Generation: the `android/` directory is disposable and git-ignored), then
 * Gradle assembles a release build. The release build is signed with the
 * generated debug keystore -- fine for a company-test install, never for a
 * store -- and the APK is copied to `dist/apk/`. Run with the JDK and the
 * Android SDK on the environment (`JAVA_HOME`, `ANDROID_HOME`), or let this
 * script find the Homebrew installs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const appConfig = JSON.parse(readFileSync(path.join(cwd, 'app.json'), 'utf8'));
const slug = appConfig.expo?.slug ?? path.basename(cwd);
const release = (
  process.env.EXPO_PUBLIC_RELEASE_VERSION ??
  spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout ??
  ''
).trim();

const env = {
  ...process.env,
  JAVA_HOME:
    process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  ANDROID_HOME: process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools',
  EXPO_PUBLIC_RELEASE_VERSION: release,
  // Phones since 2016 and Apple-silicon emulators are arm64; a universal
  // build is three times the size for architectures no tester has.
  ORG_GRADLE_PROJECT_reactNativeArchitectures:
    process.env.ORG_GRADLE_PROJECT_reactNativeArchitectures ?? 'arm64-v8a',
  CI: '1',
};
env.PATH = `${env.JAVA_HOME}/bin:${env.ANDROID_HOME}/platform-tools:${env.PATH}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(' ')} failed with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(path.join(env.JAVA_HOME, 'bin', 'java'))) {
  console.error(`No JDK at ${env.JAVA_HOME}; set JAVA_HOME`);
  process.exit(1);
}
if (!existsSync(path.join(env.ANDROID_HOME, 'platform-tools'))) {
  console.error(`No Android SDK at ${env.ANDROID_HOME}; set ANDROID_HOME`);
  process.exit(1);
}

run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--clean']);
run('./gradlew', ['assembleRelease', '--no-daemon', '-q'], { cwd: path.join(cwd, 'android') });

const built = path.join(
  cwd,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);
if (!existsSync(built)) {
  console.error(`Gradle produced no APK at ${built}`);
  process.exit(1);
}
// Outside `dist/`, which `expo export` empties on every run.
const outDir = path.resolve(cwd, '..', '..', 'artifacts', 'android');
mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `${slug}-${release.slice(0, 7) || 'dev'}.apk`);
copyFileSync(built, target);
console.log(JSON.stringify({ event: 'android.apk.built', apk: target, release }));
