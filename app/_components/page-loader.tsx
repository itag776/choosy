interface PageLoaderProps {
  label: string;
  detail?: string;
}

export default function PageLoader({ label, detail = "This should only take a moment." }: PageLoaderProps) {
  return (
    <main className="page-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="page-loader__card">
        <span className="page-loader__wordmark">choosy</span>
        <div className="page-loader__animation" aria-hidden="true">
          <span/>
          <span/>
          <span/>
        </div>
        <div className="page-loader__copy">
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
        <div className="page-loader__progress" aria-hidden="true"><i/></div>
      </div>
    </main>
  );
}
