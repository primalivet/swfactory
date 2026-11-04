Implement this approved plan in the todo CLI in this repository.

Goal: add a `todo rm <id>` command that removes an item.

Behavior:
- `todo rm <id>` prints `removed <id>` to stdout, exit 0. The item is gone from `todo list`.
- Ids are never reused: after removing the item with the highest id, the next `add` still gets a new id.
- `todo rm` without an id prints `error: id is required` to stderr, exit 1.
- `todo rm <arg>` where `<arg>` is not a positive integer prints `error: invalid id: <arg>` to stderr, exit 1.
- `todo rm <n>` where no item has id `<n>` prints `error: no todo with id <n>` to stderr, exit 1.

Changes:
1. `app/src/domain/todo.ts`: add `remove(list, id)`; reuse `parseId` and `TodoError`.
2. `app/src/cli.ts`: add the `rm` command.
3. `app/SPEC.md`: add `rm` to the commands table and its errors.
4. `tests/blackbox/todo.test.ts`: add tests for the behavior above.

Read `app/SPEC.md` and the existing code first and follow their style.
