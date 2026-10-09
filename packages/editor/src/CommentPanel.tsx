import type { CommentObj } from '@plume/model';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const left = Math.max(12, Math.min(screen.x + 18, window.innerWidth - 280));
  const top = Math.max(12, Math.min(screen.y - 12, window.innerHeight - 280));

  return (
    <div className="comment-panel" data-testid="comment-panel" style={{ left, top }} role="dialog" aria-label={t('comment.label')}>
      <div className="comment-head">
        <span>{comment.resolved ? t('comment.resolved') : t('comment.label')}</span>
        {!readOnly && (
          <button type="button" onClick={() => onResolve(!comment.resolved)}>
            {comment.resolved ? t('comment.reopen') : t('comment.resolve')}
          </button>
        )}
      </div>
      <ol className="comment-list">
        {comment.messages.length === 0 && <li className="comment-empty">{t('comment.empty')}</li>}
        {comment.messages.map((message) => (
          <li key={message.id}>
            <strong>{message.author || t('comment.guest')}</strong>
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
            aria-label={t('comment.text')}
            value={draft}
            placeholder={author ? t('comment.placeholderAs', { name: author }) : t('comment.placeholder')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit">{t('comment.add')}</button>
        </form>
      )}
    </div>
  );
}
