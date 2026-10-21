import {useState,useEffect,useMemo,useCallback} from 'react';
import {Link} from 'react-router-dom';
import {fetchUserComments,removeComment} from '../../services/commentsService';
import {getEventStatus,normalize} from '../../utils/date';
import EventStatusBadge from '../../components/EventStatusBadge';
import EventImage from '../../components/EventImage';
import SearchInput from '../../components/SearchInput';
import Description from '../../components/Description';
import EmptyState from '../../components/EmptyState';
import PageLayout from '../../components/PageLayout';
import {useNotifications} from '../../contexts/NotificationContext';

const CommentListItem=({item,onDelete,pending})=>{
  const ended=getEventStatus(item.event)==='Expired';
  return <article className="content-card saved-card">
    <div className="saved-artwork"><EventImage event={item.event} showDates={false} className="aspect-[4/3] w-full"/></div>
    <div className="saved-card-body"><div className="card-heading"><div className="min-w-0">
      <EventStatusBadge event={item.event} position="inline-block mb-2"/>
      <h2>{!ended&&item.event?.id?<Link to={`/?event=${item.event.id}`}>{item.event.title}</Link>:item.event?.title||'Event no longer available'}</h2>
    </div><button className="btn btn-ghost text-error" disabled={pending} aria-label={`Delete your comment on ${item.event?.title||'this event'}`} onClick={()=>{if(confirm('Delete this comment?')) void onDelete(item.event.id,item.comment.id);}}>{pending?'…':'✕'}</button></div>
      {item.comment?.text&&<blockquote className="comment-quote"><Description text={item.comment.text}/></blockquote>}
      {item.event?.locationAddress&&<p className="text-sm muted mt-3">{item.event.locationAddress}</p>}
      <p className="saved-date">Commented {new Date(item.comment.createdAt).toLocaleDateString()}</p>
    </div>
  </article>;
};

export default function UserComments() {
  const [comments, setComments] = useState([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const [pendingOps, setPendingOps] = useState(new Set());
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("created-desc");
  const { push } = useNotifications();

  const loadComments = useCallback(async () => {
    setLoading(true);setError('');
    try {
      const data = await fetchUserComments();
      setComments(data);
    } catch (err) {
      setError('Unable to load your comments. Please try again.');

      console.error("Failed to load comments:", err);
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(() => {void loadComments();},[loadComments]);

  const handleDelete = async (eventId, commentId) => {
    const key = `delete-${commentId}`;
    setPendingOps((prev) => new Set(prev).add(key));
    try {
      await removeComment(eventId, commentId);
      setComments((prev) => prev.filter((item) => item.comment.id !== commentId));
      push({ type: "success", message: "Comment deleted", autoCloseMs: 3000 });
    } catch (err) {
      console.error("Failed to delete comment:", err);
      push({ type: "error", message: "Failed to delete comment", autoCloseMs: 5000 });
    } finally {
      setPendingOps((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const filteredSorted = useMemo(() => {
    const matches = comments.filter((item) => {
      if (!q) return true;
      const hay = [item.comment.text, item.event?.title, item.event?.locationAddress]
        .map(normalize)
        .join(" ");
      return hay.includes(normalize(q));
    });

    const sorted = [...matches];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "title-asc":
          return normalize(a.event?.title).localeCompare(normalize(b.event?.title));
        case "title-desc":
          return normalize(b.event?.title).localeCompare(normalize(a.event?.title));
        case "created-asc":
          return new Date(a.comment.createdAt) - new Date(b.comment.createdAt);
        case "created-desc":
        default:
          return new Date(b.comment.createdAt) - new Date(a.comment.createdAt);
      }
    });

    return sorted;
  }, [comments, q, sortKey]);

  const expiredCount = useMemo(
    () => comments.filter((item) => getEventStatus(item) === "Expired").length,
    [comments]
  );

  return <PageLayout title="My comments" intro={`${comments.length} conversations · ${expiredCount} on ended events. Questions, tips and plans you have shared.`}>
    <div className="page-toolbar"><SearchInput value={q} onChange={setQ} ariaLabel="Search comments" placeholder="Search your comments"/>
      <label className="sort-field"><span className="sr-only">Sort comments</span><select className="select select-bordered" value={sortKey} onChange={event=>setSortKey(event.target.value)}>
        <option value="created-desc">Recently commented</option><option value="created-asc">Oldest first</option><option value="title-asc">Event title A–Z</option><option value="title-desc">Event title Z–A</option>
      </select></label>
    </div>
    {error&&<div role="alert" className="page-error"><p>{error}</p><button className="btn btn-outline" onClick={loadComments}>Retry</button></div>}
    {loading?<p role="status" className="content-card">Loading your comments…</p>:!error&&<div className="comment-grid">
      {!filteredSorted.length?<EmptyState message={q?'No comments match your search.':'Your conversations will appear here.'}><Link to="/" className="btn btn-outline mt-4">Find an event</Link></EmptyState>
        :filteredSorted.map(item=><CommentListItem key={item.comment.id} item={item} onDelete={handleDelete} pending={pendingOps.has(`delete-${item.comment.id}`)}/>)}
    </div>}
  </PageLayout>;
}
