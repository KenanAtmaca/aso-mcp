# ASO MCP Server

[![npm version](https://img.shields.io/npm/v/aso-mcp.svg)](https://www.npmjs.com/package/aso-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

**App Store Optimization toolkit for AI assistants.** Keyword research, competitor analysis, review sentiment, metadata optimization — all through the Model Context Protocol.

> **No API key required.** Works out of the box with real App Store data. Supports 155+ countries.

## Quick Start

```bash
npx aso-mcp
```

Or install globally:

```bash
npm install -g aso-mcp
```

## Why aso-mcp?

- **12 specialized ASO tools** — from keyword discovery to complete ASO briefs
- **Real App Store data** — live search results, ratings, reviews, and suggestions
- **Custom scoring engine** — proprietary algorithm independent of Apple Search Ads API issues
- **No API key needed** — zero configuration, install and go
- **Smart caching** — SQLite-backed cache for fast repeated queries
- **Rate limiting** — built-in request management to avoid Apple throttling
- **Multi-country** — analyze keywords across 155+ App Store markets

## Integration

### Claude Desktop

Add to your config file:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "aso-mcp": {
      "command": "aso-mcp"
    }
  }
}
```

<details>
<summary>Running from source instead?</summary>

```json
{
  "mcpServers": {
    "aso-mcp": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/aso-mcp/src/server.ts"],
      "cwd": "/ABSOLUTE/PATH/TO/aso-mcp"
    }
  }
}
```

</details>

### Claude Code

```bash
claude mcp add -s user aso-mcp -- npx aso-mcp
```

### Other MCP Clients

Any MCP-compatible client (ChatGPT, Cursor, Windsurf, etc.) can connect via stdio transport. Point it to the `aso-mcp` command.

## Tools

### Phase 1 — Keyword Research

| Tool | Description |
|------|-------------|
| `search_keywords` | Traffic/difficulty scores + top-ranking apps for a keyword |
| `suggest_keywords` | Keyword suggestions by app ID (category, similar, competition strategies) |
| `get_app_details` | Full ASO info for an app + metadata analysis |

### Phase 2 — Competitor Analysis & Optimization

| Tool | Description |
|------|-------------|
| `analyze_competitors` | Metadata comparison of top apps for a keyword + keyword gap |
| `optimize_metadata` | Title/subtitle/keyword field suggestions with character limit checks |
| `analyze_reviews` | Sentiment analysis, complaint and feature request extraction |
| `track_ranking` | App's ranking position across multiple keywords |
| `keyword_gap` | Keyword difference between two apps + opportunity analysis |

### Phase 3 — Localization & Reporting

| Tool | Description |
|------|-------------|
| `localized_keywords` | Keyword performance comparison across different countries |
| `get_aso_report` | Comprehensive ASO report: scores + competitors + reviews in one call |

### Phase 4 — ASO Generation

| Tool | Description |
|------|-------------|
| `discover_keywords` | Keyword discovery from scratch for a new app |
| `generate_aso_brief` | Complete ASO brief with keyword pool, competitor patterns, and metadata suggestions |

## Usage Examples

Just ask your AI assistant naturally:

```
"How competitive is the 'fitness' keyword in the US?"

"Analyze Spotify's competitors and find keyword opportunities"

"Generate an ASO report for com.spotify.client"

"Compare 'music' and 'podcast' keywords across US, UK, and DE markets"

"Do a keyword gap analysis: Spotify vs Apple Music"

"Analyze Shazam's user reviews"

"Suggest title and subtitle for my fitness app targeting: workout, training, exercise"

"Discover keywords for a new calorie tracking app"
```

## Scoring Algorithm

The server calculates its own scores, independent of Apple Search Ads API:

| Score | Description |
|-------|-------------|
| **Visibility** | Based on rating, review count, and ranking position |
| **Competitive** | Difficulty derived from the strength of top-ranking apps |
| **Opportunity** | High traffic + low difficulty = high opportunity |
| **Overall** | Weighted combination of all scores (0-10) |

When the `aso` npm package fails to reach Apple (503 errors), the server automatically falls back to custom scoring using search result analysis — so scores are always available.

## Development

```bash
git clone https://github.com/kenanatmaca/aso-mcp.git
cd aso-mcp
npm install

npm run dev          # Run with tsx (development)
npm run build        # Compile TypeScript
npm run inspect      # MCP Inspector UI

# Tests
npx tsx test.ts              # Core tests (17)
npx tsx test-phase3.ts       # Localization & report tests (4)
npx tsx test-generation.ts   # ASO generation tests (8)
```

## Tech Stack

- **TypeScript** + **Node.js 22+**
- **[MCP SDK](https://modelcontextprotocol.io)** — Model Context Protocol
- **[app-store-scraper](https://www.npmjs.com/package/app-store-scraper)** — App Store data
- **[aso](https://www.npmjs.com/package/aso)** — ASO scoring with automatic fallback
- **[better-sqlite3](https://www.npmjs.com/package/better-sqlite3)** — Cache layer
- **[Zod](https://www.npmjs.com/package/zod)** — Schema validation

## License

MIT

## Author

[Kenan Atmaca](https://github.com/kenanatmaca)
