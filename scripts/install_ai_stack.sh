#!/usr/bin/env bash
# Installs the verified open-source tools and Claude Code skills referenced in the AI stack.
# Run from the workspace root: ./scripts/install_ai_stack.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOS="$ROOT/repos"
mkdir -p "$REPOS"

clone_if_missing() {
  local name="$1" url="$2"
  if [ -d "$REPOS/$name" ]; then
    echo "skip   $name (already in repos/)"
  else
    git clone --depth 1 "$url" "$REPOS/$name"
  fi
}

echo "=== Installing native Claude Code skills (HyperFrames & Claude Ads) ==="
# 1. HyperFrames (HTML-to-MP4 AI video engine by HeyGen)
npx skills add heygen-com/hyperframes || echo "Run 'npx skills add heygen-com/hyperframes' manually if npm requires permissions."

# 2. Claude Ads (paid media audit skill for Meta, Google, TikTok)
clone_if_missing claude-ads https://github.com/AgriciDaniel/claude-ads.git
echo "Inside Claude Code you can also run:"
echo "  /plugin marketplace add agricidaniel/claude-ads"
echo "  /plugin install claude-ads@ai-marketing-hub-claude-ads"

echo "=== Cloning open-source SaaS replacement repositories into repos/ ==="
# 3. OmniRoute (local API proxy across 290+ AI providers)
clone_if_missing OmniRoute https://github.com/diegosouzapw/OmniRoute.git
# 4. Camoufox (C++ fingerprint-spoofing anti-detect browser for AI scrapers)
clone_if_missing camoufox https://github.com/daijro/camoufox.git
# 5. Agentic Inbox (self-hosted Cloudflare AI email client)
clone_if_missing agentic-inbox https://github.com/cloudflare/agentic-inbox.git
# 6. LibreChat (unified multi-model AI chat & MCP interface)
clone_if_missing LibreChat https://github.com/LibreChat-AI/LibreChat.git
# 7. Open Generative AI (self-hosted studio for 200+ image/video/lip-sync models)
clone_if_missing Open-Generative-AI https://github.com/Anil-matcha/Open-Generative-AI.git
# 8. FinceptTerminal (open-source Bloomberg-style terminal & quant research)
clone_if_missing FinceptTerminal https://github.com/Fincept-Corporation/FinceptTerminal.git

echo "=== All repositories are in repos/ ==="
