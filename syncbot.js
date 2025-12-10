const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// Verify GitHub webhook signature
function verifyGitHubSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    return res.status(401).send('No signature provided');
  }

  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');

  if (signature !== digest) {
    return res.status(401).send('Invalid signature');
  }

  next();
}

// Format commit message for Discord
function formatCommitEmbed(commit, repository) {
  const commitUrl = commit.url;
  const shortSha = commit.id.substring(0, 7);
  const authorName = commit.author.name;
  const authorUsername = commit.author.username;
  const message = commit.message.split('\n')[0];
  const timestamp = commit.timestamp;

  return {
    color: 0x7289DA,
    author: {
      name: authorName,
      icon_url: authorUsername ? `https://github.com/${authorUsername}.png` : undefined
    },
    title: `[${repository.name}:${commit.branch || 'unknown'}]`,
    description: `[\`${shortSha}\`](${commitUrl}) ${message}`,
    timestamp: timestamp,
    footer: {
      text: repository.full_name
    }
  };
}

// Handle push events
app.post('/webhook/github', verifyGitHubSignature, async (req, res) => {
  const event = req.headers['x-github-event'];

  // Only handle push events
  if (event !== 'push') {
    return res.status(200).send('Event ignored');
  }

  const payload = req.body;
  const repository = payload.repository;
  const commits = payload.commits;
  const pusher = payload.pusher.name;
  const ref = payload.ref;
  const branch = ref.split('/').pop();

  // Skip if no commits
  if (!commits || commits.length === 0) {
    return res.status(200).send('No commits to display');
  }

  try {
    // Add branch info to commits
    const commitsWithBranch = commits.map(commit => ({
      ...commit,
      branch: branch
    }));

    // Create embeds for each commit (limit to 10 to avoid Discord rate limits)
    const embeds = commitsWithBranch.slice(0, 10).map(commit =>
      formatCommitEmbed(commit, repository)
    );

    // Prepare Discord message
    const discordMessage = {
      content: `**${pusher}** pushed ${commits.length} commit${commits.length > 1 ? 's' : ''} to **${repository.full_name}:${branch}**`,
      embeds: embeds
    };

    // Send to Discord
    await axios.post(DISCORD_WEBHOOK_URL, discordMessage);

    res.status(200).send('Webhook processed successfully');
  } catch (error) {
    console.error('Error sending to Discord:', error.response?.data || error.message);
    res.status(500).send('Error processing webhook');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const timestamp = new Date().toISOString();

  console.log(`Health check at ${timestamp} - Uptime: ${Math.floor(uptime)}s`);

  res.status(200).json({
    status: 'ok',
    timestamp: timestamp,
    uptime: uptime
  });
});

app.listen(PORT, () => {
  console.log(`Bot is up and running on port ${PORT}...`);
});