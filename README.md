# Trailmark / Agent Trail

Persistent web annotations for humans and AI agents.

Agentic browsers are racing to automate browsing away — browse for you, summarize for you, buy for you. But browsing as a *reading and learning activity* is being ignored. When an AI coding agent reads documentation to implement a feature, its understanding is silo inside the context window. When you later visit those same doc pages, there's zero trace of the work that was done. Every page is a blank slate, every visit starts from scratch.

This is a Chrome extension + agent hooks + server project that creates a persistent annotation layer on any web page, where both humans and AI agents can highlight and annotate.


https://github.com/user-attachments/assets/4e1c0444-6049-47d7-b27d-e6d6c86de671


## Quick Start

### 1. Start the bridge server

```bash
cd server
python3 server.py
```

You should see:
```
[Trailmark] Server starting on http://localhost:3773
[Trailmark] Database: ~/.agent-trail/annotations.db
```

Verify it's running:
```bash
curl http://localhost:3773/health
```

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. You should see "Trailmark" in your extensions list

### 3. Test it (Human)

1. Open any web page (try a docs page like https://docs.python.org/3/tutorial/)
2. Select some text
3. A small dark toolbar appears → click 🖍️ to highlight or 💬 to add a comment
4. The text is highlighted in yellow
5. Refresh the page — the highlight persists
6. Click the Trailmark extension icon to open the side panel and see your annotation library

### 4. Load the Claude Code hook
1. Open `~/.claude/settings.json`
2. Add the hooks under `hooks/` folder (todo - automate this with a startup script)

### 5. Test it (Agent)
1. Spawn a Claude Code in terminal
2. Give it a task that involves fetching website (e.g. `"fetch aws dynamodb transaction write item documentation and answer how many WCU it uses"`)
3. Go to the website it fetched (e.g. [https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)) and see the agent's highlight on the quote that helped it answer the question and its comment on why that line is helpful / the goal that made it fetch this.
5. Refresh the page, the highlight annotation should persist.

## Architecture

```
Chrome Extension ←→ localhost:3773 ←→ SQLite
PostToolUse Hook ──→ localhost:3773 ──→ SQLite
```

Everything goes through the local bridge server. One SQLite database, two writers (extension + hook), one reader pattern.

## Project Structure

```
agent-trail/
├── server/
│   └── server.py              # Local bridge server (REST API over SQLite)
├── extension/
│   ├── manifest.json           # Chrome extension manifest v3
│   ├── content/
│   │   ├── content.js          # Selection, highlighting, popovers
│   │   └── content.css         # Overlay and UI styles
│   ├── background/
│   │   └── service-worker.js   # Badge updates, side panel toggle
│   ├── sidepanel/
│   │   ├── sidepanel.html      # Annotation library UI
│   │   └── sidepanel.js        # Library logic: search, filter, navigate
│   └── lib/
│       └── anchoring.js        # TextQuoteSelector matching
└── README.md
```

## API

The bridge server exposes:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/annotations?url=<url>` | Get annotations for a page |
| `GET` | `/annotations?limit=N` | List all annotations |
| `POST` | `/annotations` | Create annotation |
| `POST` | `/annotations/refresh` | Reset temporal fade |
| `DELETE` | `/annotations/<id>` | Delete annotation |
| `GET` | `/health` | Server status |

## Development

### Reload cycle

After editing extension code:
1. Go to `chrome://extensions`
2. Click the reload ↻ icon on the Trailmark card
3. Refresh the target web page (for content script changes)

### Debugging

- **Content script**: open DevTools on the target page, look for `[Trailmark]` in console
- **Service worker**: click "Inspect views: service worker" on `chrome://extensions`
- **Side panel**: right-click the side panel → Inspect
- **Server**: logs print to terminal, check `~/.agent-trail/parse-failures.log` for hook issues
- **Database**: `sqlite3 ~/.agent-trail/annotations.db "SELECT id, url, anchor_exact, comment FROM annotations"`

## Integration with Claude Code

### PreToolUse & PostToolUse hooks
Configure in your Claude Code settings (manual for now; will be automated with script):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebFetch",
        "hooks": [
          {
            "type": "command",
            "command": "python3 <THIS_REPO>/hooks/pre-webfetch.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "WebFetch",
        "hooks": [
          {
            "type": "command",
            "command": "python3 <THIS_REPO>/hooks/post-webfetch.py",
            "async": true
          }
        ]
      }
    ]
  }
}
```
