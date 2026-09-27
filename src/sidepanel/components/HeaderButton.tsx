import { useRef, type ReactNode } from "react";
import { useTooltip } from "../hooks/useTooltip";
import { Tooltip } from "./Tooltip";

interface HeaderButtonProps {
  label: string;
  // Shown below `label` in the tooltip, spelling out what the button does—
  // an icon alone doesn’t.
  description: string;
  icon: ReactNode;
  onClick: () => void;
}

/**
 * An icon-only button in the side panel’s header, with a hover tooltip
 * naming and describing it.
 */
export function HeaderButton({
  label,
  description,
  icon,
  onClick,
}: HeaderButtonProps) {
  const reference = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltip(reference);

  const handleClick = (): void => {
    // The subview this opens covers the button, so hide the tooltip rather
    // than leave it waiting on a `mouseleave` that may not come right away.
    tooltip.onMouseLeave();
    onClick();
  };

  return (
    <>
      <button
        ref={reference}
        type="button"
        className="app-header__button"
        aria-label={label}
        onClick={handleClick}
        onMouseEnter={tooltip.onMouseEnter}
        onMouseLeave={tooltip.onMouseLeave}
      >
        {icon}
      </button>
      {tooltip.isVisible && (
        <Tooltip
          text={label}
          secondaryText={description}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}
