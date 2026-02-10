# ASO MCP Server

App Store Optimization MCP Server for AI Assistants. Claude, ChatGPT, Cursor gibi AI araclariyla App Store keyword arastirmasi, rakip analizi ve metadata optimizasyonu yapin.

## Ozellikler

- **10 ASO tool'u** — keyword arastirma, skorlama, rakip analizi, review analizi, metadata optimizasyonu
- **Gercek App Store verisi** — app-store-scraper ile canli veri
- **Custom scoring** — Apple Search Ads sorununa bagimli olmayan kendi algoritma
- **SQLite cache** — Tekrar eden isteklerde hizli yanit
- **Rate limiting** — Apple'dan ban yememek icin akilli istek yonetimi
- **Coklu ulke destegi** — 155+ ulke, Turkce ASO'ya ozel destek

## Kurulum

### npm ile (Global)

```bash
npm install -g aso-mcp
```

### Kaynaktan

```bash
git clone https://github.com/kenanatmaca/aso-mcp.git
cd aso-mcp
npm install
npm run build
```

## Claude Desktop Entegrasyonu

`~/Library/Application Support/Claude/claude_desktop_config.json` dosyasina ekle:

### npm ile kurduysan:

```json
{
  "mcpServers": {
    "aso-mcp": {
      "command": "aso-mcp"
    }
  }
}
```

### Kaynaktan calistiriyorsan:

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

## Claude Code Entegrasyonu

```bash
claude mcp add aso-mcp npx tsx /ABSOLUTE/PATH/TO/aso-mcp/src/server.ts
```

## Tool'lar

### Faz 1 — Keyword Arastirma

| Tool | Aciklama |
|------|----------|
| `search_keywords` | Keyword traffic/difficulty skorlari + ust siradaki uygulamalar |
| `suggest_keywords` | App ID'ye gore keyword onerileri (kategori, benzer, rekabet stratejileri) |
| `get_app_details` | Uygulamanin tum ASO bilgileri + metadata analizi |

### Faz 2 — Rakip Analizi & Optimizasyon

| Tool | Aciklama |
|------|----------|
| `analyze_competitors` | Keyword'deki rakiplerin metadata karsilastirmasi + keyword gap |
| `optimize_metadata` | Title/subtitle/keyword field optimizasyon onerisi (karakter limiti dahil) |
| `analyze_reviews` | Sentiment analizi, sikayet ve feature request cikarma |
| `track_ranking` | Birden fazla keyword'de uygulamanin siralama pozisyonu |
| `keyword_gap` | Iki uygulama arasindaki keyword farki + firsat analizi |

### Faz 3 — Lokalizasyon & Raporlama

| Tool | Aciklama |
|------|----------|
| `localized_keywords` | Keyword'lerin farkli ulkelerdeki performans karsilastirmasi |
| `get_aso_report` | Kapsamli ASO raporu: detay + skorlar + rakipler + review ozeti |

## Kullanim Ornekleri

Claude Desktop veya Claude Code'da su sorulari sorabilirsin:

```
"fitness keyword'u Turkiye'de ne kadar rekabetci?"

"Spotify'in rakiplerini analiz et ve keyword firsatlarini bul"

"com.spotify.client uygulamasi icin ASO raporu cikar"

"muzik ve podcast keyword'lerini TR, US, DE pazarlarinda karsilastir"

"Spotify vs Apple Music keyword gap analizi yap"

"Shazam'in kullanici yorumlarini analiz et"

"com.myapp icin title ve subtitle onerisi ver, hedef: fitness, egzersiz, antrenman"

"meditation keyword'unde ilk 10'daki uygulamalari karsilastir"
```

## Gelistirme

```bash
# Dev mode
npm run dev

# Build
npm run build

# MCP Inspector ile test
npm run inspect

# Test suite
npx tsx test.ts
```

## Teknoloji Stack

- **TypeScript** + **Node.js 22+**
- **MCP SDK** — Model Context Protocol
- **app-store-scraper** — App Store veri cekme
- **aso** — ASO skorlama (fallback ile)
- **better-sqlite3** — Cache
- **Zod** — Schema validation

## Skorlama Algoritmasi

Apple Search Ads API'nin popularity sorununa bagimli olmadan kendi skorlarini hesaplar:

| Skor | Aciklama |
|------|----------|
| **Visibility** | Rating, review sayisi ve siralama bazli gorunurluk |
| **Competitive** | Ust siradaki uygulamalarin gucune gore zorluk |
| **Opportunity** | Yuksek traffic + dusuk difficulty = yuksek firsat |
| **Overall** | Tumunu birlestiren genel ASO skoru |

## Lisans

MIT

## Yazar

Kenan Atmaca
