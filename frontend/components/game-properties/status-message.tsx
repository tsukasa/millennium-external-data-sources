interface StatusMessageProps {
  status: string;
  error: boolean;
}

/** Announces load and save results below a settings section. */
export function StatusMessage({ status, error }: StatusMessageProps) {
  if (!status)
    return null;

  return (
    <div role={error ? 'alert' : 'status'} className="extdatasrc-plugin-form-status-message">
      {status}
    </div>
  );
}
