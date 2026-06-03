# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a fork/rebrand of kejilion.sh — an all-in-one Linux management Bash script toolbox. The main script `harvey.sh` (~18650 lines) provides a terminal-based interactive menu for Docker management, LNMP web stack deployment, system monitoring, network tools, and an app marketplace with 119 built-in applications.

- **Owner**: github.com/359073395
- **Main repo**: github.com/359073395/hy
- **Third-party apps repo**: github.com/359073395/apps
- **Short domain**: sh.hyjiexi.eu.org (GitHub Pages via Cloudflare CNAME → 359073395.github.io)
- **License**: Apache-2.0 (inherited from upstream)

## Multi-Language Scripts

The main script is replicated in 7 language directories. When making changes, **always update both the root `harvey.sh` AND `cn/harvey.sh`** at minimum. Other translations (en, tw, jp, kr, ru, ir) are auto-generated via GitHub Actions translate.yml.

## Rebranding Rules (CRITICAL)

This project was rebranded from the original `kejilion/sh`. When syncing upstream changes (from `https://github.com/kejilion/sh.git`), the following MUST be applied:

1. **Text replacements**: `kejilion` → `harvey`, `KEJILION` → `HARVEY`, `Kejilion` → `Harvey`, `科技lion` → `Harvey`, `KejiLion` → `Harvey`
2. **GitHub repos**:
   - `github.com/harvey/apps` → `github.com/359073395/apps` (our fork)
   - `github.com/harvey/sh` → `github.com/359073395/hy` (our fork)
   - `github.com/harvey/*` → `github.com/kejilion/*` (keep original for unforked deps)
3. **Domains**: All `*.harvey.pro` → `*.kejilion.pro` (we don't own harvey.pro)
4. **Website URLs**: `harvey.sh` → `sh.hyjiexi.eu.org`
5. **Shortcut**: `k` → `H` (`/usr/local/bin/k` → `/usr/local/bin/H`, "输入k" → "输入H")
6. **File renames**: `kejilion.sh` → `harvey.sh`

**Important**: When adding new apps or features, NEVER reference `github.com/harvey` — this account doesn't exist.

## Adding a New App to the Marketplace

The app marketplace (`linux_panel()` function) has two insertion points:

1. **Menu entry** (around line 13040-13060): Add `echo -e "${gl_kjlan}N. ${colorN}AppName ${gl_huang}★${gl_bai}"` before the separator line before "第三方应用列表". Include the separator `echo -e "${gl_kjlan}-------------------------"` after each app.

2. **Case handler** (before `b)` case around line 16150): Insert a new case block in the main `case $sub_choice in` switch.

Three app architecture patterns exist:
- **`install_panel` pattern** (simple): Define `panel_app_install()`, `panel_app_manage()`, `panel_app_uninstall()` then call `install_panel`. Best for apps with native install scripts (e.g., x-ui #116).
- **Custom while-loop pattern**: Full management menu with install/update/uninstall + domain/port management. Used for apps #117-119. Must end with `done` followed by `  ;;`.
- **`docker_app` pattern**: For Docker-based apps that use `docker_rum()`, `$docker_use`, etc.

## Port Conflict Detection

The `check_port_conflict()` function (around line 300) checks if ports are in use before installation. For custom apps, call it before `open_port`:
```bash
check_port_conflict 4173 && { open_port 4173; } || { echo "安装取消"; break; }
```

## Syntax Validation

After ANY modification to the scripts, run:
```bash
bash -n harvey.sh && bash -n cn/harvey.sh && echo "Pass" || echo "FAIL"
```

The most common causes of syntax errors when adding apps:
- Missing `done` before a new case block
- Missing `;;` after `done`
- Accidental deletion of the `b)` case marker
- Trailing `\` on echo lines

## Key Architecture

- `linux_panel()` (line ~12960) — App marketplace with built-in apps (IDs 1-119) + third-party `.conf` files from `apps/` directory
- `docker_app()` (line ~2207) — Standard Docker app lifecycle (install/update/uninstall + domain/port management)
- `install_panel()` (line ~3097) — Simple panel app lifecycle wrapper
- `ldnmp_Proxy()` (line ~2684) — Nginx reverse proxy with SSL for domain binding
- `open_port()` / `close_port()` (line ~693/716) — iptables port management
- `check_port_conflict()` (line ~300) — Pre-install port availability check
- `send_stats()` (line ~51) — Usage statistics (reports to api.kejilion.pro)

## Upstream Sync

Upstream remote is configured:
```bash
git remote add upstream https://github.com/kejilion/sh.git
```

To sync: `git fetch upstream && git merge upstream/main --allow-unrelated-histories`, then re-apply rebranding rules above. Due to the rebase history, expect conflicts — ask Claude to handle them rather than resolving manually.
