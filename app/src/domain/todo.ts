export type Todo = { id: number; text: string; done: boolean };
export type TodoList = { nextId: number; items: Todo[] };

export class TodoError extends Error {}

export const emptyList = (): TodoList => ({ nextId: 1, items: [] });

export function add(list: TodoList, text: string): [TodoList, Todo] {
  if (text.trim() === "") throw new TodoError("text is required");
  const todo = { id: list.nextId, text, done: false };
  return [{ nextId: list.nextId + 1, items: [...list.items, todo] }, todo];
}

export function complete(list: TodoList, id: number): TodoList {
  if (!list.items.some((t) => t.id === id)) {
    throw new TodoError(`no todo with id ${id}`);
  }
  return {
    ...list,
    items: list.items.map((t) => (t.id === id ? { ...t, done: true } : t)),
  };
}
