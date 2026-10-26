import { add, complete, parseId, TodoError } from "./domain/todo.ts";
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
