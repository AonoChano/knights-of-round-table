import { useEffect, useRef } from "react";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="model-confirm-backdrop" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="model-confirm">
        <div className="model-confirm-title">{title}</div>
        <p className="model-confirm-body">{body}</p>
        <div className="model-confirm-actions">
          <button type="button" className="small-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? "small-button small-button-danger small-button-icon" : "small-button-primary small-button-icon"}
            onClick={onConfirm}
          >
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
