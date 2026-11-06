# todo — product spec

The contract the factory builds against. `tests/blackbox/` enforces it from
the outside; nothing in this file refers to internals.

## Storage

State lives in the JSON file named by `TODO_FILE` (default `./.todo.json`).
A missing file means an empty list.

## Commands

| Command            | stdout                      | exit |
|--------------------|-----------------------------|------|
| `todo add <text>`  | `added <id>`                | 0    |
| `todo list`        | one line per item, see below| 0    |
| `todo done <id>`   | `done <id>`                 | 0    |
| `todo undone <id>` | `undone <id>`               | 0    |
| `todo rm <id>`     | `removed <id>`              | 0    |
| `todo edit <id> <text>` | `edited <id>`          | 0    |

`list` line format: `[ ] <id> <text>` or `[x] <id> <text>`, in id order.
Empty list prints nothing.

Ids are positive integers, assigned increasing from 1, never reused.

`edit` replaces an item's text; its id and done state are unchanged.

`undone` marks a done item as not done; its id and text are unchanged. Like
`done`, it succeeds when the item is already in that state.

## Errors

Errors print `error: <message>` to stderr and exit 1. No stdout.

- unknown command
- `add` without text
- `done`/`rm` with an id that does not exist
- `done`/`rm` without an id: `id is required`
- `done`/`rm` with an id that is not a positive integer: `invalid id: <arg>`
- `undone` without an id: `id is required`
- `undone` with an id that is not a positive integer: `invalid id: <arg>`
- `undone` with an id that does not exist: `no todo with id <id>`
- `edit` without an id: `id is required`
- `edit <id>` without text: `text is required`
- `edit` with an id that is not a positive integer: `invalid id: <arg>`
- `edit` with an id that does not exist: `no todo with id <id>`
