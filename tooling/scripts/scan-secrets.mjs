import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedEnvironmentExamples = new Set(['.env.example', '.env.test.example']);
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['Stripe secret key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['npm access token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  // The patterns above cover providers this project does not use. These cover the
  // credentials it does: a Supabase service-role JWT bypasses every row-level rule,
  // and a pooler URL carries its password inline.
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['Razorpay key', /\brzp_(?:live|test)_[A-Za-z0-9]{10,}\b/g],
  ['MSG91 auth key', /\bmsg91[_-]?auth[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9]{20,}/gi],
];

/**
 * A connection string carries its password inline, so the shape alone is not the
 * problem — a committed one pointing at a remote host with a real password is.
 * Loopback hosts and obvious placeholders are how every env.example in this
 * repository is written and must keep passing.
 */
const CONNECTION_STRING =
  /\b(?:postgres(?:ql)?|rediss?|mongodb(?:\+srv)?):\/\/([^:@\s/]+):([^@\s/]+)@([^\s/:?]+)/g;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', 'database', 'valkey']);

function isPlaceholderSecret(value) {
  const decoded = value.replace(/%[0-9A-Fa-f]{2}/g, '');
  return (
    /^[A-Z0-9_]+$/.test(decoded) ||
    /replace|placeholder|example|changeme|your[_-]/i.test(decoded) ||
    /^(?:[a-z0-9_]*_)?(?:local|test|synthetic|dev)(?:_[a-z0-9_]+)?$/.test(decoded)
  );
}

export function scanConnectionStrings(text) {
  const findings = [];
  CONNECTION_STRING.lastIndex = 0;
  for (const match of text.matchAll(CONNECTION_STRING)) {
    const [, , password, host] = match;
    if (LOCAL_HOSTS.has(host) || host.endsWith('.local')) continue;
    if (isPlaceholderSecret(password)) continue;
    findings.push({ index: match.index ?? 0, kind: 'connection string password' });
  }
  return findings;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function scanText(file, text) {
  const findings = [];
  const basename = path.basename(file);
  if (/^\.env(?:\..+)?$/.test(basename) && !allowedEnvironmentExamples.has(basename)) {
    findings.push({ file, line: 1, kind: 'committed environment file' });
  }
  for (const finding of scanConnectionStrings(text)) {
    findings.push({ file, kind: finding.kind, line: lineNumber(text, finding.index) });
  }
  for (const [kind, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({ file, line: lineNumber(text, match.index), kind });
    }
  }
  return findings;
}

function repositoryFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  return result.stdout.split('\0').filter(Boolean);
}

function runSelfTest() {
  const githubToken = `ghp_${'A'.repeat(32)}`;
  const awsKey = `AKIA${'B'.repeat(16)}`;
  if (scanText('fixture.txt', `${githubToken}\n${awsKey}`).length !== 2) {
    throw new Error('known secret shapes were not detected');
  }
  if (scanText('.env.example', 'TOKEN=PLACEHOLDER_ONLY').length !== 0) {
    throw new Error('safe environment example was rejected');
  }
  if (scanText('.env.local', 'TOKEN=PLACEHOLDER_ONLY').length !== 1) {
    throw new Error('committed environment file was not rejected');
  }

  // The credentials this project actually handles. The patterns above are for
  // providers it does not use, and covered none of these.
  // Assembled rather than written out, like the token fixtures above: a literal here
  // is a secret-shaped string in a scanned file, and this control scans itself.
  const serviceRoleJwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoic2VydmljZSJ9', 'c2lnbmF0dXJl'].join(
    '.',
  );
  if (scanText('fixture.txt', serviceRoleJwt).length !== 1) {
    throw new Error('a Supabase service-role JWT was not detected');
  }
  if (scanText('fixture.txt', `rzp_live_${'A'.repeat(16)}`).length !== 1) {
    throw new Error('a Razorpay key was not detected');
  }

  const url = (user, password, host) =>
    ['postgresql://', user, ':', password, '@', host, ':5432/postgres'].join('');
  const remoteWithPassword = url('postgres.abc', 'Sup3rS3cret', 'aws-0.pooler.supabase.com');
  if (scanText('fixture.txt', remoteWithPassword).length !== 1) {
    throw new Error('a remote connection string password was not detected');
  }

  // Every env.example in this repository is written one of these two ways and must
  // keep passing, or the control gets switched off.
  const placeholderUrl = url(
    'postgres.abc',
    'URL_ENCODED_ADMIN_PASSWORD',
    'aws-0.pooler.supabase.com',
  );
  if (scanText('fixture.txt', placeholderUrl).length !== 0) {
    throw new Error('a placeholder connection string was rejected');
  }
  const loopbackUrl = url('marketplace_local', 'marketplace_local_only', '127.0.0.1');
  if (scanText('fixture.txt', loopbackUrl).length !== 0) {
    throw new Error('a loopback development connection string was rejected');
  }
  if (scanText('fixture.txt', 'KEY=eyJhbGciOi...REPLACE_WITH_ANON_KEY...').length !== 0) {
    throw new Error('an elided example key was rejected');
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    console.warn('Secret-scanner self-test passed.');
    return;
  }

  const findings = [];
  for (const file of repositoryFiles()) {
    // `git ls-files --cached` lists index entries, which still include a file
    // deleted from the working tree until that deletion is staged. Statting one
    // threw ENOENT and took the whole scan down, so the control could not run
    // at all in a tree that was mid-change — exactly when it is most wanted.
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.size > 2_000_000) continue;
    const content = fs.readFileSync(file);
    if (content.includes(0)) continue;
    findings.push(...scanText(file, content.toString('utf8')));
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}: possible ${finding.kind}`);
    }
    process.exitCode = 1;
    return;
  }
  console.warn('Secret scan passed.');
}

main();
