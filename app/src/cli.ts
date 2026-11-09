import { add, clear, complete, edit, parseId, remove, reopen, TodoError } from "./domain/todo.ts";
import { load, save } from "./infra/file-store.ts";

const file = process.env.TODO_FILE ?? ".todo.json";

async function run([cmd, ...args]: string[]): Promise<string[]> {
  const list = await load(file);
  switch (cmd) {
    case "add": {
      const [next, todo] = add(list, args.join(" "));
      await save(file, next);
      return [`added ${todo.id}`];
    }
    case "list":
      return list.items.map((t) => `[${t.done ? "x" : " "}] ${t.id} ${t.text}`);
    case "done": {
      const id = parseId(args[0]);
      await save(file, complete(list, id));
      return [`done ${id}`];
    }
    case "undone": {
      const id = parseId(args[0]);
      await save(file, reopen(list, id));
      return [`undone ${id}`];
    }
    case "edit": {
      const id = parseId(args[0]);
      const text = args.slice(1).join(" ");
      await save(file, edit(list, id, text));
      return [`edited ${id}`];
    }
    case "rm": {
      const id = parseId(args[0]);
      await save(file, remove(list, id));
      return [`removed ${id}`];
    }
    case "clear": {
      const [next, count] = clear(list);
      await save(file, next);
      return [`cleared ${count}`];
    }
    default:
      throw new TodoError(`unknown command: ${cmd ?? "(none)"}`);
  }
}

try {
  for (const line of await run(process.argv.slice(2))) console.log(line);
} catch (err) {
  if (!(err instanceof TodoError)) throw err;
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
