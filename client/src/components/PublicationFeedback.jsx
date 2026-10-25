export default function PublicationFeedback({note}) {
  return <section className="publication-feedback" aria-labelledby="rejection-heading"><p className="eyebrow">Review outcome</p>
    <h2 id="rejection-heading">Reason for rejection</h2><p className="publication-review-note">{note}</p>
    <p className="text-sm muted">This submission was not published. You can create a corrected event and submit it for review.</p></section>;
}
