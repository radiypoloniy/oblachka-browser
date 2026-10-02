// Один запрос на окно; отмена соседа и поздняя очистка нового запроса исключены.
export class HistorySearchTasks {
  private readonly tasks = new Map<number, { id: string; abort: AbortController }>();
  start(owner: number, id: string): AbortController {
    this.tasks.get(owner)?.abort.abort();
    const abort = new AbortController();
    this.tasks.set(owner, { id, abort });
    return abort;
  }
  cancel(owner: number, id: string): void {
    const task = this.tasks.get(owner);
    if (task?.id === id) { task.abort.abort(); this.tasks.delete(owner); }
  }
  finish(owner: number, abort: AbortController): void {
    if (this.tasks.get(owner)?.abort === abort) this.tasks.delete(owner);
  }
}
