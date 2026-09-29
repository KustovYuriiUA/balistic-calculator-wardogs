'use strict';
// Posts the release to the support Discord's news channels through webhooks kept as GitHub secrets:
// DISCORD_NEWS_WEBHOOK (Russian #новости, text from .github/news.md) and DISCORD_NEWS_WEBHOOK_EN (English #news, text
// from .github/news.en.md). A text is used when its first line names this version, otherwise a short notice; the link
// to the release page goes last. It never fails the release, which is already published when this runs.
// Locally: `node scripts/announce-release.cjs --dry-run` prints the messages and checks the webhooks without posting.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY || 'KustovYuriiUA/balistic-calculator-wardogs';
const isDryRun = process.argv.includes('--dry-run');
const LIMIT = 2000;
const WEBHOOK = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const CHANNELS = [
  {
    name: '#новости',
    secret: 'DISCORD_NEWS_WEBHOOK',
    file: 'news.md',
    notice: `**Tochny Brosok ${version}** вышла.\nОбновление придёт само; сразу — трей → «Проверить обновления».`,
  },
  {
    name: '#news',
    secret: 'DISCORD_NEWS_WEBHOOK_EN',
    file: 'news.en.md',
    notice: `**Tochny Brosok ${version}** is out.\nThe overlay updates itself; to update now: tray → "Check for updates".`,
  },
];

function message(channel) {
  const page = `https://github.com/${repo}/releases/tag/v${version}`;
  let news = '';
  try {
    news = fs.readFileSync(path.join(root, '.github', channel.file), 'utf8').replace(/\r\n/g, '\n').trim();
  } catch {
    // No news file: the short notice.
  }
  // "1.3.1" must not match "1.3.10": the version stands alone on the first line.
  const escaped = version.replace(/\./g, '\\.');
  const isCurrent = new RegExp(`(^|[^\\d.])${escaped}([^\\d.]|$)`).test(news.split('\n')[0] || '');
  const body = isCurrent ? news : channel.notice;
  const text = `${body}\n\n${page}`;
  return text.length <= LIMIT ? text : `${body.slice(0, LIMIT - page.length - 4)}…\n\n${page}`;
}

async function announce(channel) {
  const webhook = (process.env[channel.secret] || '').trim();
  const content = message(channel);
  if (!WEBHOOK.test(webhook)) {
    console.log(webhook ? `::warning::${channel.secret} is not a Discord webhook URL; ${channel.name} not announced.` : `${channel.secret} is not set; ${channel.name} not announced.`);
    if (isDryRun) console.log(content + '\n');
    return;
  }
  if (isDryRun) {
    const info = await fetch(webhook);
    if (!info.ok) throw new Error(`${channel.name} webhook check: HTTP ${info.status}`);
    const hook = await info.json();
    console.log(`${channel.name}: webhook "${hook.name}" → channel ${hook.channel_id}. Would post:\n\n${content}\n`);
    return;
  }
  const res = await fetch(`${webhook}?wait=true`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({content, allowed_mentions: {parse: []}}),
  });
  if (!res.ok) throw new Error(`${channel.name}: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`Announced v${version} in ${channel.name}.`);
}

(async () => {
  for (const channel of CHANNELS) {
    try {
      await announce(channel);
    } catch (error) {
      console.log(`::warning::Discord announcement failed: ${error.message}`);
    }
  }
})();
