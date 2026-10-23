import { readFile, writeFile } from "node:fs/promises";
import { emptyList, type TodoList } from "../domain/todo.ts";

export async function load(path: string): Promise<TodoList> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as TodoList;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyList();
    throw err;
  }
}

export async function save(path: string, list: TodoList): Promise<void> {
  await writeFile(path, JSON.stringify(list, null, 2) + "\n");
}
