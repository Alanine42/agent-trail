# Trailmark

Persistent web annotation layer for humans and AI agents.

## Architecture
- Local bridge server (Python, SQLite) on localhost:3773
- Chrome extension (manifest v3) talks to server via REST
- PostToolUse hook writes to same server

## Key files
- server/server.py — bridge server, all storage
- extension/content/content.js — highlight UI, selection, popovers
- extension/lib/anchoring.js — TextQuoteSelector fuzzy matching
- extension/sidepanel/ — annotation library panel

## Dev workflow
1. python3 server/server.py
2. Load extension/ as unpacked in chrome://extensions
3. Test on real doc pages (AWS docs, MDN, ArXiv)

## Current status: M1 scaffold
Working: project structure, server, content script, anchoring, side panel
Next: test on real pages, fix anchoring edge cases, add Ask popover

## Design spec
See docs/ for full architecture and milestones.