---
title: Vim Motions
description: A polished, Neovim-native experience inside Obsidian. Markdown-aware text objects, structural navigation, EasyMotion, workspace control, and more.
tags:
    - getting-started
---

A polished, Neovim-native experience inside [Obsidian](https://obsidian.md). Vim Motions adds what's missing from Obsidian's built-in Vim mode: Markdown-aware text objects, structural navigation, hard-wrap formatting, workspace keyboard control, EasyMotion, a telescope-style fuzzy picker, Lua configuration with `vim.keymap.set` / `vim.opt` / `vim.fn` / `vim.api` / `vim.ob` / `vim.tbl_*` / autocommands / timers / highlight groups / global keymaps / which-key labels, and a built-in `.obsidian.vimrc` loader.

## Feature highlights

- **[[text-objects|Markdown text objects]]** — operate on bold, italic, code, math, links, blockquotes, code blocks, tables, and more with standard Vim operators
- **[[structural-navigation|Structural navigation]]** — jump between headings, lists, links, and buffers with `]h`, `]l`, `]n`, `]b`
- **[[lua-config|Lua configuration]]** — `.obsidian.init.lua` with `vim.keymap.set`, `vim.opt` (including `guicursor`), `vim.fn` (including `undotree()`), `vim.api` (buffer APIs, `nvim_set_hl`), `vim.ob` (68 Obsidian-specific functions: metadata, filesystem, UI, cursor, surround, leader), `vim.tbl_*`, `vim.json`, `vim.inspect`, `vim.regex` (ECMAScript RegExp), `vim.schedule`/`vim.uv` timers, 19 autocommand events, buffer-local keymaps, `vim.obsidian.keymap` (global keymaps), `vim.obsidian.whichkey` (which-key labels), async file reading (`vim.ob.fs.read`), multi-file configs via `require()`, fuzzy picker API, and hot-reload on save
- **[[vimrc|Built-in vimrc]]** — `.obsidian.vimrc` loader with 75+ configurable settings and hot-reload on save
- **[[flash|Flash motions]]** — enhanced `f`/`F`/`t`/`T` with jump labels, incremental `s` search, post-commit `/`/`?` labels, clever-f
- **[[easymotion|EasyMotion / Hop]]** — jump to any visible position with two keystrokes
- **[[workspace-navigation|Workspace keyboard control]]** — navigate panes, tabs, and sidebar without a mouse
- **[[surround|Surround]]** — add, change, or delete surrounding delimiters (nvim-surround parity, custom pairs)
- **[[hardwrap|Hard-wrap formatting]]** — Markdown-aware `gq`/`gw` operators
- **[[ex-commands|100+ ex commands]]** — `:sp`, `:vs`, `:e`, `:grep`, `:ob`, fuzzy picker commands, and more
- **[[hint-mode|Vimium-style hints]]** — navigate the entire Obsidian UI with keyboard hints
- **[[undo-tree|Undo tree]]** — branching undo history visualization with `g-`/`g+` chronological navigation, `:earlier`/`:later` time travel, sidebar tree view, and optional persistence

## Get started

> [!tip] New to Vim Motions?
> Start with [[installation]] to install the plugin, then follow [[recommended-setup]] to configure Obsidian for the best experience.

## Quick links

- **[[keybindings|Keybinding cheat sheet]]** — complete reference for all motions, text objects, operators, and commands
- **[[settings|Settings reference]]** — all 100 configurable items with defaults and vimrc equivalents
- **[[known-limitations|Known limitations]]** — architectural constraints and workarounds

## What's new in 1.0.1

- **Yank highlight covers rendered blocks whole** — `yG` over a callout flashed every line around it and left the callout itself untouched, and the same held for embedded notes, images and tables. Live Preview renders those as block widgets that no CodeMirror decoration can reach, so they are now painted directly, in both `solid` and `fade` modes ([[quality-of-life|quality of life]])
- **Callouts no longer stay highlighted after a linewise yank** — a callout that a visual-line selection passed through kept a selection-coloured background forever, surviving the yank, further motions, and editing the block
- **`K` on a wikilink opens a page preview that stays open** — the preview either did nothing or flashed up for under a second. The synthesised hover event now carries the Mod flag, so it works regardless of the Page preview plugin's per-source Ctrl/Cmd requirement, and the cursor's own coordinates, which anchors the popover to the link instead of the window corner ([[quality-of-life|quality of life]])
- **`:obcommand` keeps a charwise selection** — a visual-mode mapping such as `:obcommand templater-obsidian:create-new-note-from-template<CR>` ran the Obsidian command with no selection, so Templater and every other selection-dependent command saw nothing. Charwise, linewise and blockwise selections now each restore as themselves, while a typed numeric or `%` range still expands to whole lines ([[ex-commands|ex commands]])
- **Which-key no longer opens on a literal-argument leader key** — `r<leader>`, and any other command awaiting a literal `<character>` argument (`f`, `t`, `m`, `q`, `"`), opened the leader overlay instead of taking the key as its argument ([[which-key|which-key]])

See the [[changelog|full changelog]] for details.
