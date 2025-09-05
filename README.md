# BookSpank Book Club Website

Site for the Tulane gentleman's book club

Domain purchased through porkbun - [bookspank.com](https://bookspank.com)

Hosting via Cloudflare Workers

## Functionality Goals
- Display current book, what page to read to, and next meeting date
- List of books already read
- Order of who is picking next
- Each person's want-to-reads (or at least a link to the excel sheet)
- Members can log in and gain access to:
    - Update book picks
    - Link to zoom room
    - Voting on next book
    - 'Liking' members book picks

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Wrangler CLI globally (if not already installed):
   ```bash
   npm install -g wrangler
   ```

3. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

## Local Development

To test the website locally:

```bash
npm run dev
```

This will start a local development server. The website will be available at `http://localhost:8787`

## Deployment

### First-time Setup

1. Make sure your domain `bookspank.com` is added to your Cloudflare account
2. Set up DNS records pointing to Cloudflare (should be done automatically if you transferred your domain)

### Deploy to Production

To deploy to your custom domain (bookspank.com):

```bash
npm run deploy
```

### Deploy to Staging

To deploy to a workers.dev subdomain for testing:

```bash
npm run deploy-staging
```

## Project Structure

```
├── src/
│   └── index.js          # Main Cloudflare Worker script
├── wrangler.toml         # Wrangler configuration
├── package.json          # Node.js dependencies and scripts
└── README.md            # This file
```

## Domain Configuration

The site is configured to serve on:
- `bookspank.com`
- `www.bookspank.com`

Make sure these domains are properly configured in your Cloudflare dashboard before deploying.


