import { useCallback, useEffect, useState } from 'react';
import { api, type Todo } from '../api';
import { useI18n } from '../i18n';
import { usePoll } from '../usePoll';

/**
 * The household's shared to-do list.
 *
 * Built on the same `load()` + refetch pattern as every other page, and — like
 * the shopping pages, and unlike expenses — it **polls** (`usePoll`). The
 * argument is the same one: this is a list several people touch within the same
 * hour, so somebody who ticked off "call the plumber" and somebody about to
 * call the plumber must not be reading two different pages.
 */
export default function TodosPage() {
  const { t, message } = useI18n();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      api
        .get<Todo[]>('/todos')
        .then(setTodos)
        .catch((err: unknown) => setError(message(err, 'common.somethingWrong'))),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  usePoll(load);

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(message(err, 'common.somethingWrong'));
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    setTitle('');
    void run(() => api.post('/todos', { title: next }));
  };

  const editTitle = (todo: Todo) => {
    // `window.prompt`, like renaming a list and editing an item's comment: one
    // short string, and an inline editor on every row is a lot of machinery
    // for that.
    const next = window.prompt(t('todo.editPrompt'), todo.title);
    if (next === null || !next.trim() || next.trim() === todo.title) return;
    void run(() => api.patch(`/todos/${todo.id}`, { title: next.trim() }));
  };

  if (!todos) {
    return error ? (
      <div className="alert">{error}</div>
    ) : (
      <div className="empty">{t('common.loading')}</div>
    );
  }

  const open = todos.filter((todo) => todo.is_done === 0);
  const done = todos.filter((todo) => todo.is_done === 1);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('todo.title')}</h1>
          {/* The count replaces the explainer once there is anything to count:
              the sentence is for the first visit, the tally for every one
              after it. */}
          <p>
            {todos.length === 0
              ? t('todo.subtitle')
              : t('todo.summary', { open: open.length, done: done.length })}
          </p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <form className="card stack composer" onSubmit={submit}>
        <div className="row">
          <input
            aria-label={t('todo.label')}
            placeholder={t('todo.placeholder')}
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            style={{ flex: 2, minWidth: '180px' }}
          />
          <button type="submit" className="button" disabled={!title.trim()}>
            {t('todo.add')}
          </button>
        </div>
      </form>

      <div className="card">
        <div className="card-title">
          <h2>{t('todo.open')}</h2>
          {done.length > 0 && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => run(() => api.post('/todos/clear-done'))}
            >
              {t('todo.clearDone', { count: done.length })}
            </button>
          )}
        </div>

        {todos.length === 0 ? (
          <p className="empty">{t('todo.empty')}</p>
        ) : (
          <ul className="item-list">
            {[...open, ...done].map((todo) => (
              <li key={todo.id} className={`item${todo.is_done ? ' checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={todo.is_done === 1}
                  onChange={() =>
                    run(() => api.patch(`/todos/${todo.id}`, { isDone: todo.is_done === 0 }))
                  }
                  aria-label={t('todo.markDone', { title: todo.title })}
                />

                <div className="item-main">
                  <div className="item-name">{todo.title}</div>
                  {/* A name is missing only when whoever it was has left the
                      household, in which case there is nobody to credit — the
                      line is dropped rather than filled with a placeholder. */}
                  <div className="item-meta">
                    {todo.added_by_name && (
                      <span>{t('todo.addedBy', { name: todo.added_by_name })}</span>
                    )}
                    {todo.done_by_name && (
                      <span>{t('todo.doneBy', { name: todo.done_by_name })}</span>
                    )}
                  </div>
                </div>

                {/* One box for the trailing controls, so they wrap as a group
                    on a phone rather than trailing off under the checkbox. */}
                <div className="item-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title={t('common.edit')}
                    aria-label={t('todo.editTitle', { title: todo.title })}
                    onClick={() => editTitle(todo)}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    title={t('common.remove')}
                    aria-label={t('todo.removeTitle', { title: todo.title })}
                    onClick={() => run(() => api.delete(`/todos/${todo.id}`))}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
