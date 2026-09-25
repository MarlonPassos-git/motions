# RPC quickfix picker negative controls

Controls for `test/specs/rpc-quickfix-picker.e2e.ts` (**3 passing**). Both
sabotages were restored and the spec returned to 3 passing, 0 failing.

1. **Returning `[]` from the source's `items()`** produced **1 passing, 2
   failing**. `lists Neovim quickfix entries in the picker` and `shows each
entry as a vault-relative path and line` both failed at
   `the quickfix picker to list both seeded entries`. `lists nothing when the
quickfix list is empty` stayed green, correctly — it asserts the empty case
   and cannot distinguish an empty list from a broken source on its own, which
   is why the other two exist.

2. **Returning the absolute path from `vaultRelative()`** produced **2 passing,
   1 failing**, and only the path assertion moved:

    ```
    Received array: ["/tmp/nix-shell.XXXX/test-vault-YYYY/Welcome.md:2",
                     "/tmp/nix-shell.XXXX/test-vault-YYYY/Target.md:1"]
    ```

    Neovim reports absolute paths and Obsidian navigates by vault-relative ones,
    so this is the conversion that silently produces an unopenable entry. The
    assertion pairs an exact `Welcome.md:2` match with
    `not.toContain('/')`, because an exact match alone would still pass if a
    second, absolute entry were present.
