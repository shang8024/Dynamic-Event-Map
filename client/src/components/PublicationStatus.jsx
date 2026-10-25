const labels={pending:'Under review',approved:'Published',published:'Published',rejected:'Rejected'};
export default function PublicationStatus({status='published'}) {
  return <span className={`publication-status publication-${status}`} role="status">{labels[status]||'Published'}</span>;
}
