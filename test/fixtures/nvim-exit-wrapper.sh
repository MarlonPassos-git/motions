#!/usr/bin/env bash
# Records how Neovim exited, because every other channel dies with the
# WebDriver session: the browser diagnostic reports "invalid session id", the
# plugin's own exit Notice becomes unreadable, and NVIM_LOG_FILE stays empty
# since Neovim writes it only for some levels. /proc tells us the child is gone
# but not why.
#
# neovimBinaryPath is a plugin setting, so pointing it here needs no product
# change. The wrapper is named differently from nvim, so the bare name below
# resolves to the real binary on PATH rather than recursing.
set -u

NVIM_EXIT_LOG="${NVIM_EXIT_LOG:-/tmp/nvim-exit.log}"

# Obsidian's spawned environment does not necessarily carry the PATH this
# script was written against, so resolve the real binary explicitly and fall
# back to the bare name only as a last resort.
REAL_NVIM="${NVIM_REAL:-}"
if [ -z "$REAL_NVIM" ]; then
    for candidate in /usr/bin/nvim /usr/local/bin/nvim /opt/homebrew/bin/nvim; do
        [ -x "$candidate" ] && REAL_NVIM="$candidate" && break
    done
fi
[ -z "$REAL_NVIM" ] && REAL_NVIM="$(command -v nvim || echo nvim)"

"$REAL_NVIM" "$@"
rc=$?

# Bash reports a signalled child as 128+signal, so both cases are recoverable
# from this one number.
printf '%s pid=%s rc=%s\n' "$(date -u +%H:%M:%S)" "$$" "$rc" >>"$NVIM_EXIT_LOG"

exit "$rc"
