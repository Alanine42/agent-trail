#!/usr/bin/env python3
"""
Trailmark — PostToolUse hook for Claude Code.
Fires async after every WebFetch call.
Parses tool input/output, POSTs annotation to the bridge server.

Zero additional LLM calls. Zero direct database access.
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SERVER = "http://localhost:3773"
LOG_PATH = Path.home() / ".agent-trail" / "parse-failures.log"


def log_parse_failure(url: str, reason: str, content: str):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "url": url,
        "reason": reason,
        "content_preview": content[:500],
    }
    with open(LOG_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")


def extract_micro_intent(prompt: str) -> str:
    """Strip the injected verbatim instruction, keep the original question."""
    parts = prompt.split("\n\nAlso, ")
    return parts[0].strip()


def extract_verbatim_quotes(result: str) -> list[str]:
    """Extract verbatim quotes from VERBATIM_START/END delimiters."""
    match = re.search(r"VERBATIM_START\n([\s\S]*?)\nVERBATIM_END", result)
    if not match:
        return []

    block = match.group(1).strip()
    quotes = re.findall(r'"([^"]+)"', block)
    if quotes:
        return quotes

    cleaned = block.strip().strip('"')
    return [cleaned] if cleaned else []


def extract_summary(result: str) -> str:
    """Everything before the VERBATIM_START delimiter."""
    return result.split("VERBATIM_START")[0].strip().rstrip("-").strip()


def extract_prefix_suffix(result: str, quote: str, chars: int = 100) -> tuple[str, str]:
    """Find the quote in the response and grab surrounding text."""
    idx = result.find(quote)
    if idx == -1:
        return ("", "")
    prefix = result[max(0, idx - chars):idx]
    suffix = result[idx + len(quote):idx + len(quote) + chars]
    return (prefix, suffix)


def parse_macro_goal(transcript_path: str | None) -> str | None:
    """Extract the task description from Claude Code's transcript."""
    if not transcript_path:
        return None

    path = Path(transcript_path)
    if not path.exists():
        return None

    try:
        transcript = json.loads(path.read_text())
        for entry in transcript:
            if entry.get("role") == "user":
                content = entry.get("content", "")
                if isinstance(content, list):
                    texts = [
                        block.get("text", "")
                        for block in content
                        if block.get("type") == "text"
                    ]
                    content = " ".join(texts)
                if content:
                    return content[:200].strip()
        return None
    except (json.JSONDecodeError, KeyError):
        return None


def post_annotation(annotation: dict):
    """POST annotation to the bridge server."""
    data = json.dumps(annotation).encode()
    req = urllib.request.Request(
        f"{SERVER}/annotations",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status


def main():
    raw = sys.stdin.read()
    hook_input = json.loads(raw)

    if hook_input.get("tool_name") != "WebFetch":
        return

    tool_input = hook_input["tool_input"]
    tool_response = hook_input["tool_response"]

    if tool_response.get("code", 0) != 200:
        return

    url = tool_input["url"]
    prompt = tool_input.get("prompt", "")
    result = tool_response.get("result", "")

    # 1. Extract micro-intent
    micro_intent = extract_micro_intent(prompt)
    if not micro_intent:
        log_parse_failure(url, "Could not extract micro-intent from prompt", prompt)
        return

    # 2. Extract verbatim quotes
    quotes = extract_verbatim_quotes(result)
    if not quotes:
        log_parse_failure(url, "No VERBATIM_START/END block or no quotes found", result)
        return

    # 3. Extract summary
    summary = extract_summary(result)

    # 4. Parse macro-goal from transcript
    macro_goal = parse_macro_goal(hook_input.get("transcript_path"))

    # 5. POST annotations to bridge server
    for quote in quotes:
        prefix, suffix = extract_prefix_suffix(result, quote)

        try:
            post_annotation({
                "url": url,
                "anchor_exact": quote,
                "anchor_prefix": prefix,
                "anchor_suffix": suffix,
                "comment": f"Looked up: {micro_intent}",
                "annotation_type": "agent_marker",
                "author_type": "agent",
                "agent_id": "claude-code",
                "display_name": "Claude Code",
                "task_description": macro_goal,
                "micro_intent": micro_intent,
                "webfetch_summary": summary,
                "session_id": hook_input.get("session_id"),
            })
        except Exception as e:
            log_parse_failure(url, f"Failed to POST annotation: {e}", quote)


if __name__ == "__main__":
    main()