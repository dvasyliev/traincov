export interface ToastProps {
  message: string;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="Закрити">
        ✕
      </button>
    </div>
  );
}
