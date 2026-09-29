'use strict';
// Posts the release to #новости on the support Discord through the webhook in DISCORD_NEWS_WEBHOOK (a GitHub
// secret). The text is .github/news.md when its first line names this version, otherwise a short notice; the link to
// the release page goes last. It never fails the release, which is already published when this runs.
// Locally: `node scripts/announce-release.cjs --dry-run` prints the message and checks the webhook without posting.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY || 'KustovYuriiUA/balistic-calculator-wardogs';
const webhook = (process.env.DISCORD_NEWS_WEBHOOK || '').trim();
const isDryRun = process.argv.includes('--dry-run');
const LIMIT = 2000;

function message() {
  const page = `https://github.com/${repo}/releases/tag/v${version}`;
  let news = '';
  try {
    news = fs.readFileSync(path.join(root, '.github', 'news.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  } catch {
    // No news file: the short notice below.
  }
  // "1.3.1" must not match "1.3.10": the version stands alone on the first line.
  const escaped = version.replace(/\./g, '\\.');
  const isCurrent = new RegExp(`(^|[^\\d.])${escaped}([^\\d.]|$)`).test(news.split('\n')[0] || '');
  const body = isCurrent ? news : `**Tochny Brosok ${version}** вышла.\nОбновление придёт само; сразу — трей → «Проверить обновления».`;
  const text = `${body}\n\n${page}`;
  return text.length <= LIMIT ? text : `${body.slice(0, LIMIT - page.length - 4)}…\n\n${page}`;
}

async function main() {
  const content = message();
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhook)) {
    console.log(webhook ? '::warning::DISCORD_NEWS_WEBHOOK is not a Discord webhook URL; not announced.' : 'DISCORD_NEWS_WEBHOOK is not set; not announced.');
    if (isDryRun) console.log(content);
    return;
  }
  if (isDryRun) {
    const info = await fetch(webhook);
    if (!info.ok) throw new Error(`webhook check: HTTP ${info.status}`);
    const hook = await info.json();
    console.log(`webhook "${hook.name}" → channel ${hook.channel_id}. Would post:\n\n${content}`);
    return;
  }
  const res = await fetch(`${webhook}?wait=true`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({content, allowed_mentions: {parse: []}}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`Announced v${version} on Discord.`);
}

main().catch((error) => {
  console.log(`::warning::Discord announcement failed: ${error.message}`);
});
