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

`list` line format: `[ ] <id> <text>` or `[x] <id> <text>`, in id order.
Empty list prints nothing.

Ids are positive integers, assigned increasing from 1, never reused.

## Errors

Errors print `error: <message>` to stderr and exit 1. No stdout.

- unknown command
- `add` without text
- `done` with an id that does not exist
- `done` without an id: `id is required`
- `done` with an id that is not a positive integer: `invalid id: <arg>`
