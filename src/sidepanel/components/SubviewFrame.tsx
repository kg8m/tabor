import type { ReactNode } from "react";
import { CloseIcon } from "./icons";

interface SubviewFrameProps {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * The shared frame for a subview, shown in place of the tab tree for a while
 * (e.g. `BackupHistorySubview`): a title bar with a close button, a body
 * (typically a `.subview__list` above a `.subview__preview`), and an
 * optional footer for the subview's actions.
 */
export function SubviewFrame({
  title,
  onClose,
  footer,
  children,
}: SubviewFrameProps) {
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
