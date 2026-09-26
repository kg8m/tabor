import type { ReactNode } from "react";
import { CloseIcon } from "./icons";

interface SubviewProps {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * The shared frame for a view shown in place of the tab tree for a while
 * (e.g. backup history): a title bar with a close button, a body (typically
 * a `.subview__list` above a `.subview__preview`), and an optional footer
 * for the view's actions.
 */
export function Subview({ title, onClose, footer, children }: SubviewProps) {
  return (
    <div className="subview">
      <div className="subview__header">
        <h2 className="subview__title">{title}</h2>
        <button
          type="button"
          className="subview__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="subview__body">{children}</div>
      {footer !== undefined && <div className="subview__footer">{footer}</div>}
    </div>
  );
}
