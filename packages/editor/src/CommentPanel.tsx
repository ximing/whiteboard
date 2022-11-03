import type { CommentObj } from '@plume/model';
import { useState } from 'react';

export function CommentPanel({
  comment,
  screen,
  author,
  readOnly,
  onAppend,
  onResolve,
}: {
  comment: CommentObj;
  screen: { x: number; y: number };
  author: string;
  readOnly?: boolean;
  onAppend: (text: string) => void;
  onResolve: (resolved: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const left = Math.max(12, Math.min(screen.x + 18, window.innerWidth - 280));
  const top = Math.max(12, Math.min(screen.y - 12, window.innerHeight - 280));

  return (
    <div className="comment-panel" data-testid="comment-panel" style={{ left, top }} role="dialog" aria-label="Comment">
      <div className="comment-head">
        <span>{comment.resolved ? 'Resolved' : 'Comment'}</span>
        {!readOnly && (
          <button type="button" onClick={() => onResolve(!comment.resolved)}>
            {comment.resolved ? 'Reopen' : 'Resolve'}
          </button>
        )}
      </div>
      <ol className="comment-list">
        {comment.messages.length === 0 && <li className="comment-empty">No notes yet.</li>}
        {comment.messages.map((message) => (
          <li key={message.id}>
            <strong>{message.author || 'Guest'}</strong>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text) return;
            onAppend(text);
            setDraft('');
          }}
        >
          <textarea
            aria-label="Comment text"
            value={draft}
            placeholder={author ? `Note as ${author}` : 'Write a note'}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit">Add</button>
        </form>
      )}
    </div>
  );
}
