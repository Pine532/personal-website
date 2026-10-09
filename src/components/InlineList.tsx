import { Fragment } from 'react';

/**
 * A short list set on one line, with dots between the items. The dots and the spaces are real
 * text, so copying and reader modes keep the items apart, but assistive technology gets plain
 * list items. Each item wraps as a unit and keeps its dot (styles/base.css). The explicit list
 * role keeps the list and its label announced in Safari, which drops them from unstyled lists.
 */
export function InlineList({ items, className, label }: { items: readonly string[]; className?: string; label?: string }) {
  return (
    <ul className={className ? `inline-list ${className}` : 'inline-list'} role="list" aria-label={label}>
      {items.map((item, index) => (
        <Fragment key={item}>
          {index > 0 && ' '}
          <li>
            {item}
            {index < items.length - 1 && <span aria-hidden="true">{'\u00A0·'}</span>}
          </li>
        </Fragment>
      ))}
    </ul>
  );
}
