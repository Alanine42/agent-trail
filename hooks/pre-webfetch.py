#!/usr/bin/env python3
import json, re, sys

raw = sys.stdin.read()

# print("Raw stdin:", raw)

payload = json.loads(raw)
url = payload['tool_input']['url']
prompt = payload['tool_input']['prompt']

injection = """

Also, at the end, output the exact minimal verbatim text 
from the page that supports your answer. Format it exactly as:

VERBATIM_START
[exact quote here]
VERBATIM_END

Pick minimal, copy character-for-character, no paraphrasing."""

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow", # "ask" to show user modified prompt. "allow" to just allow. 
        "updatedInput": {
            "url": url,
            "prompt": prompt + injection
        }
    }
}))
